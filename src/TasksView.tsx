// Vista "Pendientes": todas las palomitas de todas las notas, agrupadas por fecha.
import { useState } from "react";
import { FolderTag, Icon } from "./icons";
import { GROUP_LABEL, GROUP_ORDER, type Group, type Task, groupOf, whenLabel } from "./tasks";

type NoteRef = { id: string; title: string; folder: string };

export default function TasksView({
  tasks,
  notes,
  onToggle,
  onOpen,
}: {
  tasks: Task[];
  notes: NoteRef[];
  onToggle: (t: Task) => void;
  onOpen: (noteId: string) => void;
}) {
  const [showDone, setShowDone] = useState(false);
  const byId = new Map(notes.map((n) => [n.id, n]));
  const now = new Date();
  const visible = tasks.filter((t) => byId.has(t.noteId) && (showDone || !t.done));
  const groups = new Map<Group, Task[]>();
  for (const t of visible) {
    const g = groupOf(t, now);
    groups.set(g, [...(groups.get(g) ?? []), t]);
  }
  for (const list of groups.values()) list.sort((a, b) => (a.due?.getTime() ?? 0) - (b.due?.getTime() ?? 0));
  const open = tasks.filter((t) => byId.has(t.noteId) && !t.done).length;
  const doneCount = tasks.filter((t) => byId.has(t.noteId) && t.done).length;

  return (
    <div className="tasks">
      <div className="tasks-bar">
        <span className="board-count">
          {open} {open === 1 ? "pendiente" : "pendientes"}
        </span>
        {doneCount > 0 && (
          <button className={`btn toggle ${showDone ? "on" : ""}`} onClick={() => setShowDone((s) => !s)}>
            <Icon name="check" size={14} />
            {showDone ? "Ocultar hechos" : `Ver hechos (${doneCount})`}
          </button>
        )}
      </div>

      {visible.length === 0 ? (
        <div className="board-none">
          <div className="tasks-empty-ico">
            <Icon name="check" size={26} />
          </div>
          <p>
            {open === 0 && doneCount > 0
              ? "¡Todo hecho! No te queda ningún pendiente."
              : "Aún no hay pendientes. Escribe cosas como “mañana entregar la tarea” y la IA los apunta aquí."}
          </p>
        </div>
      ) : (
        GROUP_ORDER.filter((g) => groups.has(g)).map((g) => (
          <section key={g} className={`tgroup ${g}`}>
            <h2>
              {GROUP_LABEL[g]} <em>{groups.get(g)!.length}</em>
            </h2>
            <div className="tlist">
              {groups.get(g)!.map((t) => {
                const n = byId.get(t.noteId)!;
                return (
                  // Todo el renglón palomea; solo el nombre de la nota abre la nota
                  <div
                    key={`${t.noteId}-${t.idx}`}
                    className={`trow ${t.done ? "done" : ""}`}
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
                    {t.due && <span className={`twhen ${g}`}>{whenLabel(t)}</span>}
                  </div>
                );
              })}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
