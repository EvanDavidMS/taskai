import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { marked } from "marked";
import DOMPurify from "dompurify";
import Settings from "./Settings";
import Onboarding from "./Onboarding";
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
};
type Note = { content: string; structured: string };
type FolderInfo = { name: string; count: number; builtin: boolean };
type Toast = { text: string; undo?: () => void };
type ThemePref = "system" | "light" | "dark";

const FOLDER_ICON: Record<string, string> = {
  "Notas rápidas": "⚡",
  Diario: "📓",
  Escuela: "🎓",
  Trabajo: "💼",
  Hobbys: "🎨",
};
const icon = (f: string) => FOLDER_ICON[f] ?? "📁";
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

function timeAgo(secs: number) {
  const diff = Date.now() / 1000 - secs;
  if (diff < 60) return "ahora";
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`;
  return new Date(secs * 1000).toLocaleDateString("es-MX", { day: "numeric", month: "short" });
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
  const [aiError, setAiError] = useState("");
  const [folder, setFolder] = useState("");
  const [listOpen, setListOpen] = useState(false); // cajón de notas en pantallas angostas
  const [view, setView] = useState<"raw" | "ai">("raw"); // pestaña activa en pantallas angostas
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [folders, setFolders] = useState<FolderInfo[]>([]);
  const [folderFilter, setFolderFilter] = useState<string | null>(null);
  const [newFolder, setNewFolder] = useState<string | null>(null); // input de nueva carpeta
  const [moveOpen, setMoveOpen] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
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
    const [n, f] = await Promise.all([
      invoke<NoteMeta[]>("list_notes"),
      invoke<FolderInfo[]>("list_folders"),
    ]);
    setNotes(n);
    setFolders(f);
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
    }
  }, []);

  const loadAll = useCallback(async () => {
    const cfg = await invoke<{ name: string; onboarded: boolean }>("get_config");
    setUserName(cfg.name);
    setOnboarded(cfg.onboarded);
    if (!cfg.onboarded) return;
    refresh();
    checkAi();
    invoke<string>("notes_folder").then(setFolder);
  }, [refresh, checkAi]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (model) localStorage.setItem("taskai.model", model);
  }, [model]);

  async function openNote(id: string) {
    const n = await invoke<Note>("read_note", { id });
    setActiveId(id);
    setListOpen(false);
    setView("raw");
    setContent(n.content);
    setStructured(n.structured);
    lastSent.current = n.structured ? n.content : "";
    setAi(models.length ? (n.structured ? "done" : "idle") : "off");
  }

  async function newNote() {
    const id = await invoke<string>("create_note", { folder: folderFilter });
    await refresh();
    await openNote(id);
  }

  async function removeNote() {
    if (!activeId || !confirm("¿Borrar esta nota? No se puede deshacer.")) return;
    await invoke("delete_note", { id: activeId });
    setActiveId(null);
    setContent("");
    setStructured("");
    refresh();
  }

  // Guardado automático
  useEffect(() => {
    if (!activeId) return;
    const t = setTimeout(async () => {
      await invoke("save_note", { id: activeId, content });
      refresh();
    }, SAVE_DELAY_MS);
    return () => clearTimeout(t);
  }, [content, activeId, refresh]);

  const runAi = useCallback(
    async (text: string, id: string) => {
      if (!model) return;
      setAi("working");
      setAiError("");
      try {
        const ann = annotateDates(text);
        const fresh = normalizeTimes(
          stripNotes(await invoke<string>("ai_structure", { text: ann.text, model, ...dateContext() }), ann.notes),
        );
        const out = activeRef.current === id ? carryChecks(structuredRef.current, fresh) : fresh;
        await invoke("save_structured", { id, content: out });
        lastSent.current = text;
        if (activeRef.current === id) {
          setStructured(out);
          setAi("done");
        }

        // La IA decide la carpeta, salvo que el usuario ya la haya movido a mano
        const meta = notesRef.current.find((n) => n.id === id);
        if (meta && !meta.locked) {
          const to = await invoke<string>("ai_classify", { text, model });
          if (to !== meta.folder) {
            const from = meta.folder;
            await moveTo(id, to, false);
            setToast({
              text: `Movida a ${icon(to)} ${to}`,
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

  // La IA ordena cuando dejas de escribir (salvo que hayas fijado la versión ordenada)
  useEffect(() => {
    if (!activeId || !model || pinned || ai === "working" || ai === "off") return;
    if (content.trim().length < MIN_CHARS || content === lastSent.current) return;
    setAi("waiting");
    const id = activeId;
    const t = setTimeout(() => runAi(content, id), AI_DELAY_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, activeId, model, pinned, ai === "working", ai === "off"]);

  const html = useMemo(
    () =>
      DOMPurify.sanitize(marked.parse(structured, { async: false }) as string).replace(/ disabled=""/g, ""),
    [structured]
  );

  const allTags = useMemo(() => [...new Set(notes.flatMap((n) => n.tags))].sort(), [notes]);

  const visible = notes.filter((n) => {
    const q = search.toLowerCase();
    const okSearch = !q || n.title.toLowerCase().includes(q) || n.preview.toLowerCase().includes(q);
    const okTag = !tagFilter || n.tags.includes(tagFilter);
    const okFolder = !folderFilter || n.folder === folderFilter;
    return okSearch && okTag && okFolder;
  });

  const listTitle = tagFilter
    ? tagFilter
    : folderFilter
      ? `${icon(folderFilter)} ${folderFilter}`
      : "Todas las notas";

  async function onTaskClick(e: React.MouseEvent<HTMLElement>) {
    const box = e.target as HTMLElement;
    if (!activeId || !(box instanceof HTMLInputElement) || box.type !== "checkbox") return;
    const all = Array.from(e.currentTarget.querySelectorAll('input[type="checkbox"]'));
    const next = toggleTask(structured, all.indexOf(box));
    setStructured(next);
    await invoke("save_structured", { id: activeId, content: next });
  }

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

  function pickFolder(f: string | null) {
    setFolderFilter(f);
    setTagFilter(null);
  }

  const words = content.trim() ? content.trim().split(/\s+/).length : 0;

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
    <div className={`app ${libHidden ? "focus" : ""}`}>
      {/* ---------- Biblioteca: carpetas + notas en una sola columna ---------- */}
      {listOpen && <div className="backdrop" onClick={() => setListOpen(false)} />}
      <aside className={`library ${listOpen ? "open" : ""}`}>
        <header className="lib-head">
          <div className="brand">
            <div className="logo">✦</div>
            <span>TaskAI</span>
          </div>
          <button className="icon-btn" title="Nueva nota" onClick={newNote}>
            ✎
          </button>
        </header>

        <div className="search">
          <span>⌕</span>
          <input placeholder="Buscar notas…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>

        <div className="chips" role="tablist" aria-label="Carpetas">
          <button className={`fchip ${!folderFilter && !tagFilter ? "on" : ""}`} onClick={() => pickFolder(null)}>
            Todas <em>{notes.length}</em>
          </button>
          {folders.map((f) => (
            <button
              key={f.name}
              className={`fchip ${folderFilter === f.name && !tagFilter ? "on" : ""}`}
              title={f.name}
              onClick={() => pickFolder(f.name)}
              onContextMenu={(e) => {
                if (f.builtin) return;
                e.preventDefault();
                if (confirm(`¿Borrar la carpeta "${f.name}"? Solo se puede si está vacía.`)) removeFolder(f.name);
              }}
            >
              {icon(f.name)} {f.name}
              {f.count > 0 && <em>{f.count}</em>}
            </button>
          ))}
          {newFolder !== null ? (
            <input
              className="fchip-input"
              autoFocus
              placeholder="Nueva carpeta"
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
            <button className="fchip add" title="Nueva carpeta" onClick={() => setNewFolder("")}>
              ＋
            </button>
          )}
        </div>

        {allTags.length > 0 && (
          <div className="tags">
            {allTags.map((t) => (
              <button
                key={t}
                className={`tag ${tagFilter === t ? "on" : ""}`}
                onClick={() => setTagFilter(tagFilter === t ? null : t)}
              >
                {t}
              </button>
            ))}
          </div>
        )}

        <div className="list-title">{listTitle}</div>
        <div className="items">
          {visible.map((n) => (
            <button key={n.id} className={`item ${n.id === activeId ? "on" : ""}`} onClick={() => openNote(n.id)}>
              <div className="item-title">
                {n.pinned && <span title="Versión fijada">📌 </span>}
                {n.title}
              </div>
              <div className="item-preview">{n.preview || "Sin contenido"}</div>
              <div className="item-time">
                {!folderFilter && (
                  <span className="item-folder">
                    {icon(n.folder)} {n.folder}
                  </span>
                )}
                {timeAgo(n.modified)}
              </div>
            </button>
          ))}
          {visible.length === 0 && <p className="hint pad">No hay notas aquí todavía.</p>}
        </div>

        <footer className="lib-foot">
          <button
            className={`ai-dot ${ai === "off" ? "off" : "on"}`}
            title="Configuración de la IA"
            onClick={() => setSettingsOpen(true)}
          >
            <i />
            <span>{ai === "off" ? "IA desconectada" : model || "sin modelo"}</span>
          </button>
          <div className="theme-switch" role="radiogroup" aria-label="Tema">
            {(
              [
                ["light", "☀", "Claro"],
                ["dark", "☾", "Oscuro"],
                ["system", "◐", "Sistema"],
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
                {ico}
              </button>
            ))}
          </div>
          <button className="icon-btn" title="Configuración" onClick={() => setSettingsOpen(true)}>
            ⚙
          </button>
        </footer>
      </aside>

      {/* ---------- Área principal ---------- */}
      <main className="main">
        {!activeId ? (
          <div className="hero">
            <div className="hero-bg" />
            <button className="icon-btn menu-btn hero-menu" title="Mostrar u ocultar notas" onClick={toggleLibrary}>
              ☰
            </button>
            <div className="hero-content">
              <span className="pill">{userName ? `👋 Hola, ${userName}` : "✦ Tu IA, tus apuntes"}</span>
              <h1>Escribe como piensas.</h1>
              <p>
                Tú escribes rápido y desordenado. TaskAI lo ordena en vivo a la derecha,{" "}
                <br />
                sin tocar ni una letra de lo que escribiste.
              </p>
              <button className="cta" onClick={newNote}>
                Empezar una nota →
              </button>
            </div>
          </div>
        ) : (
          <>
            <header className="toolbar">
              <button className="icon-btn menu-btn" title="Mostrar u ocultar notas" onClick={toggleLibrary}>
                ☰
              </button>
              {active && (
                <div className="move">
                  <button
                    className="folder-chip"
                    title={active.locked ? "Carpeta elegida por ti · clic para mover" : "La IA eligió esta carpeta · clic para mover"}
                    onClick={() => setMoveOpen((o) => !o)}
                  >
                    {icon(active.folder)} <span className="chip-label">{active.folder}</span>
                    <span className="caret">▾</span>
                  </button>
                  {moveOpen && (
                    <>
                      <div className="menu-backdrop" onClick={() => setMoveOpen(false)} />
                      <div className="menu left">
                        <div className="menu-title">
                          {active.locked ? "📌 Carpeta elegida por ti" : "✦ La IA eligió esta carpeta"}
                        </div>
                        {folders.map((f) => (
                          <button
                            key={f.name}
                            className={f.name === active.folder ? "on" : ""}
                            onClick={async () => {
                              setMoveOpen(false);
                              await moveTo(active.id, f.name, true);
                            }}
                          >
                            {icon(f.name)} {f.name}
                            {f.name === active.folder && <span>✓</span>}
                          </button>
                        ))}
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
                    📌 <span className="status-label">Fijada</span>
                  </span>
                ) : (
                  <span className={`status ${status[ai].cls}`} title={aiError || status[ai].label}>
                    <i /> <span className="status-label">{status[ai].label}</span>
                  </span>
                )}
                <button
                  className="btn primary"
                  disabled={!model || ai === "working" || content.trim().length < MIN_CHARS}
                  onClick={() => activeId && runAi(content, activeId)}
                  title={pinned ? "Revisar: la IA actualiza la versión fijada con tus apuntes" : "Ordenar ahora"}
                >
                  ✦<span className="btn-label"> {pinned ? "Revisar" : "Ordenar"}</span>
                </button>
                <div className="move">
                  <button className="icon-btn" title="Más opciones" onClick={() => setMoreOpen((o) => !o)}>
                    ⋯
                  </button>
                  {moreOpen && (
                    <>
                      <div className="menu-backdrop" onClick={() => setMoreOpen(false)} />
                      <div className="menu">
                        <button
                          onClick={() => {
                            setMoreOpen(false);
                            setSettingsOpen(true);
                          }}
                        >
                          ⚙ Configuración
                        </button>
                        <button
                          className="danger-item"
                          onClick={() => {
                            setMoreOpen(false);
                            removeNote();
                          }}
                        >
                          🗑 Borrar nota
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </header>

            <div className="pane-tabs">
              <button className={view === "raw" ? "on" : ""} onClick={() => setView("raw")}>
                Tus apuntes
              </button>
              <button className={view === "ai" ? "on" : ""} onClick={() => setView("ai")}>
                ✦ Ordenada
                {ai === "working" && <i className="tab-dot" />}
              </button>
            </div>

            <div className="split" data-view={view}>
              <div className="pane raw-pane">
                <div className="pane-label">Tus apuntes</div>
                <textarea
                  autoFocus
                  spellCheck={false}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder={"Escribe sin pensar en el orden…\n\nclase redes hoy, el profe dijo q tcp es confiable y udp no\nexamen el viernes #redes"}
                />
                <div className="pane-foot">{words} palabras · guardado automático</div>
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
                      📌 {pinned ? "Fijada" : "Fijar"}
                    </button>
                  )}
                </div>
                {pinned && content !== lastSent.current && ai !== "working" && (
                  <div className="pin-note">
                    Cambiaste tus apuntes. La versión fijada no se actualiza sola:{" "}
                    <button className="link" onClick={() => activeId && runAi(content, activeId)}>
                      ✦ Revisar ahora
                    </button>
                  </div>
                )}
                {ai === "off" ? (
                  <div className="setup">
                    <h3>Conecta la IA (gratis)</h3>
                    <p>TaskAI usa Ollama para correr la IA en tu propia computadora: privado y sin costo.</p>
                    <div className="setup-actions">
                      <button className="btn" onClick={() => setSettingsOpen(true)}>
                        ⚙ Ver pasos para mi sistema
                      </button>
                      <button className="link" onClick={checkAi}>
                        Ya lo instalé, conectar
                      </button>
                    </div>
                  </div>
                ) : structured ? (
                  <article
                    className={`md ${ai === "working" ? "dim" : ""}`}
                    onClick={onTaskClick}
                    dangerouslySetInnerHTML={{ __html: html }}
                  />
                ) : (
                  <div className="empty-ai">
                    {ai === "working" ? (
                      <div className="shimmer">
                        <span /> <span /> <span />
                      </div>
                    ) : (
                      <p>Escribe al menos unas líneas y deja de teclear un momento. Aquí aparecerá tu nota ordenada.</p>
                    )}
                  </div>
                )}
                {ai === "error" && <div className="err-box">{aiError}</div>}
              </div>
            </div>
          </>
        )}
      </main>

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

      {settingsOpen && (
        <Settings
          onClose={() => setSettingsOpen(false)}
          models={models}
          model={model}
          setModel={setModel}
          aiOff={ai === "off"}
          onRefresh={checkAi}
          folder={folder}
          theme={theme}
          setTheme={setTheme}
        />
      )}
    </div>
  );
}
