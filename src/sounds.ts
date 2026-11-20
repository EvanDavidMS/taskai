// Sonidos de TaskAI (archivos en public/sounds/). Se usa Web Audio para que suenen al instante
// (el de las teclas tiene que ir pegado al dedo). Se apagan en Configuración → General → Sonidos.

export type SoundName = "tecla" | "palomita" | "ordenada" | "papelera" | "recordatorio";

/** Volumen de cada sonido (0 a 1). El de las teclas va bajito para no cansar. */
const VOLUME: Record<SoundName, number> = {
  tecla: 0.3,
  palomita: 0.55,
  ordenada: 0.35,
  papelera: 0.5,
  recordatorio: 0.8,
};

export type SoundPrefs = { on: boolean; keys: boolean };
const KEY = "taskai.sounds";

export function loadSoundPrefs(): SoundPrefs {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return { on: p.on !== false, keys: p.keys !== false };
  } catch {
    return { on: true, keys: true };
  }
}
let prefs = loadSoundPrefs();
export function saveSoundPrefs(p: SoundPrefs) {
  prefs = p;
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* sin almacenamiento: se queda para esta sesión */
  }
}

let ctx: AudioContext | null = null;
const buffers = new Map<SoundName, Promise<AudioBuffer | null>>();

function audio(): AudioContext | null {
  if (!ctx) {
    try {
      ctx = new AudioContext();
    } catch {
      return null;
    }
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

function load(name: SoundName): Promise<AudioBuffer | null> {
  let b = buffers.get(name);
  if (!b) {
    const c = audio();
    b = c
      ? fetch(`/sounds/${name}.mp3`)
          .then((r) => r.arrayBuffer())
          .then((data) => c.decodeAudioData(data))
          .catch(() => null)
      : Promise.resolve(null);
    buffers.set(name, b);
  }
  return b;
}

/** Carga todos los sonidos de una vez (para que el primero no llegue tarde). */
export function preloadSounds() {
  (Object.keys(VOLUME) as SoundName[]).forEach((n) => void load(n));
}

let lastKey = 0;

/** Toca un sonido (si el usuario no los apagó). */
export async function play(name: SoundName) {
  if (!prefs.on || (name === "tecla" && !prefs.keys)) return;
  if (name === "tecla") {
    const now = performance.now();
    // Tope de seguridad: dejando una tecla apretada el sistema repite cada ~25-40 ms y cada repetición
    // suena; solo se descartan disparos casi simultáneos (dos eventos para la misma tecla).
    if (now - lastKey < 15) return;
    lastKey = now;
  }
  const c = audio();
  const buf = await load(name);
  if (!c || !buf) return;
  const src = c.createBufferSource();
  src.buffer = buf;
  // Cada tecla suena un poquito distinta, como un teclado de verdad
  if (name === "tecla") src.playbackRate.value = 0.94 + Math.random() * 0.12;
  const gain = c.createGain();
  gain.gain.value = VOLUME[name];
  src.connect(gain).connect(c.destination);
  src.start();
}

/**
 * Para el editor: suena con las teclas que escriben (no con Ctrl+algo, flechas, etc.).
 * También con la tecla apretada (cada letra repetida y cada letra borrada suena), pero
 * Backspace/Supr ya no suenan cuando no queda nada que borrar.
 */
export function keySound(e: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  currentTarget?: EventTarget | null;
}) {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const el = e.currentTarget;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    const { selectionStart: a, selectionEnd: b, value } = el;
    const nothingSelected = a === b;
    if (e.key === "Backspace" && nothingSelected && a === 0) return;
    if (e.key === "Delete" && nothingSelected && a === value.length) return;
  }
  if (e.key.length === 1 || e.key === "Backspace" || e.key === "Enter" || e.key === "Delete" || e.key === "Tab") {
    void play("tecla");
  }
}

/** ¿Cuántos pendientes palomeados hay en un Markdown? (para saber si se palomeó o se despalomeó) */
export const doneCount = (md: string) => (md.match(/^\s*[-*] \[[xX]\]/gm) ?? []).length;
