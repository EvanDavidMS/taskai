import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ClipboardEvent as ReactClipboardEvent, CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { marked } from "marked";
import DOMPurify from "dompurify";
import Settings from "./Settings";
import Onboarding from "./Onboarding";
import { applyAccent, savedAccent } from "./accents";
import { FolderTag, Icon, Logo, folderLook } from "./icons";
import { listen } from "@tauri-apps/api/event";
import { type Task, formatWhen, groupOf, parseTasks, parseWhen, setTaskWhen, whenLabel } from "./tasks";
import { checkReminders } from "./reminders";
import TasksView, { type WhenValue } from "./TasksView";
import TrashView from "./TrashView";
import type { Update } from "@tauri-apps/plugin-updater";
import { UpdateBanner, findUpdate } from "./Updater";
import { mdToText, printPdf, saveMarkdown } from "./exporter";
import "./App.css";

type NoteMeta = {
  id: string;
  folder: string;
  title: string;
  preview: string;
  modified: number;
  tags: string[];
  locked: boolean;
  pinned: boolean;
  favorite: boolean;
};
type Note = { content: string; structured: string; title: string };

// Imágenes pegadas con Ctrl + V: en el texto quedan como ![imagen](img/<nombre>)
const IMG_RE = /!\[[^\]]*\]\(img\/([\w.-]+)\)/g;
const imagesIn = (s: string) => [...s.matchAll(IMG_RE)].map((m) => m[1]);
/** Lo que se le manda a la IA: el texto sin las referencias a imágenes. */
const stripImages = (s: string) => s.replace(IMG_RE, "").replace(/\n{3,}/g, "\n\n").trim();
/** Clave para saber si algo cambió desde la última vez que ordenó la IA. */
const aiKeyOf = (title: string, text: string) => title.trim() + "\u0000" + text;

const imageCache = new Map<string, string>(); // nombre → URL blob, para no leer el disco dos veces
function useImageUrls(names: string[]) {
  const [, force] = useState(0);
  const key = names.join("|");
  useEffect(() => {
    let alive = true;
    for (const n of names) {
      if (imageCache.has(n)) continue;
      invoke<ArrayBuffer>("load_image", { name: n })
        .then((buf) => {
          imageCache.set(n, URL.createObjectURL(new Blob([buf])));
          if (alive) force((x) => x + 1);
        })
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return names.map((n) => ({ name: n, url: imageCache.get(n) }));
}

/** Miniaturas de las imágenes de la nota. Con `onRemove`, cada una trae su botón para quitarla. */
function NoteImages({ names, onRemove }: { names: string[]; onRemove?: (name: string) => void }) {
  const imgs = useImageUrls(names);
  const [big, setBig] = useState<string | null>(null);
  if (!names.length) return null;
  return (
    <>
      <div className={`note-imgs ${onRemove ? "editable" : ""}`}>
        {imgs.map(({ name, url }) => (
          <div key={name} className="note-img">
            {url ? (
              <img src={url} alt="Imagen pegada" onClick={() => setBig(url)} />
            ) : (
              <div className="note-img-loading" />
            )}
            {onRemove && (
              <button className="note-img-del" title="Quitar imagen" aria-label="Quitar imagen" onClick={() => onRemove(name)}>
                ×
              </button>
            )}
          </div>
        ))}
      </div>
      {big && (
        <div className="modal-wrap lightbox" onClick={() => setBig(null)}>
          <img src={big} alt="Imagen pegada" />
        </div>
      )}
    </>
  );
}
type FolderInfo = { name: string; count: number; builtin: boolean };
type Toast = { text: string; undo?: () => void };
type ThemePref = "system" | "light" | "dark";

type Section = "notes" | "tasks" | "trash" | "settings";
type SearchHit = { id: string; before: string; hit: string; after: string };
const SECTION_TITLE: Partial<Record<Section, string>> = {
  tasks: "Pendientes",
  trash: "Papelera",
  settings: "Configuración",
};
type AiState = "idle" | "waiting" | "working" | "done" | "error" | "off";

const AI_DELAY_MS = 3000; // la IA ordena cuando dejas de escribir 3 s
const SAVE_DELAY_MS = 500;
const MIN_CHARS = 20;

/** Fechas ya calculadas para la IA: los modelos chicos se equivocan contando días. */
function dateContext() {
  const fmt = (d: Date) => d.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });
  const now = new Date();
  const plus = (n: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + n);
  const calendar = Array.from({ length: 7 }, (_, i) => (i === 0 ? "mañana es " : "") + fmt(plus(i + 1))).join(", ");
  return { today: `${fmt(now)} de ${now.getFullYear()}`, tomorrow: fmt(plus(1)), calendar };
}

const DAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const plain = (w: string) => w.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/** "1:00 PM" a partir de hora y minutos (0-23). */
function clock(h: number, m: number) {
  const pm = h >= 12;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${pm ? "PM" : "AM"}`;
}

/**
 * Calcula la hora real de "a la 1", "a las 8pm", "a las 7 de la noche", "en la tarde a la 1"…
 * Si no hay pista (ej. "a las 9"), no la toca: mejor no adivinar.
 */
function hourFor(h: number, suffix: string, before: string): number | null {
  if (h > 23) return null;
  if (h >= 13) return h; // ya viene en 24 h
  const s = plain(suffix).replace(/[\s.]/g, "");
  if (/^(pm|p)/.test(s) || /tarde|noche/.test(s)) return h === 12 ? 12 : h + 12;
  if (/^(am|a)/.test(s) || /manana|madrugada/.test(s)) return h === 12 ? 0 : h;
  // contexto previo: "en la tarde a la 1", "por la noche a las 9"
  const ctx = plain(before).match(/(?:la|las)\s+(manana|tarde|noche|madrugada)[^.]*$/);
  if (ctx) return hourFor(h, ctx[1], "");
  if (h >= 1 && h <= 6) return h + 12; // "a la 1", "a las 3": casi siempre es de tarde
  return null;
}

const TIME_RE =
  /\b(?:(a\s+las?)\s+(\d{1,2})(?::(\d{2}))?|(\d{1,2})(?::(\d{2}))?(?=\s*(?:am|pm|a\.\s?m\.|p\.\s?m\.)))(\s*(?:am|pm|a\.\s?m\.|p\.\s?m\.)|\s+de\s+la\s+(?:mañana|manana|tarde|noche|madrugada))?/gi;

/**
 * Pega la fecha y hora reales a "mañana", "el viernes", "a la 1"… solo en el texto que se
 * manda a la IA (los modelos chicos se equivocan haciendo cuentas). Devuelve también las
 * anotaciones para borrarlas de la respuesta si la IA las copia.
 */
function annotateDates(text: string) {
  const now = new Date();
  const plus = (n: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + n);
  const full = (d: Date) => d.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });
  const notes: string[] = [];
  const tag = (n: string) => (notes.push(n), ` [${n}]`);

  // 1) Horas
  let out = text.replace(TIME_RE, (m, _pre, h1, m1, h2, m2, suffix = "", offset: number) => {
    const h = Number(h1 ?? h2);
    const min = Number(m1 ?? m2 ?? 0);
    const hour = hourFor(h, suffix, text.slice(Math.max(0, offset - 40), offset));
    return hour == null || min > 59 ? m : m + tag(clock(hour, min));
  });

  // 2) Días
  out = out.replace(/[\p{L}]+/gu, (word, offset: number) => {
    const w = plain(word);
    const before = plain(out.slice(Math.max(0, offset - 12), offset));
    if (w === "manana") {
      if (/(la|esta|cada|las)\s+$/.test(before)) return word; // "en la mañana", "esta mañana"
      return word + tag(full(plus(/pasado\s+$/.test(before) ? 2 : 1)));
    }
    const dow = DAYS.findIndex((d) => plain(d) === w);
    if (dow >= 0) {
      const diff = (dow - now.getDay() + 7) % 7;
      // "este miércoles" dicho en miércoles = hoy; "el miércoles" = el de la próxima semana
      return word + tag(full(plus(diff === 0 && !/(este|hoy)\s+$/.test(before) ? 7 : diff)));
    }
    return word;
  });
  return { text: out, notes };
}

/** Deja todas las horas de la respuesta como "1:00 PM" (la IA a veces escribe "13:00 PM"). */
function normalizeTimes(md: string) {
  return md.replace(/\b(\d{1,2}):(\d{2})(\s*(?:AM|PM|a\.\s?m\.|p\.\s?m\.))?/gi, (m, h, min, suf) => {
    const hour = Number(h);
    if (hour > 23 || Number(min) > 59) return m;
    if (hour >= 13) return clock(hour, Number(min)); // 13:00 o 13:00 PM → 1:00 PM
    if (suf) return clock(/p/i.test(suf) ? (hour % 12) + 12 : hour % 12, Number(min));
    return m; // "9:00" sin pista: no adivinar
  });
}

/** Quita de la respuesta las anotaciones [..] que la IA haya copiado. */
function stripNotes(md: string, notes: string[]) {
  for (const n of new Set(notes)) md = md.split(` [${n}]`).join("").split(`[${n}]`).join("");
  return md;
}

const TASK_RE = /^(\s*[-*+]\s+\[)([ xX])(\])(.*)$/gm;
const taskKey = (t: string) =>
  plain(t.replace(/\*\*/g, "").split(" — ")[0]).replace(/[^a-z0-9 ]/g, "").trim();

/** Marca o desmarca el pendiente número `idx` en el Markdown. */
function toggleTask(md: string, idx: number) {
  let i = -1;
  return md.replace(TASK_RE, (m, a, c, b, rest) => (++i === idx ? a + (c === " " ? "x" : " ") + b + rest : m));
}

/** Al reordenar, conserva las palomitas de los pendientes que ya habías marcado. */
function carryChecks(oldMd: string, newMd: string) {
  const done = new Set<string>();
  for (const m of oldMd.matchAll(TASK_RE)) if (m[2] !== " ") done.add(taskKey(m[4]));
  if (!done.size) return newMd;
  return newMd.replace(TASK_RE, (m, a, _c, b, rest) => (done.has(taskKey(rest)) ? a + "x" + b + rest : m));
}

/**
 * Markdown → HTML seguro. Los pendientes "texto — **fecha**" se pintan como en la vista Pendientes:
 * renglón con círculo, texto y la fecha en una pastilla (roja si ya pasó, de tu color si es hoy).
 */
function renderMd(md: string) {
  const html = DOMPurify.sanitize(marked.parse(md, { async: false }) as string).replace(/ disabled=""/g, "");
  return html.replace(
    /(<li>\s*<input[^>]*type="checkbox"[^>]*>)([\s\S]*?)\s+—\s+<strong>([^<]+)<\/strong>\s*<\/li>/g,
    (_m, box: string, text: string, when: string) => {
      const p = parseWhen(when);
      const t: Task | null = p ? { noteId: "", idx: 0, text: "", done: false, due: p.due, hasTime: p.hasTime } : null;
      const label = t ? whenLabel(t) : when;
      const g = t ? groupOf(t) : "none";
      return `${box}<span class="ttext">${text.trim()}</span><span class="twhen g-${g}">${label}</span></li>`;
    },
  );
}

function timeAgo(secs: number) {
  const diff = Date.now() / 1000 - secs;
  if (diff < 60) return "ahora";
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`;
  return new Date(secs * 1000).toLocaleDateString("es-MX", { day: "numeric", month: "short" });
}

/** "¿Estás seguro?" propio. El foco empieza en Cancelar para que un Enter por accidente no borre nada. */
function ConfirmDialog(props: { title: string; text: string; ok: string; run: () => void; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props]);
  return (
    <div className="modal-wrap" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="confirm" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
        <div className="confirm-icon" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M10 11v6M14 11v6" />
          </svg>
        </div>
        <h2 id="confirm-title">{props.title}</h2>
        <p>{props.text}</p>
        <div className="confirm-actions">
          <button className="btn ghost" autoFocus onClick={props.onClose}>
            Cancelar
          </button>
          <button
            className="btn danger"
            onClick={() => {
              props.run();
              props.onClose();
            }}
          >
            {props.ok}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [notes, setNotes] = useState<NoteMeta[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [structured, setStructured] = useState("");
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState<string>(() => localStorage.getItem("taskai.model") ?? "");
  const [ai, setAi] = useState<AiState>("idle");
  const [power, setPower] = useState<"idle" | "starting" | "stopping">("idle"); // encendiendo/apagando Ollama
  const [ollamaInstalled, setOllamaInstalled] = useState(true);
  const startedRef = useRef(false); // el auto-encendido solo una vez por sesión
  const [aiError, setAiError] = useState("");
  const [listOpen, setListOpen] = useState(false); // cajón de notas en pantallas angostas
  const [view, setView] = useState<"raw" | "ai">("raw"); // pestaña activa en pantallas angostas
  const [folders, setFolders] = useState<FolderInfo[]>([]);
  const [folderFilter, setFolderFilter] = useState<string | null>(null);
  const [newFolder, setNewFolder] = useState<string | null>(null); // input de nueva carpeta
  const [moveOpen, setMoveOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  // Arrastrar una tarjeta a una carpeta del menú
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropFolder, setDropFolder] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [accent, setAccent] = useState(savedAccent); // color principal (Configuración → Apariencia)
  const [sortBy, setSortBy] = useState<"recent" | "az">("recent"); // orden de las tarjetas del tablero
  // Búsqueda en todo el texto (la hace el backend); null = sin búsqueda o esperando respuesta
  const [hits, setHits] = useState<Map<string, SearchHit> | null>(null);
  const [section, setSection] = useState<Section>("notes"); // qué muestra el área principal sin nota abierta
  const [structMap, setStructMap] = useState<Record<string, string>>({}); // versiones ordenadas (para Pendientes)
  const [streamText, setStreamText] = useState(""); // lo que la IA va escribiendo en vivo
  const streamIdRef = useRef<string | null>(null);
  const streamNotesRef = useRef<string[]>([]);
  const [title, setTitle] = useState(""); // título opcional que escribe el usuario
  // Modo lectura: esconde el editor y deja solo la versión ordenada (se recuerda entre sesiones)
  const [reading, setReading] = useState(() => {
    try {
      return localStorage.getItem("taskai.read") === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("taskai.read", reading ? "1" : "0");
    } catch {
      /* sin almacenamiento */
    }
  }, [reading]);
  const titleRef = useRef("");
  titleRef.current = title;
  // Diálogo "¿Seguro?" propio (en vez del confirm() nativo)
  const [ask, setAsk] = useState<{ title: string; text: string; ok: string; run: () => void } | null>(null);
  const [onboarded, setOnboarded] = useState<boolean | null>(null); // null = cargando
  const [userName, setUserName] = useState("");
  const [libHidden, setLibHidden] = useState(() => {
    try {
      return localStorage.getItem("taskai.focus") === "1";
    } catch {
      return false;
    }
  });
  const structuredRef = useRef("");
  structuredRef.current = structured;
  const [theme, setTheme] = useState<ThemePref>(() => {
    try {
      return (localStorage.getItem("taskai.theme") as ThemePref) || "system";
    } catch {
      return "system";
    }
  });

  // Tema: claro / oscuro / el del sistema (y lo sigue si cambia)
  useEffect(() => {
    try {
      localStorage.setItem("taskai.theme", theme);
    } catch {
      /* sin almacenamiento: no pasa nada */
    }
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const apply = () => {
      document.documentElement.dataset.theme = theme === "system" ? (mq.matches ? "light" : "dark") : theme;
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);

  const lastSent = useRef(""); // último texto que ya ordenó la IA
  const activeRef = useRef<string | null>(null);
  activeRef.current = activeId;
  const notesRef = useRef<NoteMeta[]>([]);
  notesRef.current = notes;

  const refresh = useCallback(async () => {
    const [n, f, s] = await Promise.all([
      invoke<NoteMeta[]>("list_notes"),
      invoke<FolderInfo[]>("list_folders"),
      invoke<Record<string, string>>("all_structured"),
    ]);
    setNotes(n);
    setFolders(f);
    setStructMap(s);
  }, []);

  /** Guarda la versión ordenada de una nota y la deja al día en la vista Pendientes. */
  async function putStructured(id: string, md: string) {
    setStructMap((m) => ({ ...m, [id]: md }));
    await invoke("save_structured", { id, content: md });
  }

  // Todos los pendientes de todas las notas (se recalculan al cambiar de día con `now`)
  const tasks = useMemo(
    () => Object.entries(structMap).flatMap(([id, md]) => parseTasks(id, md)),
    [structMap],
  );
  const tasksRef = useRef<Task[]>([]);
  tasksRef.current = tasks;

  // Buscar en todo el texto (título, apuntes y versión ordenada), un instante después de teclear
  useEffect(() => {
    const q = search.trim();
    if (!q) {
      setHits(null);
      return;
    }
    let alive = true;
    const t = setTimeout(() => {
      invoke<SearchHit[]>("search_notes", { query: q })
        .then((r) => alive && setHits(new Map(r.map((h) => [h.id, h]))))
        .catch(() => {});
    }, 150);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [search, notes]);

  // Recordatorios: revisa cada 30 s si toca avisar de algo (mientras la app esté abierta)
  useEffect(() => {
    if (!onboarded) return;
    const titleOf = (id: string) => notesRef.current.find((n) => n.id === id)?.title ?? "TaskAI";
    const run = () => {
      if (notesRef.current.length) checkReminders(tasksRef.current, titleOf).catch(() => {});
    };
    const first = setTimeout(run, 4000);
    const t = setInterval(run, 30000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [onboarded]);

  // Streaming: la IA manda su respuesta en pedacitos y aquí se va mostrando
  useEffect(() => {
    const off = listen<{ id: string; text: string }>("ai-stream", (e) => {
      if (e.payload.id === streamIdRef.current) setStreamText(e.payload.text);
    });
    return () => {
      off.then((f) => f());
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  async function moveTo(id: string, to: string, manual: boolean) {
    await invoke("move_note", { id, folder: to, manual });
    await refresh();
  }

  async function addFolder() {
    const name = (newFolder ?? "").trim();
    setNewFolder(null);
    if (!name) return;
    try {
      const created = await invoke<string>("create_folder", { name });
      await refresh();
      setFolderFilter(created);
    } catch (e) {
      setToast({ text: String(e) });
    }
  }

  async function removeFolder(name: string) {
    try {
      await invoke("delete_folder", { name });
      if (folderFilter === name) setFolderFilter(null);
      await refresh();
    } catch (e) {
      setToast({ text: String(e) });
    }
  }

  const checkAi = useCallback(async () => {
    try {
      const list = await invoke<string[]>("ai_models");
      setModels(list);
      setModel((m) => (m && list.includes(m) ? m : list[0] ?? ""));
      setAi((s) => (s === "off" ? "idle" : s));
    } catch {
      setModels([]);
      setAi("off");
      invoke<{ installed: boolean }>("ollama_status").then((s) => setOllamaInstalled(s.installed));
    }
  }, []);

  /** Enciende o apaga Ollama desde TaskAI. */
  const setAiPower = useCallback(
    async (on: boolean) => {
      setPower(on ? "starting" : "stopping");
      try {
        const res = await invoke<string | null>(on ? "ollama_start" : "ollama_stop");
        if (on) await checkAi();
        else {
          setModels([]);
          setAi("off");
        }
        setToast({
          text: on
            ? "IA encendida"
            : res === "FREED"
              ? "IA en pausa: se liberó la memoria de tu tarjeta de video (Ollama lo abrió otro programa, así que sigue abierto)"
              : "IA apagada: se liberó la memoria de tu tarjeta de video",
        });
      } catch (e) {
        const msg = String(e);
        setToast({ text: msg.includes("NOT_INSTALLED") ? "Primero instala Ollama (Configuración → Inteligencia artificial)" : msg });
        await checkAi();
      } finally {
        setPower("idle");
      }
    },
    [checkAi],
  );

  // Actualizaciones: revisa en GitHub unos segundos después de abrir (sin estorbar el arranque)
  const [update, setUpdate] = useState<Update | null>(null);
  useEffect(() => {
    if (!onboarded) return;
    const t = setTimeout(() => findUpdate().then(setUpdate), 6000);
    return () => clearTimeout(t);
  }, [onboarded]);
  /** Para el botón de Configuración: "found" muestra el aviso. */
  async function checkUpdatesNow(): Promise<"found" | "none"> {
    const u = await findUpdate();
    setUpdate(u);
    return u ? "found" : "none";
  }

  const loadAll = useCallback(async () => {
    const cfg = await invoke<{ name: string; onboarded: boolean; start_ai_on_open: boolean }>("get_config");
    setUserName(cfg.name);
    setOnboarded(cfg.onboarded);
    if (!cfg.onboarded) return;
    await invoke("discard_blank_notes").catch(() => {}); // notas vacías que quedaron de antes
    refresh();
    // Enciende la IA sola al abrir TaskAI (si está instalada y el usuario no lo desactivó)
    if (cfg.start_ai_on_open && !startedRef.current) {
      startedRef.current = true;
      const st = await invoke<{ installed: boolean; running: boolean }>("ollama_status");
      setOllamaInstalled(st.installed);
      if (st.installed && !st.running) {
        setPower("starting");
        await invoke("ollama_start").catch(() => {});
        setPower("idle");
      }
    }
    checkAi();
  }, [refresh, checkAi]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (model) localStorage.setItem("taskai.model", model);
  }, [model]);

  /** Guarda ya mismo la nota abierta (sin esperar al guardado automático) antes de salir de ella. */
  async function flushNote() {
    if (!activeId) return;
    try {
      await invoke("save_note", { id: activeId, content });
      await invoke("set_title", { id: activeId, title });
      // Si la dejaste en blanco, no se queda guardada una "Nota sin título" vacía
      if (!content.trim() && !title.trim()) await invoke("discard_if_blank", { id: activeId });
    } catch {
      /* la nota ya no existe (la borraron): no hay nada que guardar */
    }
  }

  // Atajos de teclado (la lista visible está en Configuración → Atajos de teclado).
  // El manejador se renueva en cada render para usar siempre el estado actual.
  const keysRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keysRef.current = (e: KeyboardEvent) => {
    if (onboarded !== true) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (ctrl && k === "n") {
      e.preventDefault();
      newNote();
    } else if (ctrl && k === "k") {
      e.preventDefault();
      (async () => {
        if (section !== "notes" || activeId) await go("notes");
        requestAnimationFrame(() => document.querySelector<HTMLInputElement>(".board .search input")?.focus());
      })();
    } else if (ctrl && e.key === "Enter" && activeId) {
      e.preventDefault();
      if (model && ai !== "working" && aiText.length >= MIN_CHARS) runAi(aiText, activeId);
    } else if (ctrl && k === "e" && activeId) {
      e.preventDefault();
      setReading((r) => !r);
    } else if (ctrl && e.key === ",") {
      e.preventDefault();
      go("settings");
    } else if (e.key === "Escape" && !ask && !moveOpen && !document.querySelector(".lightbox")) {
      if (listOpen) setListOpen(false);
      else if (activeId) goHome();
      else if (section !== "notes") go("notes");
      else if (search) setSearch("");
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keysRef.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /** Cambia de sección (Notas, Pendientes, Papelera, Configuración); cierra la nota abierta. */
  async function go(s: Section) {
    setSection(s);
    setListOpen(false);
    if (activeId) await goHome();
  }

  /** Cierra la nota y vuelve al tablero de tarjetas. */
  async function goHome() {
    await flushNote();
    setActiveId(null);
    setContent("");
    setTitle("");
    setStructured("");
    setListOpen(false);
    refresh();
  }

  async function openNote(id: string) {
    if (activeId && activeId !== id) await flushNote();
    const n = await invoke<Note>("read_note", { id });
    setActiveId(id);
    setListOpen(false);
    setView("raw");
    setContent(n.content);
    setTitle(n.title);
    setStructured(n.structured);
    lastSent.current = n.structured ? aiKeyOf(n.title, stripImages(n.content)) : "";
    setAi(models.length ? (n.structured ? "done" : "idle") : "off");
  }

  const creatingRef = useRef(false); // evita crear dos notas con un doble clic

  /**
   * Nueva nota, sin crear notas vacías de más:
   *  - si ya estás en una nota en blanco, solo te deja escribir en ella;
   *  - si hay otra nota en blanco guardada, abre esa en vez de crear otra.
   */
  async function newNote() {
    if (creatingRef.current) return;
    const focusEditor = () =>
      requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(".editor textarea")?.focus());
    if (activeId && !content.trim() && !title.trim()) {
      setReading(false);
      focusEditor();
      setToast({ text: "Ya tienes una nota en blanco abierta: escribe aquí ✍" });
      return;
    }
    creatingRef.current = true;
    try {
      const blank = notes.find((n) => n.id !== activeId && !n.preview && n.title === "Nota sin título" && !n.pinned);
      if (blank) {
        await openNote(blank.id);
      } else {
        const id = await invoke<string>("create_note", { folder: folderFilter });
        await refresh();
        await openNote(id);
      }
      setReading(false);
      focusEditor();
    } finally {
      creatingRef.current = false;
    }
  }

  function askRemoveNote(id: string, title: string) {
    setAsk({
      title: "¿Mandar a la papelera?",
      text: `“${title}” se va a la papelera. Puedes recuperarla durante 30 días.`,
      ok: "Sí, a la papelera",
      run: async () => {
        await invoke("delete_note", { id });
        if (id === activeId) {
          setActiveId(null);
          setContent("");
          setTitle("");
          setStructured("");
        }
        refresh();
        setToast({
          text: "Nota enviada a la papelera",
          undo: async () => {
            await invoke("restore_note", { id });
            refresh();
          },
        });
      },
    });
  }

  // Guardado automático
  useEffect(() => {
    if (!activeId) return;
    const t = setTimeout(async () => {
      await invoke("save_note", { id: activeId, content });
      await invoke("set_title", { id: activeId, title });
      refresh();
    }, SAVE_DELAY_MS);
    return () => clearTimeout(t);
  }, [content, title, activeId, refresh]);

  // Ctrl + V con una imagen: se guarda aparte y en el texto queda su referencia en una línea propia.
  async function onPaste(e: ReactClipboardEvent<HTMLTextAreaElement>) {
    const file = [...e.clipboardData.items].find((i) => i.type.startsWith("image/"))?.getAsFile();
    if (!file) return; // texto normal: que el navegador lo pegue
    e.preventDefault();
    const ta = e.currentTarget;
    const before = ta.value.slice(0, ta.selectionStart);
    const after = ta.value.slice(ta.selectionEnd);
    try {
      const ext = (file.type.split("/")[1] || "png").replace("jpeg", "jpg");
      const name = await invoke<string>("save_image", new Uint8Array(await file.arrayBuffer()), {
        headers: { "x-ext": ext },
      });
      const token = `${before && !before.endsWith("\n") ? "\n" : ""}![imagen](img/${name})${after.startsWith("\n") ? "" : "\n"}`;
      setContent(before + token + after);
      const caret = before.length + token.length;
      requestAnimationFrame(() => ta.setSelectionRange(caret, caret));
    } catch (err) {
      setToast({ text: `No se pudo pegar la imagen: ${err}` });
    }
  }

  function removeImage(name: string) {
    setContent((c) =>
      c
        .split("\n")
        .filter((l) => !l.includes(`](img/${name})`))
        .join("\n"),
    );
  }

  const runAi = useCallback(
    async (text: string, id: string) => {
      if (!model) return;
      setAi("working");
      setAiError("");
      const userTitle = titleRef.current.trim();
      try {
        const ann = annotateDates(text);
        streamIdRef.current = id;
        streamNotesRef.current = ann.notes;
        setStreamText("");
        let fresh: string;
        try {
          fresh = normalizeTimes(
            stripNotes(await invoke<string>("ai_structure", { id, text: ann.text, model, ...dateContext() }), ann.notes),
          );
        } finally {
          streamIdRef.current = null;
          setStreamText("");
        }
        // Si el usuario puso título, ese manda sobre el que inventó la IA.
        if (userTitle) {
          fresh = /^# .*/m.test(fresh) ? fresh.replace(/^# .*/m, `# ${userTitle}`) : `# ${userTitle}\n\n${fresh}`;
        }
        const out = activeRef.current === id ? carryChecks(structuredRef.current, fresh) : fresh;
        await putStructured(id, out);
        lastSent.current = aiKeyOf(userTitle, text);
        if (activeRef.current === id) {
          setStructured(out);
          setAi("done");
        }

        // La IA decide la carpeta, salvo que el usuario ya la haya movido a mano
        const meta = notesRef.current.find((n) => n.id === id);
        if (meta && !meta.locked) {
          const to = await invoke<string>("ai_classify", {
            text: userTitle ? `Título: ${userTitle}\n\n${text}` : text,
            model,
          });
          if (to !== meta.folder) {
            const from = meta.folder;
            await moveTo(id, to, false);
            setToast({
              text: `Movida a ${to}`,
              undo: () => moveTo(id, from, true),
            });
          }
        }
      } catch (e) {
        const msg = String(e);
        if (msg.includes("OLLAMA_OFF")) {
          setAi("off");
          setModels([]);
        } else {
          setAi("error");
          setAiError(msg);
        }
      }
    },
    [model]
  );

  const active = notes.find((n) => n.id === activeId);
  const pinned = !!active?.pinned;
  const aiText = useMemo(() => stripImages(content), [content]);
  const aiKey = aiKeyOf(title, aiText);
  const images = useMemo(() => imagesIn(content), [content]);
  // Lo que se exporta: la versión ordenada; si todavía no hay, tus apuntes (con su título)
  const exportMd = useMemo(() => {
    if (structured.trim()) return structured;
    const t = title.trim();
    return (t ? `# ${t}\n\n` : "") + stripImages(content);
  }, [structured, title, content]);
  const printHtml = useMemo(() => (activeId ? renderMd(exportMd) : ""), [exportMd, activeId]);
  const exportTitle = title.trim() || notes.find((n) => n.id === activeId)?.title || "Nota";

  async function doExport(kind: "pdf" | "md" | "text" | "mdcopy") {
    setExportOpen(false);
    try {
      if (kind === "pdf") printPdf(exportTitle);
      else if (kind === "md") {
        if (await saveMarkdown(exportTitle, exportMd)) setToast({ text: "Nota guardada como Markdown" });
      } else {
        await navigator.clipboard.writeText(kind === "text" ? mdToText(exportMd) : exportMd);
        setToast({ text: kind === "text" ? "Copiada como texto" : "Copiada como Markdown" });
      }
    } catch (e) {
      setToast({ text: `No se pudo exportar: ${e}` });
    }
  }

  // La IA ordena cuando dejas de escribir (salvo que hayas fijado la versión ordenada)
  useEffect(() => {
    if (!activeId || !model || pinned || ai === "working" || ai === "off") return;
    if (aiText.length < MIN_CHARS || aiKey === lastSent.current) return;
    setAi("waiting");
    const id = activeId;
    const t = setTimeout(() => runAi(aiText, id), AI_DELAY_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiKey, activeId, model, pinned, ai === "working", ai === "off"]);

  const html = useMemo(() => renderMd(structured), [structured]);

  // El título de la IA (h1) va aparte para poner los #hashtags justo debajo, como en un documento.
  const [htmlHead, htmlBody] = useMemo(() => {
    const m = html.match(/^\s*<h1[^>]*>[\s\S]*?<\/h1>/);
    return m ? [m[0], html.slice(m[0].length)] : ["", html];
  }, [html]);

  const allTags = useMemo(() => [...new Set(notes.flatMap((n) => n.tags))].sort(), [notes]);

  const visible = notes.filter((n) => {
    const q = search.trim().toLowerCase();
    // Con resultados del backend se busca en todo el texto; mientras llegan, en título y vista previa
    const okSearch =
      !q || (hits ? hits.has(n.id) : n.title.toLowerCase().includes(q) || n.preview.toLowerCase().includes(q));
    const okTag = !tagFilter || n.tags.includes(tagFilter);
    const okFolder = !folderFilter || n.folder === folderFilter;
    return okSearch && okTag && okFolder;
  });

  const sorted = sortBy === "az" ? [...visible].sort((a, b) => a.title.localeCompare(b.title, "es")) : visible;
  const viewTitle = tagFilter ?? folderFilter ?? "Todas las notas";
  const today = new Date().toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });

  async function onTaskClick(e: ReactMouseEvent<HTMLElement>) {
    // Cuenta el clic en cualquier parte del renglón del pendiente, no solo en el círculo
    const li = (e.target as HTMLElement).closest("li");
    const box = li?.querySelector(':scope > input[type="checkbox"]');
    if (!activeId || !(box instanceof HTMLInputElement)) return;
    if (e.target !== box) e.preventDefault();
    const all = Array.from(e.currentTarget.querySelectorAll('input[type="checkbox"]'));
    const next = toggleTask(structured, all.indexOf(box));
    setStructured(next);
    await putStructured(activeId, next);
  }

  /** Agregar un pendiente a mano (va a la nota "Pendientes sueltos"). */
  async function addTask(text: string, when: WhenValue) {
    try {
      await invoke("add_task", { text, when: when ? formatWhen(when.due, when.hasTime) : null });
      await refresh();
      setToast({ text: "Pendiente agregado" });
    } catch (e) {
      setToast({ text: String(e) });
    }
  }

  /** Cambiar o quitar la fecha de un pendiente. Fija la nota para que la IA no deshaga el cambio. */
  async function setTaskDate(t: Task, when: WhenValue) {
    const md = structMap[t.noteId];
    if (md == null) return;
    const next = setTaskWhen(md, t.idx, when ? formatWhen(when.due, when.hasTime) : null);
    if (t.noteId === activeId) setStructured(next);
    await putStructured(t.noteId, next);
    const n = notes.find((x) => x.id === t.noteId);
    if (n && !n.pinned) {
      await invoke("set_pinned", { id: t.noteId, pinned: true });
      await refresh();
      setToast({ text: "Fecha cambiada. Fijé esa nota para que la IA no la regrese a la de antes." });
    } else {
      setToast({ text: when ? "Fecha cambiada" : "Fecha quitada" });
    }
  }

  /** Palomear desde la vista Pendientes (también si esa nota está abierta). */
  async function toggleFromList(t: Task) {
    const md = structMap[t.noteId];
    if (md == null) return;
    const next = toggleTask(md, t.idx);
    if (t.noteId === activeId) setStructured(next);
    await putStructured(t.noteId, next);
  }

  // Lo que la IA lleva escrito, ya limpio (sin anotaciones [..] y con horas "1:00 PM")
  const streamHtml = useMemo(() => {
    if (!streamText) return "";
    let md = streamText.replace(/^\s*```(?:markdown|md)?\s*/, "");
    md = normalizeTimes(stripNotes(md, streamNotesRef.current));
    const t = titleRef.current.trim();
    if (t) md = md.replace(/^# .*/m, `# ${t}`);
    return renderMd(md);
  }, [streamText]);
  const openTasks = tasks.filter((t) => !t.done && notes.some((n) => n.id === t.noteId));
  const urgent = openTasks.filter((t) => {
    const g = groupOf(t);
    return g === "late" || g === "today";
  }).length;

  async function togglePin() {
    if (!active) return;
    await invoke("set_pinned", { id: active.id, pinned: !active.pinned });
    await refresh();
    setToast({
      text: active.pinned
        ? "La IA volverá a ordenar mientras escribes"
        : "📌 Versión fijada: la IA ya no la cambia sola",
    });
  }

  function toggleLibrary() {
    if (window.innerWidth <= 850) return setListOpen(true);
    setLibHidden((h) => {
      try {
        localStorage.setItem("taskai.focus", h ? "0" : "1");
      } catch {
        /* sin almacenamiento */
      }
      return !h;
    });
  }

  /** Elegir carpeta o etiqueta en el menú siempre lleva al tablero con ese filtro. */
  async function pickFilter(folder: string | null, tag: string | null = null) {
    setSection("notes");
    setFolderFilter(folder);
    setTagFilter(tag);
    setListOpen(false);
    if (activeId) await goHome();
  }

  async function toggleFavorite(n: NoteMeta) {
    await invoke("set_favorite", { id: n.id, favorite: !n.favorite });
    await refresh();
  }

  /** Soltar una tarjeta sobre una carpeta del menú: la mueve ahí (como elegida por el usuario). */
  async function dropOnFolder(folder: string, id: string | null) {
    setDropFolder(null);
    setDragId(null);
    const n = notes.find((x) => x.id === id);
    if (!n || n.folder === folder) return;
    const from = n.folder;
    await moveTo(n.id, folder, true);
    setToast({ text: `“${n.title}” movida a ${folder}`, undo: () => moveTo(n.id, from, true) });
  }

  function askRemoveFolder(name: string) {
    setAsk({
      title: "¿Borrar esta carpeta?",
      text: `Se borrará la carpeta “${name}”. Solo se puede si está vacía.`,
      ok: "Sí, borrar",
      run: () => removeFolder(name),
    });
  }

  const words = content.trim() ? content.trim().split(/\s+/).length : 0;

  // Línea donde está el cursor (para resaltar su número).
  const [caretLine, setCaretLine] = useState(0);
  const trackCaret = (el: HTMLTextAreaElement) =>
    setCaretLine(el.value.slice(0, el.selectionStart).split("\n").length - 1);

  const status: Record<AiState, { label: string; cls: string }> = {
    idle: { label: "Lista para ordenar", cls: "" },
    waiting: { label: "Esperando que termines…", cls: "wait" },
    working: { label: "Ordenando…", cls: "work" },
    done: { label: "Al día", cls: "ok" },
    error: { label: "Error de IA", cls: "err" },
    off: { label: "IA desconectada", cls: "err" },
  };

  if (onboarded === null) return <div className="app-loading" />;
  if (!onboarded)
    return <Onboarding theme={theme} setTheme={setTheme} setModel={setModel} onDone={loadAll} />;

  return (
    <div className={`app ${libHidden && activeId ? "focus" : ""}`}>
      {/* ---------- Menú lateral: carpetas, etiquetas y ajustes ---------- */}
      {listOpen && <div className="backdrop" onClick={() => setListOpen(false)} />}
      <aside className={`sidebar ${listOpen ? "open" : ""} ${dragId ? "dragging" : ""}`}>
        <div className="brand">
          <Logo height={22} />
          <span>TaskAI</span>
        </div>
        <button className="new-note" onClick={newNote}>
          <Icon name="pencil" size={15} />
          Nueva nota
        </button>

        <nav className="nav" aria-label="Carpetas">
          <button
            className={`nav-item ${section === "notes" && !folderFilter && !tagFilter ? "on" : ""}`}
            onClick={() => pickFilter(null)}
          >
            <span className="nav-ico">
              <Icon name="grid" />
            </span>
            <span className="nav-label">Todas las notas</span>
            <em>{notes.length}</em>
          </button>
          <button
            className={`nav-item ${section === "tasks" ? "on" : ""}`}
            onClick={() => go("tasks")}
          >
            <span className="nav-ico">
              <Icon name="checkCircle" />
            </span>
            <span className="nav-label">Pendientes</span>
            {urgent > 0 ? (
              <b className="nav-badge" title="Para hoy o atrasados">
                {urgent}
              </b>
            ) : (
              openTasks.length > 0 && <em>{openTasks.length}</em>
            )}
          </button>

          <div className="nav-section">Carpetas</div>
          {folders.map((f) => {
            const look = folderLook(f.name);
            return (
              <div key={f.name} className="nav-row">
                <button
                  className={`nav-item ${folderFilter === f.name && !tagFilter && section === "notes" ? "on" : ""} ${dropFolder === f.name ? "drop" : ""}`}
                  style={{ "--h": look.hue } as CSSProperties}
                  onClick={() => pickFilter(f.name)}
                  onDragOver={(e) => {
                    if (!dragId) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    if (dropFolder !== f.name) setDropFolder(f.name);
                  }}
                  onDragLeave={() => setDropFolder((d) => (d === f.name ? null : d))}
                  onDrop={(e) => {
                    e.preventDefault();
                    dropOnFolder(f.name, e.dataTransfer.getData("text/plain") || dragId);
                  }}
                  onContextMenu={(e) => {
                    if (f.builtin) return;
                    e.preventDefault();
                    askRemoveFolder(f.name);
                  }}
                >
                  <span className="nav-ico tinted">
                    <Icon name={look.icon} />
                  </span>
                  <span className="nav-label">{f.name}</span>
                  {f.count > 0 && <em>{f.count}</em>}
                </button>
                {!f.builtin && (
                  <button className="nav-del" title="Borrar carpeta" aria-label={`Borrar carpeta ${f.name}`} onClick={() => askRemoveFolder(f.name)}>
                    <Icon name="x" size={13} />
                  </button>
                )}
              </div>
            );
          })}
          {newFolder !== null ? (
            <input
              className="nav-input"
              autoFocus
              placeholder="Nombre de la carpeta"
              value={newFolder}
              maxLength={40}
              onChange={(e) => setNewFolder(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addFolder();
                if (e.key === "Escape") setNewFolder(null);
              }}
              onBlur={addFolder}
            />
          ) : (
            <button className="nav-item add" onClick={() => setNewFolder("")}>
              <span className="nav-ico">
                <Icon name="plus" />
              </span>
              <span className="nav-label">Nueva carpeta</span>
            </button>
          )}

          {allTags.length > 0 && (
            <>
              <div className="nav-section">Etiquetas</div>
              {allTags.map((t) => (
                <button
                  key={t}
                  className={`nav-item ${tagFilter === t ? "on" : ""}`}
                  onClick={() => pickFilter(null, tagFilter === t ? null : t)}
                >
                  <span className="nav-ico">
                    <Icon name="hash" />
                  </span>
                  <span className="nav-label">{t.replace(/^#/, "")}</span>
                </button>
              ))}
            </>
          )}

          <div className="nav-spacer" />
          <button className={`nav-item ${section === "trash" && !activeId ? "on" : ""}`} onClick={() => go("trash")}>
            <span className="nav-ico">
              <Icon name="trash" />
            </span>
            <span className="nav-label">Papelera</span>
          </button>
        </nav>

        <footer className="side-foot">
          <div className="side-foot-row">
            <button
              className={`ai-dot ${power !== "idle" ? "busy" : ai === "off" ? "off" : "on"}`}
              title="Configuración de la IA"
              onClick={() => go("settings")}
            >
              <i />
              <span>
                {power === "starting"
                  ? "Encendiendo…"
                  : power === "stopping"
                    ? "Apagando…"
                    : ai === "off"
                      ? "IA apagada"
                      : model || "sin modelo"}
              </span>
            </button>
            <button
              className={`power-btn ${ai !== "off" ? "on" : ""}`}
              disabled={power !== "idle"}
              onClick={() => setAiPower(ai === "off")}
              title={ai === "off" ? "Encender la IA" : "Apagar la IA (libera la tarjeta de video)"}
              aria-label={ai === "off" ? "Encender la IA" : "Apagar la IA"}
            >
              <Icon name="power" size={15} />
            </button>
            <div className="theme-switch" role="radiogroup" aria-label="Tema">
              {(
                [
                  ["light", "sun", "Claro"],
                  ["dark", "moon", "Oscuro"],
                  ["system", "monitor", "Sistema"],
                ] as const
              ).map(([k, ico, label]) => (
                <button
                  key={k}
                  role="radio"
                  aria-checked={theme === k}
                  className={theme === k ? "on" : ""}
                  title={`Tema: ${label}`}
                  onClick={() => setTheme(k)}
                >
                  <Icon name={ico} size={14} />
                </button>
              ))}
            </div>
          </div>
          <button className={`settings-btn ${section === "settings" && !activeId ? "on" : ""}`} onClick={() => go("settings")}>
            <Icon name="settings" size={16} />
            Configuración
          </button>
        </footer>
      </aside>

      {/* ---------- Área principal: tablero de notas o la nota abierta ---------- */}
      <main className="main">
        {!activeId ? (
          <div className="board">
            <header className="board-head">
              <button className="icon-btn only-narrow" title="Carpetas" onClick={() => setListOpen(true)}>
                <Icon name="menu" size={18} />
              </button>
              <div className="board-title">
                <p className="board-hello">
                  {userName ? `Hola, ${userName}` : "Hola"} · {today}
                </p>
                <h1>{SECTION_TITLE[section] ?? viewTitle}</h1>
              </div>
            </header>

            {section === "settings" ? (
              <Settings
                models={models}
                model={model}
                setModel={setModel}
                aiOff={ai === "off"}
                onRefresh={checkAi}
                theme={theme}
                setTheme={setTheme}
                accent={accent}
                setAccent={(id) => {
                  applyAccent(id);
                  setAccent(id);
                }}
                onProfileChanged={loadAll}
                power={power}
                onPower={setAiPower}
                ask={setAsk}
                onCheckUpdates={checkUpdatesNow}
              />
            ) : section === "trash" ? (
              <TrashView
                ask={setAsk}
                onRestored={(f) => {
                  refresh();
                  setToast({ text: `Nota restaurada en ${f}` });
                }}
              />
            ) : section === "tasks" ? (
              <TasksView
                tasks={tasks}
                notes={notes}
                onToggle={toggleFromList}
                onOpen={openNote}
                onAdd={addTask}
                onSetWhen={setTaskDate}
              />
            ) : (
              <>
            {notes.length > 0 && (
              <div className="board-bar">
                <label className="search">
                  <Icon name="search" size={15} />
                  <input placeholder="Buscar notas…" value={search} onChange={(e) => setSearch(e.target.value)} />
                  {search && (
                    <button className="search-clear" onClick={() => setSearch("")} aria-label="Borrar búsqueda">
                      <Icon name="x" size={13} />
                    </button>
                  )}
                </label>
                <div className="seg" role="radiogroup" aria-label="Ordenar">
                  <button role="radio" aria-checked={sortBy === "recent"} className={sortBy === "recent" ? "on" : ""} onClick={() => setSortBy("recent")}>
                    Recientes
                  </button>
                  <button role="radio" aria-checked={sortBy === "az"} className={sortBy === "az" ? "on" : ""} onClick={() => setSortBy("az")}>
                    A–Z
                  </button>
                </div>
                <span className="board-count">
                  {sorted.length} {sorted.length === 1 ? "nota" : "notas"}
                </span>
              </div>
            )}

            {notes.length === 0 ? (
              <div className="hero">
                <div className="hero-bg" />
                <div className="hero-content">
                  <span className="pill">✦ Tu IA, tus apuntes</span>
                  <h1>Escribe como piensas.</h1>
                  <p>
                    Tú escribes rápido y desordenado. TaskAI lo ordena en vivo,{" "}
                    <br />
                    sin tocar ni una letra de lo que escribiste.
                  </p>
                  <button className="cta" onClick={newNote}>
                    Empezar una nota →
                  </button>
                </div>
              </div>
            ) : sorted.length === 0 ? (
              <div className="board-none">
                <p>{search ? `Nada coincide con “${search}”.` : "No hay notas aquí todavía."}</p>
                {!search && (
                  <button className="btn" onClick={newNote}>
                    <Icon name="plus" size={14} /> Nueva nota
                  </button>
                )}
              </div>
            ) : (
              <>
                {[
                  { key: "fav", label: "Favoritas", list: sorted.filter((n) => n.favorite) },
                  { key: "rest", label: sorted.some((n) => n.favorite) ? "Las demás" : "", list: sorted.filter((n) => !n.favorite) },
                ]
                  .filter((s) => s.list.length)
                  .map((s) => (
              <section key={s.key} className="cards-sec">
                {s.label && (
                  <h2 className="cards-title">
                    {s.key === "fav" && <Icon name="star" size={14} />} {s.label}
                  </h2>
                )}
              <div className="cards">
                {s.list.map((n) => (
                  <div
                    key={n.id}
                    role="button"
                    tabIndex={0}
                    className={`card-note ${n.favorite ? "fav" : ""} ${dragId === n.id ? "dragging" : ""}`}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", n.id);
                      e.dataTransfer.effectAllowed = "move";
                      setDragId(n.id);
                    }}
                    onDragEnd={() => {
                      setDragId(null);
                      setDropFolder(null);
                    }}
                    onClick={() => openNote(n.id)}
                    onKeyDown={(e) => {
                      if (e.target !== e.currentTarget) return;
                      if (e.key === "Enter" || e.key === " ") openNote(n.id);
                      if (e.key === "Delete") askRemoveNote(n.id, n.title);
                    }}
                  >
                    <div className="card-top">
                      <FolderTag name={n.folder} />
                      {n.pinned && (
                        <span className="card-pin" title="Versión fijada">
                          <Icon name="pin" size={14} />
                        </span>
                      )}
                      <button
                        className={`card-star ${n.favorite ? "on" : ""}`}
                        title={n.favorite ? "Quitar de favoritas" : "Marcar como favorita"}
                        aria-label={n.favorite ? `Quitar ${n.title} de favoritas` : `Marcar ${n.title} como favorita`}
                        aria-pressed={n.favorite}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleFavorite(n);
                        }}
                      >
                        <Icon name="star" size={15} />
                      </button>
                      <button
                        className="card-del"
                        title="Borrar nota"
                        aria-label={`Borrar nota ${n.title}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          askRemoveNote(n.id, n.title);
                        }}
                      >
                        <Icon name="trash" size={15} />
                      </button>
                    </div>
                    <h3 className="card-title">{n.title}</h3>
                    {hits?.get(n.id)?.hit ? (
                      <p className="card-preview">
                        {hits.get(n.id)!.before}
                        <mark>{hits.get(n.id)!.hit}</mark>
                        {hits.get(n.id)!.after}
                      </p>
                    ) : (
                      <p className="card-preview">{n.preview || "Sin contenido"}</p>
                    )}
                    <div className="card-foot">
                      {n.tags.slice(0, 3).map((t) => (
                        <span key={t} className="card-tag">
                          {t}
                        </span>
                      ))}
                      <span className="card-time">{timeAgo(n.modified)}</span>
                    </div>
                  </div>
                ))}
              </div>
              </section>
                  ))}
              </>
            )}
              </>
            )}
          </div>
        ) : (
          <>
            <header className="toolbar">
              <button className="icon-btn" title="Mostrar u ocultar el menú" onClick={toggleLibrary}>
                <Icon name="menu" size={18} />
              </button>
              <button className="back-btn" onClick={goHome} title="Volver a tus notas">
                <Icon name="back" size={16} />
                <span className="btn-label">Notas</span>
              </button>
              {active && (
                <div className="move">
                  <button
                    className="folder-pick"
                    title={active.locked ? "Carpeta elegida por ti · clic para mover" : "La IA eligió esta carpeta · clic para mover"}
                    onClick={() => setMoveOpen((o) => !o)}
                  >
                    <FolderTag name={active.folder} />
                    <span className="caret">▾</span>
                  </button>
                  {moveOpen && (
                    <>
                      <div className="menu-backdrop" onClick={() => setMoveOpen(false)} />
                      <div className="menu left">
                        <div className="menu-title">
                          {active.locked ? "Carpeta elegida por ti" : "✦ La IA eligió esta carpeta"}
                        </div>
                        {folders.map((f) => {
                          const look = folderLook(f.name);
                          return (
                            <button
                              key={f.name}
                              className={f.name === active.folder ? "on" : ""}
                              onClick={async () => {
                                setMoveOpen(false);
                                await moveTo(active.id, f.name, true);
                              }}
                            >
                              <i className="menu-ico" style={{ "--h": look.hue } as CSSProperties}>
                                <Icon name={look.icon} size={15} />
                              </i>
                              {f.name}
                              {f.name === active.folder && <span>✓</span>}
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              )}
              <div className="crumbs" title={active?.title}>
                {active?.title ?? "Nota sin título"}
              </div>
              <div className="tools">
                {pinned && ai !== "working" ? (
                  <span className="status pin" title="Versión fijada: la IA no la cambia sola">
                    <Icon name="pin" size={14} /> <span className="status-label">Fijada</span>
                  </span>
                ) : (
                  <span className={`status ${status[ai].cls}`} title={aiError || status[ai].label}>
                    <i /> <span className="status-label">{status[ai].label}</span>
                  </span>
                )}
                <div className="move">
                  <button
                    className="btn toggle"
                    onClick={() => setExportOpen((o) => !o)}
                    title="Exportar la nota (PDF, Markdown o copiar)"
                    aria-haspopup="menu"
                    aria-expanded={exportOpen}
                  >
                    <Icon name="download" size={15} />
                    <span className="btn-label">Exportar</span>
                  </button>
                  {exportOpen && (
                    <>
                      <div className="menu-backdrop" onClick={() => setExportOpen(false)} />
                      <div className="menu" role="menu">
                        <div className="menu-title">
                          {structured.trim() ? "Exporta la versión ordenada" : "Exporta tus apuntes"}
                        </div>
                        <button role="menuitem" onClick={() => doExport("pdf")}>
                          <Icon name="file" size={15} /> Guardar como PDF…
                        </button>
                        <button role="menuitem" onClick={() => doExport("md")}>
                          <Icon name="download" size={15} /> Guardar como Markdown (.md)…
                        </button>
                        <button role="menuitem" onClick={() => doExport("text")}>
                          <Icon name="copy" size={15} /> Copiar como texto
                        </button>
                        <button role="menuitem" onClick={() => doExport("mdcopy")}>
                          <Icon name="copy" size={15} /> Copiar como Markdown
                        </button>
                      </div>
                    </>
                  )}
                </div>
                <button
                  className={`btn toggle ${reading ? "on" : ""}`}
                  onClick={() => setReading((r) => !r)}
                  aria-pressed={reading}
                  title={reading ? "Volver a escribir" : "Modo lectura: solo la versión ordenada"}
                >
                  <Icon name={reading ? "pencil" : "read"} size={15} />
                  <span className="btn-label">{reading ? "Editar" : "Lectura"}</span>
                </button>
                <button
                  className="btn primary"
                  disabled={!model || ai === "working" || aiText.length < MIN_CHARS}
                  onClick={() => activeId && runAi(aiText, activeId)}
                  title={pinned ? "Revisar: la IA actualiza la versión fijada con tus apuntes" : "Ordenar ahora"}
                >
                  <Icon name="sparkle" size={15} />
                  <span className="btn-label">{pinned ? "Revisar" : "Ordenar"}</span>
                </button>
              </div>
            </header>

            <div className="pane-tabs" hidden={reading}>
              <button className={view === "raw" ? "on" : ""} onClick={() => setView("raw")}>
                Tus apuntes
              </button>
              <button className={view === "ai" ? "on" : ""} onClick={() => setView("ai")}>
                ✦ Ordenada
                {ai === "working" && <i className="tab-dot" />}
              </button>
            </div>

            <div className={`split ${reading ? "reading" : ""}`} data-view={reading ? "ai" : view}>
              <div className="pane raw-pane">
                <div className="pane-label">Tus apuntes</div>
                <input
                  className="note-title"
                  value={title}
                  maxLength={80}
                  onChange={(e) => setTitle(e.target.value)}
                  onKeyDown={(e) => {
                    // Enter salta al texto, como en cualquier editor de notas
                    if (e.key === "Enter") {
                      e.preventDefault();
                      (e.currentTarget.parentElement?.querySelector("textarea") as HTMLTextAreaElement | null)?.focus();
                    }
                  }}
                  placeholder="Título (opcional)"
                  aria-label="Título de la nota (opcional)"
                />
                <div className="editor-scroll">
                  {/* Debajo va una copia invisible del texto, línea por línea, para que cada
                      número quede a la altura de su línea aunque esta se parta en varios renglones. */}
                  <div className="editor">
                    {content.split("\n").map((line, i) => (
                      <div key={i} className={"ln-row" + (i === caretLine ? " current" : "")}>
                        <span className="ln-num">{i + 1}</span>
                        <span className="ln-text">{line || "​"}</span>
                      </div>
                    ))}
                    <textarea
                      autoFocus
                      spellCheck={false}
                      value={content}
                      onChange={(e) => {
                        setContent(e.target.value);
                        trackCaret(e.target);
                      }}
                      onSelect={(e) => trackCaret(e.currentTarget)}
                      onPaste={onPaste}
                      placeholder={"Escribe aquí lo que quieras, como te salga…\nLa IA lo acomoda por ti en el lado derecho."}
                    />
                  </div>
                </div>
                <NoteImages names={images} onRemove={removeImage} />
                <div className="pane-foot">
                  {words} palabras · guardado automático · pega imágenes con Ctrl + V
                </div>
              </div>

              <div className="pane ai-pane">
                <div className="pane-label accent">
                  ✦ Versión ordenada
                  {structured && (
                    <button
                      className={`pin-btn ${pinned ? "on" : ""}`}
                      onClick={togglePin}
                      title={
                        pinned
                          ? "Soltar: la IA vuelve a ordenar mientras escribes"
                          : "Fijar: guarda esta versión y la IA ya no la cambia sola"
                      }
                    >
                      <Icon name="pin" size={13} /> {pinned ? "Fijada" : "Fijar"}
                    </button>
                  )}
                </div>
                {pinned && aiKey !== lastSent.current && ai !== "working" && (
                  <div className="pin-note">
                    Cambiaste tus apuntes. La versión fijada no se actualiza sola:{" "}
                    <button className="link" onClick={() => activeId && runAi(aiText, activeId)}>
                      ✦ Revisar ahora
                    </button>
                  </div>
                )}
                {ai === "off" && ollamaInstalled ? (
                  <div className="setup">
                    <h3>La IA está apagada</h3>
                    <p>Enciéndela para que ordene tu nota. Tus apuntes siguen guardándose aunque esté apagada.</p>
                    <div className="setup-actions">
                      <button className="btn primary" disabled={power !== "idle"} onClick={() => setAiPower(true)}>
                        <Icon name="power" size={14} /> {power === "starting" ? "Encendiendo…" : "Encender la IA"}
                      </button>
                    </div>
                  </div>
                ) : ai === "off" ? (
                  <div className="setup">
                    <h3>Conecta la IA (gratis)</h3>
                    <p>TaskAI usa Ollama para correr la IA en tu propia computadora: privado y sin costo.</p>
                    <div className="setup-actions">
                      <button className="btn" onClick={() => go("settings")}>
                        Ver pasos para mi sistema
                      </button>
                      <button className="link" onClick={checkAi}>
                        Ya lo instalé, conectar
                      </button>
                    </div>
                  </div>
                ) : ai === "working" && streamHtml ? (
                  <div className="md streaming" aria-live="polite">
                    <div dangerouslySetInnerHTML={{ __html: streamHtml }} />
                    <span className="stream-caret" aria-hidden="true" />
                  </div>
                ) : structured ? (
                  <>
                    <div className={`md ${ai === "working" ? "dim" : ""}`} onClick={onTaskClick}>
                      {htmlHead && <div dangerouslySetInnerHTML={{ __html: htmlHead }} />}
                      {active && active.tags.length > 0 && (
                        <div className="md-tags">
                          {active.tags.map((t) => (
                            <span key={t}>{t}</span>
                          ))}
                        </div>
                      )}
                      <div dangerouslySetInnerHTML={{ __html: htmlBody }} />
                    </div>
                    <NoteImages names={images} />
                  </>
                ) : (
                  <div className="empty-ai">
                    {ai === "working" ? (
                      <div className="shimmer">
                        <span /> <span /> <span />
                      </div>
                    ) : reading ? (
                      <div className="reading-empty">
                        <p>Esta nota todavía no tiene versión ordenada.</p>
                        <button className="btn" onClick={() => setReading(false)}>
                          ✎ Ir a escribir
                        </button>
                      </div>
                    ) : (
                      <p>Escribe al menos unas líneas y deja de teclear un momento. Aquí aparecerá tu nota ordenada.</p>
                    )}
                  </div>
                )}
                {ai === "error" && <div className="err-box">{aiError}</div>}
              </div>
            </div>

            {/* Lo único que sale al imprimir / guardar como PDF (ver @media print) */}
            <div className="print-area" aria-hidden="true">
              <div className="md" dangerouslySetInnerHTML={{ __html: printHtml }} />
              <NoteImages names={images} />
            </div>
          </>
        )}
      </main>

      {update && <UpdateBanner update={update} onClose={() => setUpdate(null)} beforeInstall={flushNote} />}

      {toast && (
        <div className="toast" role="status">
          <span>{toast.text}</span>
          {toast.undo && (
            <button
              onClick={() => {
                toast.undo?.();
                setToast(null);
              }}
            >
              Deshacer
            </button>
          )}
        </div>
      )}

      {ask && <ConfirmDialog {...ask} onClose={() => setAsk(null)} />}

    </div>
  );
}
