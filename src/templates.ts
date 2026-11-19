// Plantilla de las notas nuevas de "Diario". La nota la crea Rust (`create_note` en lib.rs) con estas
// preguntas; aquí solo se usan para saber qué quedó sin contestar.
// Misma lista que DIARY_PROMPTS en src-tauri/src/lib.rs: si cambias una, cambia la otra.
export const DIARY_FOLDER = "Diario";
export const DIARY_PROMPTS = ["Cómo me sentí:", "Lo mejor del día:", "Lo que aprendí o pensé:", "Mañana quiero:"];

const isPrompt = (l: string) => DIARY_PROMPTS.includes(l.trim());

/** Quita las preguntas sin contestar (la pregunta sola, seguida de otra pregunta o del final). */
export function stripEmptyPrompts(s: string): string {
  const lines = s.split("\n");
  return lines
    .filter((l, i) => {
      if (!isPrompt(l)) return true;
      const next = lines.slice(i + 1).find((n) => n.trim());
      return next !== undefined && !isPrompt(next);
    })
    .join("\n");
}

/** ¿La nota no tiene nada escrito? (Una plantilla de Diario sin contestar cuenta como vacía.) */
export const isBlankText = (s: string) => !stripEmptyPrompts(s).trim();
