// Vista "Pendientes": todas las palomitas de todas las notas, en lista (por fecha) o por semana.
// Se pueden agregar pendientes a mano y cambiarles la fecha.
import { useState } from "react";
import type { ReactElement } from "react";
import { FolderTag, Icon } from "./icons";
import {
  GROUP_LABEL,
  GROUP_ORDER,
  PRIO_LABEL,
  type Group,
  type Priority,
  type Task,
  fromInputs,
  groupOf,
  nextPriority,
  prioRank,
  toInputs,
  whenLabel,
} from "./tasks";

type NoteRef = { id: string; title: string; folder: string };
export type WhenValue = { due: Date; hasTime: boolean } | null;

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export default function TasksView({
  tasks,
  notes,
  onToggle,
  onOpen,
  onAdd,
  onSetWhen,
  onSetPriority,
}: {
  tasks: Task[];
  notes: NoteRef[];
  onToggle: (t: Task) => void;
  onOpen: (noteId: string) => void;
  onAdd: (text: string, when: WhenValue) => Promise<void>;
  onSetWhen: (t: Task, when: WhenValue) => Promise<void>;
  onSetPriority: (t: Task, p: Priority) => Promise<void>;
}) {
  const [showDone, setShowDone] = useState(false);
  const [mode, setMode] = useState<"list" | "week">(() => {
    try {
      return (localStorage.getItem("taskai.tasksMode") as "list" | "week") || "list";
    } catch {
      return "list";
    }
  });
  const pickMode = (m: "list" | "week") => {
    setMode(m);
    try {
      localStorage.setItem("taskai.tasksMode", m);
    } catch {
      /* sin almacenamiento */
    }
  };
  const [editing, setEditing] = useState<string | null>(null); // pendiente al que se le cambia la fecha
  const byId = new Map(notes.map((n) => [n.id, n]));
  const now = new Date();
  const mine = tasks.filter((t) => byId.has(t.noteId));
  const visible = mine.filter((t) => showDone || !t.done);
  const open = mine.filter((t) => !t.done).length;
  const doneCount = mine.length - open;
  const keyOf = (t: Task) => `${t.noteId}-${t.idx}`;

  const row = (t: Task, compact = false) => {
    const n = byId.get(t.noteId)!;
    const g = groupOf(t, now);
    const k = keyOf(t);
    return (
      // Todo el renglón palomea; el nombre de la nota la abre y la pastilla cambia la fecha
      <div
        key={k}
        className={`trow ${t.done ? "done" : ""} ${compact ? "compact" : ""}`}
        role="checkbox"
        tabIndex={0}
        aria-checked={t.done}
        aria-label={t.done ? `Desmarcar: ${t.text}` : `Marcar como hecho: ${t.text}`}
        onClick={() => onToggle(t)}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle(t);
          }
        }}
      >
        <span className="tcheck" aria-hidden="true" />
        <button
          className={`tprio p-${t.priority ?? "none"}`}
          title={`${PRIO_LABEL[t.priority ?? "none"]} · clic para cambiar`}
          aria-label={`${PRIO_LABEL[t.priority ?? "none"]}. Cambiar prioridad`}
          onClick={(e) => {
            e.stopPropagation();
            void onSetPriority(t, nextPriority(t.priority));
          }}
        />
        <div className="tmain">
          <div className="ttext">{t.text}</div>
          <div className="tmeta">
            <FolderTag name={n.folder} short />
            <button
              className="tnote"
              onClick={(e) => {
                e.stopPropagation();
                onOpen(n.id);
              }}
              title="Abrir la nota"
            >
              {n.title}
            </button>
          </div>
        </div>
        {!compact && (
          <div className="twhen-wrap" onClick={(e) => e.stopPropagation()}>
            <button
              className={`twhen ${t.due ? `g-${g}` : "add"}`}
              title={t.due ? "Cambiar la fecha" : "Ponerle fecha"}
              onClick={() => setEditing(editing === k ? null : k)}
            >
              {t.due ? whenLabel(t) : "+ fecha"}
            </button>
            {editing === k && (
              <WhenPicker
                initial={t.due ? { due: t.due, hasTime: t.hasTime } : null}
                onCancel={() => setEditing(null)}
                onSave={async (w) => {
                  setEditing(null);
                  await onSetWhen(t, w);
                }}
              />
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="tasks">
      <AddTask onAdd={onAdd} />

      <div className="tasks-bar">
        <span className="board-count">
          {open} {open === 1 ? "pendiente" : "pendientes"}
        </span>
        <div className="seg" role="radiogroup" aria-label="Vista">
          <button role="radio" aria-checked={mode === "list"} className={mode === "list" ? "on" : ""} onClick={() => pickMode("list")}>
            Lista
          </button>
          <button role="radio" aria-checked={mode === "week"} className={mode === "week" ? "on" : ""} onClick={() => pickMode("week")}>
            Semana
          </button>
        </div>
        {doneCount > 0 && (
          <button className={`btn toggle ${showDone ? "on" : ""}`} onClick={() => setShowDone((s) => !s)}>
            <Icon name="check" size={14} />
            {showDone ? "Ocultar hechos" : `Ver hechos (${doneCount})`}
          </button>
        )}
      </div>

      {mode === "week" ? (
        <Week tasks={visible} row={row} now={now} />
      ) : visible.length === 0 ? (
        <div className="board-none">
          <div className="tasks-empty-ico">
            <Icon name="check" size={26} />
          </div>
          <p>
            {open === 0 && doneCount > 0
              ? "¡Todo hecho! No te queda ningún pendiente."
              : "Aún no hay pendientes. Agrega uno arriba o escribe en una nota cosas como “mañana entregar la tarea”."}
          </p>
        </div>
      ) : (
        <List tasks={visible} row={row} now={now} />
      )}
    </div>
  );
}

function List({ tasks, row, now }: { tasks: Task[]; row: (t: Task) => ReactElement; now: Date }) {
  const groups = new Map<Group, Task[]>();
  for (const t of tasks) {
    const g = groupOf(t, now);
    groups.set(g, [...(groups.get(g) ?? []), t]);
  }
  // Dentro de cada grupo: primero lo de prioridad alta, luego media; después por fecha
  for (const list of groups.values())
    list.sort((a, b) => prioRank(a) - prioRank(b) || (a.due?.getTime() ?? 0) - (b.due?.getTime() ?? 0));
  return (
    <>
      {GROUP_ORDER.filter((g) => groups.has(g)).map((g) => (
        <section key={g} className={`tgroup g-${g}`}>
          <h2>
            {GROUP_LABEL[g]} <em>{groups.get(g)!.length}</em>
          </h2>
          <div className="tlist">{groups.get(g)!.map((t) => row(t))}</div>
        </section>
      ))}
    </>
  );
}

/** 7 días a partir de hoy (con flechas para moverse de semana). */
function Week({ tasks, row, now }: { tasks: Task[]; row: (t: Task, compact?: boolean) => ReactElement; now: Date }) {
  const [offset, setOffset] = useState(0);
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset * 7);
  const days = Array.from({ length: 7 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  const late = tasks.filter((t) => !t.done && groupOf(t, now) === "late").length;
  const undated = tasks.filter((t) => !t.due).length;
  const label = (d: Date) => d.toLocaleDateString("es-MX", { day: "numeric", month: "short" }).replace(".", "");
  return (
    <>
      <div className="week-nav">
        <button className="icon-btn" title="Semana anterior" aria-label="Semana anterior" onClick={() => setOffset((o) => o - 1)}>
          <Icon name="back" size={16} />
        </button>
        <span>
          {label(days[0])} – {label(days[6])}
        </span>
        <button
          className="icon-btn flip"
          title="Semana siguiente"
          aria-label="Semana siguiente"
          onClick={() => setOffset((o) => o + 1)}
        >
          <Icon name="back" size={16} />
        </button>
        {offset !== 0 && (
          <button className="link" onClick={() => setOffset(0)}>
            Hoy
          </button>
        )}
        {(late > 0 || undated > 0) && (
          <span className="week-extra">
            {late > 0 && `${late} atrasado${late > 1 ? "s" : ""}`}
            {late > 0 && undated > 0 && " · "}
            {undated > 0 && `${undated} sin fecha`} (en Lista)
          </span>
        )}
      </div>
      <div className="week">
        {days.map((d) => {
          const list = tasks
            .filter((t) => t.due && sameDay(t.due, d))
            .sort((a, b) => prioRank(a) - prioRank(b) || a.due!.getTime() - b.due!.getTime());
          const today = sameDay(d, now);
          return (
            <section key={d.toISOString()} className={`wday ${today ? "today" : ""}`}>
              <h3>
                <span>{d.toLocaleDateString("es-MX", { weekday: "short" }).replace(".", "")}</span>
                <b>{d.getDate()}</b>
              </h3>
              <div className="wlist">
                {list.length ? (
                  list.map((t) => (
                    <div key={`${t.noteId}-${t.idx}`} className="wtask-wrap">
                      {t.hasTime && (
                        <span className="wtime">
                          {whenLabel(t).split(" · ")[1]}
                        </span>
                      )}
                      {row(t, true)}
                    </div>
                  ))
                ) : (
                  <p className="wempty">—</p>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}

/** Formulario de arriba: "Agregar un pendiente…" con fecha y hora opcionales. */
function AddTask({ onAdd }: { onAdd: (text: string, when: WhenValue) => Promise<void> }) {
  const [text, setText] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit() {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      await onAdd(text.trim(), date ? { due: fromInputs(date, time), hasTime: !!time } : null);
      setText("");
      setDate("");
      setTime("");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="add-task"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Icon name="plus" size={16} />
      <input
        className="add-text"
        value={text}
        maxLength={200}
        onChange={(e) => setText(e.target.value)}
        placeholder="Agregar un pendiente…"
        aria-label="Nuevo pendiente"
      />
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Fecha (opcional)" title="Fecha (opcional)" />
      <input
        type="time"
        value={time}
        disabled={!date}
        onChange={(e) => setTime(e.target.value)}
        aria-label="Hora (opcional)"
        title={date ? "Hora (opcional)" : "Primero elige una fecha"}
      />
      <button className="btn primary" type="submit" disabled={!text.trim() || busy}>
        Agregar
      </button>
    </form>
  );
}

/** Ventanita para cambiar la fecha y hora de un pendiente. */
function WhenPicker({
  initial,
  onSave,
  onCancel,
}: {
  initial: WhenValue;
  onSave: (w: WhenValue) => void;
  onCancel: () => void;
}) {
  const start = toInputs(initial?.due ?? null, initial?.hasTime ?? false);
  const [date, setDate] = useState(start.date);
  const [time, setTime] = useState(start.time);
  return (
    <>
      <div className="menu-backdrop" onClick={onCancel} />
      <div className="when-pop" role="dialog" aria-label="Cambiar fecha">
        <label>
          Fecha
          <input type="date" value={date} autoFocus onChange={(e) => setDate(e.target.value)} />
        </label>
        <label>
          Hora <em>(opcional)</em>
          <input type="time" value={time} disabled={!date} onChange={(e) => setTime(e.target.value)} />
        </label>
        <div className="when-actions">
          {initial && (
            <button className="link danger" onClick={() => onSave(null)}>
              Quitar fecha
            </button>
          )}
          <button className="btn ghost" onClick={onCancel}>
            Cancelar
          </button>
          <button className="btn primary" disabled={!date} onClick={() => onSave({ due: fromInputs(date, time), hasTime: !!time })}>
            Guardar
          </button>
        </div>
      </div>
    </>
  );
}
