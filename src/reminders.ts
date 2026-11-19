// Recordatorios: avisos de Windows (o del sistema) para los pendientes con fecha.
// Funcionan mientras TaskAI esté abierta, aunque esté minimizada.
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { type Task, taskId, whenLabel } from "./tasks";

export type RemindPrefs = { on: boolean; lead: number }; // lead = minutos de anticipación

const PREFS_KEY = "taskai.remind";
const SENT_KEY = "taskai.notified";

export function loadRemind(): RemindPrefs {
  try {
    return { on: true, lead: 10, ...JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") };
  } catch {
    return { on: true, lead: 10 };
  }
}
export function saveRemind(p: RemindPrefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* sin almacenamiento */
  }
}

function loadSent(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(SENT_KEY) || "{}");
  } catch {
    return {};
  }
}
function saveSent(s: Record<string, number>) {
  const old = Date.now() - 4 * 86400000; // olvida los avisos de hace más de 4 días
  for (const k of Object.keys(s)) if (s[k] < old) delete s[k];
  try {
    localStorage.setItem(SENT_KEY, JSON.stringify(s));
  } catch {
    /* sin almacenamiento */
  }
}

async function canNotify() {
  if (await isPermissionGranted()) return true;
  return (await requestPermission()) === "granted";
}

export async function notify(title: string, body: string) {
  if (await canNotify()) sendNotification({ title, body });
}

const ymd = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
const sameDay = (a: Date, b: Date) => ymd(a) === ymd(b);

/**
 * Se llama cada 30 s. Avisa:
 *  - de cada pendiente con hora, `lead` minutos antes (y otra vez no);
 *  - una vez al día (desde las 8:00 AM) con el resumen de lo que hay para hoy y lo atrasado.
 */
export async function checkReminders(tasks: Task[], noteTitle: (id: string) => string) {
  const prefs = loadRemind();
  if (!prefs.on) return;
  const now = new Date();
  const sent = loadSent();
  const open = tasks.filter((t) => !t.done && t.due);
  const out: { title: string; body: string }[] = [];

  for (const t of open) {
    if (!t.hasTime || !t.due) continue;
    const due = t.due.getTime();
    const key = taskId(t);
    if (sent[key] || now.getTime() < due - prefs.lead * 60000 || now.getTime() > due + 30 * 60000) continue;
    const mins = Math.round((due - now.getTime()) / 60000);
    out.push({
      title: mins > 0 ? `En ${mins} min: ${t.text}` : `Ahora: ${t.text}`,
      body: `${whenLabel(t)} · ${noteTitle(t.noteId)}`,
    });
    sent[key] = Date.now();
  }

  const summaryKey = `resumen|${ymd(now)}`;
  if (!sent[summaryKey] && now.getHours() >= 8) {
    const today = open.filter((t) => t.due && sameDay(t.due, now));
    const late = open.filter((t) => t.due && t.due < new Date(now.getFullYear(), now.getMonth(), now.getDate()));
    if (today.length || late.length) {
      const names = today.slice(0, 3).map((t) => `• ${t.text}`);
      if (today.length > 3) names.push(`y ${today.length - 3} más`);
      if (late.length) names.push(`⚠ ${late.length} atrasado${late.length > 1 ? "s" : ""}`);
      out.push({
        title: today.length ? `Hoy tienes ${today.length} pendiente${today.length > 1 ? "s" : ""}` : "Tienes pendientes atrasados",
        body: names.join("\n"),
      });
      sent[summaryKey] = Date.now();
    }
  }

  if (!out.length) return;
  saveSent(sent);
  for (const n of out) await notify(n.title, n.body);
}
