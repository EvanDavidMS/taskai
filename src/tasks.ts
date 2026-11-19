// Pendientes de todas las notas: se leen de la versión ordenada ("- [ ] texto — **viernes, 20 de noviembre, 2:00 AM**").
// Las fechas las escribe la IA a partir de las que calculó el código, así que vienen en un formato fijo.

export type Task = {
  noteId: string;
  idx: number; // número de palomita dentro de la nota (mismo orden que toggleTask)
  text: string;
  done: boolean;
  due: Date | null; // fecha (y hora, si hasTime)
  hasTime: boolean;
};

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
    const raw = m[4].trim();
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

/** Clave estable de un pendiente (para no avisar dos veces del mismo). */
export const taskId = (t: Task) => `${t.noteId}|${plain(t.text)}|${t.due?.getTime() ?? ""}`;
