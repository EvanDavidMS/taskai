// Pendientes de todas las notas: se leen de la versión ordenada ("- [ ] texto — **viernes, 20 de noviembre, 2:00 AM**").
// Las fechas las escribe la IA a partir de las que calculó el código, así que vienen en un formato fijo.

export type Task = {
  noteId: string;
  idx: number; // número de palomita dentro de la nota (mismo orden que toggleTask)
  text: string;
  done: boolean;
  due: Date | null; // fecha (y hora, si hasTime)
  hasTime: boolean;
  priority: Priority;
};

/** Prioridad: se guarda como 🔴 / 🟡 al inicio del pendiente ("- [ ] 🔴 Examen — **fecha**"). Baja = sin marca. */
export type Priority = "alta" | "media" | null;
export const PRIO_MARK: Record<"alta" | "media", string> = { alta: "🔴", media: "🟡" };
const PRIO_RE = /^\s*(🔴|🟡)\s*/u;
/** Separa la marca de prioridad del texto del pendiente. */
export function splitPriority(text: string): { priority: Priority; text: string } {
  const m = text.match(PRIO_RE);
  if (!m) return { priority: null, text };
  return { priority: m[1] === "🔴" ? "alta" : "media", text: text.slice(m[0].length) };
}
/** Clic en el puntito: sin prioridad → alta → media → sin prioridad. */
export const nextPriority = (p: Priority): Priority => (p === null ? "alta" : p === "alta" ? "media" : null);
export const PRIO_LABEL = { alta: "Prioridad alta", media: "Prioridad media", none: "Sin prioridad" };
const PRIO_RANK = { alta: 0, media: 1, none: 2 };
/** Para ordenar: alta, media y luego el resto. */
export const prioRank = (t: Task) => PRIO_RANK[t.priority ?? "none"];

export type Group = "late" | "today" | "tomorrow" | "week" | "later" | "none";

export const GROUP_LABEL: Record<Group, string> = {
  late: "Atrasados",
  today: "Hoy",
  tomorrow: "Mañana",
  week: "Esta semana",
  later: "Más adelante",
  none: "Sin fecha",
};
export const GROUP_ORDER: Group[] = ["late", "today", "tomorrow", "week", "later", "none"];

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const plain = (w: string) => w.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Lee "viernes, 20 de noviembre, 2:00 AM" → fecha. Sin fecha reconocible → null. */
export function parseWhen(s: string, now = new Date()): { due: Date; hasTime: boolean } | null {
  const p = plain(s);
  let day: Date | null = null;
  const m = p.match(/\b(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\b/);
  if (m) {
    const month = m[2] === "setiembre" ? 8 : MONTHS.indexOf(m[2]);
    day = new Date(now.getFullYear(), month, Number(m[1]));
    // "5 de enero" escrito en diciembre es del año que viene
    if (now.getTime() - day.getTime() > 60 * 86400000) day.setFullYear(now.getFullYear() + 1);
  } else if (/\bhoy\b/.test(p)) {
    day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }
  if (!day) return null;
  const t = p.match(/\b(\d{1,2}):(\d{2})\s*(am|pm|a\.\s?m\.|p\.\s?m\.)?/);
  if (t) {
    let h = Number(t[1]) % 24;
    if (t[3] && /^p/.test(t[3]) && h < 12) h += 12;
    if (t[3] && /^a/.test(t[3]) && h === 12) h = 0;
    day.setHours(h, Number(t[2]));
    return { due: day, hasTime: true };
  }
  return { due: day, hasTime: false };
}

/** Mismo patrón que TASK_RE en App.tsx: el orden de las palomitas tiene que coincidir. */
const TASK_LINE = /^(\s*[-*+]\s+\[)([ xX])(\])(.*)$/gm;

export function parseTasks(noteId: string, md: string, now = new Date()): Task[] {
  const out: Task[] = [];
  let idx = -1;
  for (const m of md.matchAll(TASK_LINE)) {
    idx++;
    const { priority, text: raw } = splitPriority(m[4].trim());
    const [head, ...rest] = raw.split(" — ");
    const when = rest.join(" — ");
    const parsed = parseWhen(when || raw, now);
    out.push({
      noteId,
      idx,
      text: (when ? head : raw).replace(/\*\*/g, "").trim(),
      done: m[2] !== " ",
      due: parsed?.due ?? null,
      hasTime: parsed?.hasTime ?? false,
      priority,
    });
  }
  return out;
}

export function groupOf(t: Task, now = new Date()): Group {
  if (!t.due) return "none";
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const d = new Date(t.due.getFullYear(), t.due.getMonth(), t.due.getDate()).getTime();
  const days = Math.round((d - start) / 86400000);
  if (days < 0) return "late";
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days <= 7) return "week";
  return "later";
}

/** "vie 20 nov · 2:00 AM" */
export function whenLabel(t: Task): string {
  if (!t.due) return "";
  const date = t.due.toLocaleDateString("es-MX", { weekday: "short", day: "numeric", month: "short" }).replace(/\./g, "").replace(/ de /g, " ");
  if (!t.hasTime) return date;
  const h = t.due.getHours();
  const time = `${h % 12 === 0 ? 12 : h % 12}:${String(t.due.getMinutes()).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
  return `${date} · ${time}`;
}

/** Fecha en el formato que escribe la IA: "viernes, 20 de noviembre, 2:00 PM" (así parseWhen la entiende igual). */
export function formatWhen(d: Date, hasTime: boolean): string {
  const day = d.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });
  if (!hasTime) return day;
  const h = d.getHours();
  return `${day}, ${h % 12 === 0 ? 12 : h % 12}:${String(d.getMinutes()).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

/** Cambia (o quita, con `when = null`) la fecha del pendiente número `idx` en el Markdown. */
export function setTaskWhen(md: string, idx: number, when: string | null): string {
  let i = -1;
  return md.replace(TASK_LINE, (m, a: string, c: string, b: string, rest: string) => {
    if (++i !== idx) return m;
    const head = rest.split(" — ")[0].trimEnd();
    return a + c + b + (when ? `${head} — **${when}**` : head);
  });
}

/** Cambia la prioridad del pendiente número `idx` en el Markdown. */
export function setTaskPriority(md: string, idx: number, p: Priority): string {
  let i = -1;
  return md.replace(TASK_LINE, (m, a: string, c: string, b: string, rest: string) => {
    if (++i !== idx) return m;
    const body = splitPriority(rest.trimStart()).text;
    return a + c + b + " " + (p ? `${PRIO_MARK[p]} ` : "") + body;
  });
}

/** "2026-11-20" + "14:30" (de los <input type=date/time>) → Date local. */
export function fromInputs(date: string, time: string): Date {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time ? time.split(":").map(Number) : [0, 0];
  return new Date(y, mo - 1, d, h, mi);
}
/** Date → valores para <input type=date> y <input type=time>. */
export function toInputs(d: Date | null, hasTime: boolean): { date: string; time: string } {
  if (!d) return { date: "", time: "" };
  const p = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
    time: hasTime ? `${p(d.getHours())}:${p(d.getMinutes())}` : "",
  };
}

/** Clave estable de un pendiente (para no avisar dos veces del mismo). */
export const taskId = (t: Task) => `${t.noteId}|${plain(t.text)}|${t.due?.getTime() ?? ""}`;
