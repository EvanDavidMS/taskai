import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { marked } from "marked";
import DOMPurify from "dompurify";
import "./App.css";

type NoteMeta = { id: string; title: string; preview: string; modified: number; tags: string[] };
type Note = { content: string; structured: string };
type AiState = "idle" | "waiting" | "working" | "done" | "error" | "off";

const AI_DELAY_MS = 3000; // la IA ordena cuando dejas de escribir 3 s
const SAVE_DELAY_MS = 500;
const MIN_CHARS = 20;

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

  const lastSent = useRef(""); // último texto que ya ordenó la IA
  const activeRef = useRef<string | null>(null);
  activeRef.current = activeId;

  const refresh = useCallback(async () => {
    setNotes(await invoke<NoteMeta[]>("list_notes"));
  }, []);

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

  useEffect(() => {
    refresh();
    checkAi();
    invoke<string>("notes_folder").then(setFolder);
  }, [refresh, checkAi]);

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
    const id = await invoke<string>("create_note");
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
        const out = await invoke<string>("ai_structure", { text, model });
        await invoke("save_structured", { id, content: out });
        lastSent.current = text;
        if (activeRef.current === id) {
          setStructured(out);
          setAi("done");
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

  // La IA ordena cuando dejas de escribir
  useEffect(() => {
    if (!activeId || !model || ai === "working" || ai === "off") return;
    if (content.trim().length < MIN_CHARS || content === lastSent.current) return;
    setAi("waiting");
    const id = activeId;
    const t = setTimeout(() => runAi(content, id), AI_DELAY_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, activeId, model, ai === "working", ai === "off"]);

  const html = useMemo(
    () => DOMPurify.sanitize(marked.parse(structured, { async: false }) as string),
    [structured]
  );

  const allTags = useMemo(() => [...new Set(notes.flatMap((n) => n.tags))].sort(), [notes]);

  const visible = notes.filter((n) => {
    const q = search.toLowerCase();
    const okSearch = !q || n.title.toLowerCase().includes(q) || n.preview.toLowerCase().includes(q);
    const okTag = !tagFilter || n.tags.includes(tagFilter);
    return okSearch && okTag;
  });

  const active = notes.find((n) => n.id === activeId);
  const words = content.trim() ? content.trim().split(/\s+/).length : 0;

  const status: Record<AiState, { label: string; cls: string }> = {
    idle: { label: "Lista para ordenar", cls: "" },
    waiting: { label: "Esperando que termines…", cls: "wait" },
    working: { label: "Ordenando…", cls: "work" },
    done: { label: "Al día", cls: "ok" },
    error: { label: "Error de IA", cls: "err" },
    off: { label: "IA desconectada", cls: "err" },
  };

  return (
    <div className="app">
      {/* ---------- Barra lateral ---------- */}
      <aside className="sidebar">
        <div className="brand">
          <div className="logo">✦</div>
          <span className="label">TaskAI</span>
        </div>

        <nav>
          <button
            className={`nav ${!tagFilter ? "on" : ""}`}
            title="Todas las notas"
            onClick={() => {
              setTagFilter(null);
              setListOpen((o) => !o);
            }}
          >
            <span className="ico">▤</span>
            <span className="label">Todas las notas</span>
            <em className="label">{notes.length}</em>
          </button>
          <button className="nav" title="Nueva nota" onClick={newNote}>
            <span className="ico">＋</span>
            <span className="label">Nueva nota</span>
          </button>
        </nav>

        <div className="section-title">Etiquetas</div>
        <div className="tags">
          {allTags.length === 0 && <p className="hint">Escribe #algo en una nota</p>}
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

        <div className="sidebar-foot">
          <div
            className={`ai-dot ${ai === "off" ? "off" : "on"}`}
            title={ai === "off" ? "IA desconectada" : `IA local · ${model}`}
          >
            <i />
            <span className="label">{ai === "off" ? "IA desconectada" : `IA local · ${model || "sin modelo"}`}</span>
          </div>
          {ai === "off" && (
            <button className="link label" onClick={checkAi}>
              Reintentar conexión
            </button>
          )}
          <p className="folder label" title={folder}>📁 {folder.replace(/^\/home\/[^/]+/, "~")}</p>
        </div>
      </aside>

      {/* ---------- Lista de notas (cajón en pantallas angostas) ---------- */}
      {listOpen && <div className="backdrop" onClick={() => setListOpen(false)} />}
      <section className={`list ${listOpen ? "open" : ""}`}>
        <header className="list-head">
          <h2>{tagFilter ?? "Todas las notas"}</h2>
          <button className="icon-btn" title="Nueva nota" onClick={newNote}>
            ✎
          </button>
        </header>
        <div className="search">
          <span>⌕</span>
          <input
            placeholder="Buscar notas…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="items">
          {visible.map((n) => (
            <button
              key={n.id}
              className={`item ${n.id === activeId ? "on" : ""}`}
              onClick={() => openNote(n.id)}
            >
              <div className="item-title">{n.title}</div>
              <div className="item-preview">{n.preview || "Sin contenido"}</div>
              <div className="item-time">{timeAgo(n.modified)}</div>
            </button>
          ))}
          {visible.length === 0 && <p className="hint pad">No hay notas aquí todavía.</p>}
        </div>
      </section>

      {/* ---------- Área principal ---------- */}
      <main className="main">
        {!activeId ? (
          <div className="hero">
            <div className="hero-bg" />
            <button className="icon-btn menu-btn hero-menu" title="Ver notas" onClick={() => setListOpen(true)}>
              ☰
            </button>
            <div className="hero-content">
              <span className="pill">✦ Tu IA, tus apuntes</span>
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
              <button className="icon-btn menu-btn" title="Ver notas" onClick={() => setListOpen(true)}>
                ☰
              </button>
              <div className="crumbs">
                <span className="crumb-root">
                  Todas las notas <span>›</span>
                </span>{" "}
                <b>{active?.title ?? "Nota sin título"}</b>
              </div>
              <div className="tools">
                <span className={`status ${status[ai].cls}`} title={aiError || status[ai].label}>
                  <i /> <span className="status-label">{status[ai].label}</span>
                </span>
                {models.length > 0 && (
                  <select value={model} onChange={(e) => setModel(e.target.value)}>
                    {models.map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                  </select>
                )}
                <button
                  className="btn"
                  disabled={!model || ai === "working" || content.trim().length < MIN_CHARS}
                  onClick={() => activeId && runAi(content, activeId)}
                  title="Ordenar ahora"
                >
                  ✦<span className="btn-label"> Ordenar ahora</span>
                </button>
                <button className="icon-btn danger" title="Borrar nota" onClick={removeNote}>
                  🗑
                </button>
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
                <div className="pane-label accent">✦ Versión ordenada</div>
                {ai === "off" ? (
                  <div className="setup">
                    <h3>Conecta la IA (gratis)</h3>
                    <p>TaskAI usa Ollama para correr la IA en tu propia computadora: privado y sin costo.</p>
                    <ol>
                      <li>
                        Descarga Ollama en <b>ollama.com/download</b> (Windows, Mac y Linux)
                      </li>
                      <li>
                        Abre una terminal y baja un modelo: <code>ollama pull qwen2.5:7b</code>
                      </li>
                      <li>
                        ¿Compu modesta? Usa uno ligero: <code>ollama pull qwen2.5:3b</code>
                      </li>
                    </ol>
                    <button className="btn" onClick={checkAi}>
                      Ya lo hice, conectar
                    </button>
                  </div>
                ) : structured ? (
                  <article
                    className={`md ${ai === "working" ? "dim" : ""}`}
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
    </div>
  );
}
