// Paso 2 de la IA (pendientes como datos). Se prueba con scripts/ia: ver HANDOFF.

/** Hoy y los 7 días siguientes ("jueves, 19 de noviembre", …): las opciones de día para ai_tasks. */
export function nextDays() {
  const now = new Date();
  return Array.from({ length: 8 }, (_, i) =>
    new Date(now.getFullYear(), now.getMonth(), now.getDate() + i).toLocaleDateString("es-MX", {
      weekday: "long",
      day: "numeric",
      month: "long",
    }),
  );
}

export type AiTasks = {
  tipo_nota: "estudio" | "trabajo" | "personal";
  pendientes: {
    tarea: string;
    tipo: "compromiso" | "plan_libre" | "deseo" | "ya_hecho";
    dia: string;
    hora: string;
    prioridad?: "alta" | "normal";
  }[];
};
export const PENDING_SPLIT = /\n##\s*(?:📌\s*)?Pendientes[\s\S]*/;
const fold = (t: string) =>
  t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9ñ ]/g, "").trim();

/**
 * Paso 2 de la IA: cambia la sección "📌 Pendientes" que escribió el modelo por la que sale de
 * ai_tasks (JSON con opciones cerradas). Solo entran los compromisos, sin repetir, con horas que
 * sí están en el texto. En notas personales quita "💡 Para entender mejor".
 */
// Palabras con las que el usuario dice que algo es urgente o importante
const URGENT_RE = /\b(urgente|urge|importante|sin falta|no se me (puede|debe) olvidar|que no se me olvide|prioridad|asap|cuanto antes|lo antes posible)\b/;
const STOP = new Set(["para", "con", "del", "las", "los", "una", "uno", "que", "por", "mis", "tus", "sus", "hacer", "tarea"]);

/**
 * La IA marca "alta" de más (exámenes, citas…). Solo se acepta si en la MISMA oración de los apuntes
 * hay una palabra de urgencia y alguna palabra del pendiente ("no se me puede olvidar pagar la tarjeta").
 */
function saidUrgent(task: string, text: string) {
  const words = fold(task).split(" ").filter((w) => w.length > 3 && !STOP.has(w));
  return text
    .replace(/\[[^\]]*\]/g, "")
    .split(/[.!?\n]+/) // primero se parte en oraciones (fold quita los puntos)
    .map(fold)
    .some((sentence) => URGENT_RE.test(sentence) && words.some((w) => sentence.includes(w.slice(0, 5))));
}

export function mergeTasks(md: string, data: AiTasks, hours: string[], text = "") {
  // Palomitas fuera de "📌 Pendientes" (a veces el modelo las mete en "Martes", etc.): viñeta normal,
  // si no saldrían repetidas en la vista Pendientes
  let body = md.replace(PENDING_SPLIT, "").trimEnd().replace(/^(\s*[-*+]\s+)\[[ xX]\]\s*/gm, "$1");
  if (data.tipo_nota === "personal") body = body.replace(/\n##\s*💡[^\n]*\n(?:(?!\n## )[\s\S])*/, "").trimEnd();
  const compromisos = data.pendientes.filter((p) => p.tipo === "compromiso");
  const names = new Set(compromisos.map((p) => fold(p.tarea)));
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const p of compromisos) {
    const key = fold(p.tarea);
    // "Estudiar para el examen de X" cuando ya está "Examen de X": lo inventó el modelo
    const prep = key.match(/^(?:estudiar|repasar|prepararme|prepararse) (?:para |por )?(?:el |la |los |las )?(.+)/);
    if (!key || seen.has(key) || (prep && names.has(prep[1]))) continue;
    seen.add(key);
    let task = p.tarea.replace(/\s*#[\p{L}\w-]+/gu, "").trim().replace(/\.$/, "");
    task = task.charAt(0).toUpperCase() + task.slice(1);
    const hour = hours.includes(p.hora) ? p.hora : "";
    if (p.prioridad === "alta" && saidUrgent(p.tarea, text)) task = `🔴 ${task}`;
    lines.push(p.dia === "sin fecha" ? `- [ ] ${task}` : `- [ ] ${task} — **${p.dia}${hour ? `, ${hour}` : ""}**`);
  }
  return lines.length ? `${body}\n\n## 📌 Pendientes\n${lines.join("\n")}` : body;
}
