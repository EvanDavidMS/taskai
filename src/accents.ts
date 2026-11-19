// Color principal de la app. Cada color trae su versión para modo oscuro y para modo claro
// (en claro van un poco más oscuros para que se lean sobre fondo blanco).
// Los valores son "R G B" porque el CSS los usa como rgb(var(--acc) / opacidad).

export type Accent = {
  id: string;
  name: string;
  dark: string; // color en modo oscuro
  light: string; // color en modo claro
  onDark?: string; // texto encima del color (por defecto blanco)
  onLight?: string;
};

const BLACK_TEXT = "20 20 22";

export const ACCENTS: Accent[] = [
  { id: "naranja", name: "Naranja", dark: "255 106 61", light: "228 87 46" },
  { id: "rojo", name: "Rojo", dark: "239 68 68", light: "220 38 38" },
  { id: "rosa", name: "Rosa", dark: "244 114 182", light: "219 39 119" },
  { id: "morado", name: "Morado", dark: "168 85 247", light: "147 51 234" },
  { id: "azul", name: "Azul", dark: "59 130 246", light: "37 99 235" },
  { id: "turquesa", name: "Turquesa", dark: "45 212 191", light: "13 148 136", onDark: BLACK_TEXT },
  { id: "verde", name: "Verde", dark: "74 222 128", light: "22 163 74", onDark: BLACK_TEXT },
  { id: "amarillo", name: "Amarillo", dark: "250 204 21", light: "202 138 4", onDark: BLACK_TEXT },
  { id: "gris", name: "Gris", dark: "161 161 170", light: "82 82 91", onDark: BLACK_TEXT },
  // Blanco sobre fondo blanco (o negro sobre negro) no se vería: en ese modo usan un gris muy oscuro o muy claro.
  { id: "blanco", name: "Blanco", dark: "244 244 245", light: "63 63 70", onDark: BLACK_TEXT },
  { id: "negro", name: "Negro", dark: "212 212 216", light: "24 24 27", onDark: BLACK_TEXT },
];

const KEY = "taskai.accent";

export function savedAccent(): string {
  try {
    return localStorage.getItem(KEY) || "naranja";
  } catch {
    return "naranja";
  }
}

/** Aplica el color a toda la app (y lo recuerda). */
export function applyAccent(id: string) {
  const a = ACCENTS.find((x) => x.id === id) ?? ACCENTS[0];
  const root = document.documentElement;
  root.style.setProperty("--acc", a.dark);
  root.style.setProperty("--acc-l", a.light);
  root.style.setProperty("--on-acc", a.onDark ?? "255 255 255");
  root.style.setProperty("--on-acc-l", a.onLight ?? "255 255 255");
  root.dataset.accent = a.id;
  try {
    localStorage.setItem(KEY, a.id);
  } catch {
    /* sin almacenamiento */
  }
}
