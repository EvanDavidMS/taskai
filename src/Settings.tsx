import { useEffect, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { ACCENTS } from "./accents";
import { type RemindPrefs, loadRemind, notify, saveRemind } from "./reminders";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Icon, type IconName } from "./icons";

export type SystemInfo = {
  os: string;
  distro: string | null;
  distro_like: string | null;
  distro_name: string | null;
};
export type OsKey = "windows" | "macos" | "linux";
type Pull = { status: string; percent: number | null; error?: string };

export const RECOMMENDED = [
  {
    name: "qwen2.5:3b",
    tag: "Ligero",
    size: "1.9 GB",
    desc: "Para compus con 8 GB de RAM o sin tarjeta de video. Rápido, ordena un poco menos fino.",
  },
  {
    name: "qwen2.5:7b",
    tag: "Recomendado",
    size: "4.7 GB",
    desc: "El mejor equilibrio. Ideal si tienes tarjeta de video o 16 GB de RAM.",
  },
  {
    name: "qwen2.5:14b",
    tag: "Potente",
    size: "9 GB",
    desc: "El más inteligente. Pide tarjeta de video de 12 GB o 32 GB de RAM.",
  },
];

export const OS_LABEL: Record<OsKey, string> = { windows: "Windows", macos: "macOS", linux: "Linux" };

export function Cmd({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="cmd">
      <code>{children}</code>
      <button
        onClick={() => {
          navigator.clipboard.writeText(children);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? "✓ Copiado" : "Copiar"}
      </button>
    </div>
  );
}

export function Steps({ os, info }: { os: OsKey; info: SystemInfo | null }) {
  const isArch =
    info?.distro === "arch" || (info?.distro_like ?? "").split(" ").includes("arch");

  if (os === "windows")
    return (
      <ol className="steps">
        <li>
          <b>Descarga el instalador de Ollama</b>
          <button className="btn" onClick={() => openUrl("https://ollama.com/download/windows")}>
            ⬇ Descargar para Windows
          </button>
        </li>
        <li>
          <b>Ábrelo y sigue los pasos</b> (Siguiente → Instalar). Ollama se queda corriendo junto al reloj,
          en la bandeja del sistema.
        </li>
        <li>
          <b>Descarga un modelo</b> con un clic, desde TaskAI.
        </li>
      </ol>
    );

  if (os === "macos")
    return (
      <ol className="steps">
        <li>
          <b>Descarga Ollama para Mac</b>
          <button className="btn" onClick={() => openUrl("https://ollama.com/download/mac")}>
            ⬇ Descargar para macOS
          </button>
        </li>
        <li>
          <b>Arrastra Ollama a Aplicaciones</b> y ábrelo una vez. Verás su ícono en la barra de arriba.
        </li>
        <li>
          <b>Descarga un modelo</b> con un clic, desde TaskAI.
        </li>
      </ol>
    );

  return (
    <ol className="steps">
      {isArch ? (
        <>
          <li>
            <b>Instala Ollama</b> (la versión Vulkan usa tu tarjeta NVIDIA, AMD o Intel sin bajar CUDA):
            <Cmd>sudo pacman -S ollama ollama-vulkan</Cmd>
          </li>
          <li>
            <b>Enciéndelo</b> (y que arranque solo cada vez que prendas la compu):
            <Cmd>sudo systemctl enable --now ollama</Cmd>
          </li>
        </>
      ) : (
        <li>
          <b>Instala Ollama</b> con el instalador oficial (detecta tu tarjeta de video y lo deja encendido):
          <Cmd>curl -fsSL https://ollama.com/install.sh | sh</Cmd>
        </li>
      )}
      <li>
        <b>Descarga un modelo</b> con un clic, desde TaskAI.
      </li>
    </ol>
  );
}

// ----- Atajos de teclado (la lista que se muestra en Configuración) -----
export const SHORTCUTS: [string, string][] = [
  ["Ctrl + N", "Nueva nota"],
  ["Ctrl + K", "Buscar en tus notas"],
  ["Ctrl + Enter", "Ordenar la nota ahora"],
  ["Ctrl + E", "Cambiar entre escribir y modo lectura"],
  ["Esc", "Volver a tus notas"],
  ["Ctrl + ,", "Abrir Configuración"],
  ["Supr", "Mandar a la papelera la tarjeta seleccionada"],
];

export type AskFn = (o: { title: string; text: string; ok: string; run: () => void }) => void;

type Tab = "general" | "look" | "ai" | "remind" | "keys";
const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: "general", label: "General", icon: "settings" },
  { id: "look", label: "Apariencia", icon: "palette" },
  { id: "ai", label: "Inteligencia artificial", icon: "sparkle" },
  { id: "remind", label: "Recordatorios", icon: "bell" },
  { id: "keys", label: "Atajos de teclado", icon: "keyboard" },
];

/** Configuración: una página con sus secciones a un lado (ya no una ventana flotante). */
export default function Settings({
  models,
  model,
  setModel,
  aiOff,
  onRefresh,
  theme,
  setTheme,
  accent,
  setAccent,
  onProfileChanged,
  power,
  onPower,
  ask,
}: {
  power: "idle" | "starting" | "stopping";
  onPower: (on: boolean) => void;
  ask: AskFn;
  models: string[];
  model: string;
  setModel: (m: string) => void;
  aiOff: boolean;
  onRefresh: () => Promise<void>;
  theme: "system" | "light" | "dark";
  setTheme: (t: "system" | "light" | "dark") => void;
  accent: string;
  setAccent: (id: string) => void;
  onProfileChanged: () => Promise<void>;
}) {
  const [tab, setTab] = useState<Tab>(() => {
    try {
      return (localStorage.getItem("taskai.settingsTab") as Tab) || "general";
    } catch {
      return "general";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("taskai.settingsTab", tab);
    } catch {
      /* sin almacenamiento */
    }
  }, [tab]);

  return (
    <div className="settings">
      <nav className="set-nav" aria-label="Secciones de configuración">
        {TABS.map((t) => (
          <button key={t.id} className={`set-tab ${tab === t.id ? "on" : ""}`} onClick={() => setTab(t.id)}>
            <Icon name={t.icon} size={16} />
            <span>{t.label}</span>
            {t.id === "ai" && aiOff && <i className="set-warn" title="Ollama no está corriendo" />}
          </button>
        ))}
      </nav>
      <div className="set-body">
        {tab === "general" && <GeneralTab onProfileChanged={onProfileChanged} />}
        {tab === "look" && <LookTab theme={theme} setTheme={setTheme} accent={accent} setAccent={setAccent} />}
        {tab === "ai" && (
          <AiTab
            models={models}
            model={model}
            setModel={setModel}
            aiOff={aiOff}
            onRefresh={onRefresh}
            power={power}
            onPower={onPower}
            ask={ask}
          />
        )}
        {tab === "remind" && <RemindTab />}
        {tab === "keys" && <KeysTab />}
      </div>
    </div>
  );
}

function Card({ title, desc, children }: { title: string; desc?: string; children: ReactNode }) {
  return (
    <section className="set-card">
      <h3>{title}</h3>
      {desc && <p className="set-desc">{desc}</p>}
      {children}
    </section>
  );
}

type ConfigView = { name: string; notes_dir: string; default_dir: string };

// ---------- General: tu nombre y la carpeta de notas ----------
function GeneralTab({ onProfileChanged }: { onProfileChanged: () => Promise<void> }) {
  const [cfg, setCfg] = useState<ConfigView | null>(null);
  const [name, setName] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const load = async () => {
    const c = await invoke<ConfigView>("get_config");
    setCfg(c);
    setName(c.name);
  };
  useEffect(() => {
    load();
  }, []);

  async function save(newName: string, dir: string | null) {
    setErr("");
    try {
      await invoke("save_config", { name: newName, notesDir: dir, onboarded: true });
      await load();
      await onProfileChanged();
      setMsg("✓ Guardado");
      setTimeout(() => setMsg(""), 1800);
    } catch (e) {
      setErr(String(e));
    }
  }
  if (!cfg) return null;
  const custom = cfg.notes_dir !== cfg.default_dir;
  const dirArg = custom ? cfg.notes_dir : null;

  return (
    <>
      <Card title="Tu nombre" desc="Así te saluda TaskAI en el tablero.">
        <div className="set-inline">
          <input
            className="set-input"
            value={name}
            maxLength={40}
            placeholder="Tu nombre"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && name.trim() && save(name, dirArg)}
          />
          <button className="btn primary" disabled={!name.trim() || name.trim() === cfg.name} onClick={() => save(name, dirArg)}>
            Guardar
          </button>
          {msg && <span className="set-ok">{msg}</span>}
        </div>
      </Card>

      <Card
        title="Carpeta de tus notas"
        desc="Tus notas son archivos .md normales: los puedes abrir en Obsidian, respaldar o sincronizar con tu nube."
      >
        <div className="cmd">
          <code>{cfg.notes_dir}</code>
          <button onClick={() => revealItemInDir(cfg.notes_dir)}>Abrir</button>
        </div>
        <div className="set-actions">
          <button
            className="btn"
            onClick={async () => {
              const dir = await openDialog({ directory: true, title: "Elige dónde guardar tus notas" });
              if (typeof dir === "string" && dir !== cfg.notes_dir) save(cfg.name, dir);
            }}
          >
            <Icon name="folder" size={14} /> Cambiar carpeta…
          </button>
          {custom && (
            <button className="btn ghost" onClick={() => save(cfg.name, null)}>
              Volver a la de siempre
            </button>
          )}
        </div>
        <p className="set-note">
          Al cambiarla, tus notas actuales se quedan donde están: TaskAI empieza a usar la carpeta nueva. Si quieres
          llevártelas, copia la carpeta completa (incluida la oculta <code>.taskai</code>).
        </p>
        {err && <p className="err-text">{err}</p>}
      </Card>
    </>
  );
}

// ---------- Apariencia ----------
function LookTab({
  theme,
  setTheme,
  accent,
  setAccent,
}: {
  theme: "system" | "light" | "dark";
  setTheme: (t: "system" | "light" | "dark") => void;
  accent: string;
  setAccent: (id: string) => void;
}) {
  return (
    <>
      <Card title="Tema" desc="“Sistema” sigue el modo claro u oscuro de tu computadora.">
        <div className="theme-cards">
          {(
            [
              ["light", "Claro", "sun"],
              ["dark", "Oscuro", "moon"],
              ["system", "Sistema", "monitor"],
            ] as const
          ).map(([k, label, ico]) => (
            <button key={k} className={`theme-card ${k} ${theme === k ? "on" : ""}`} onClick={() => setTheme(k)}>
              <span className="mock" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <span className="theme-label">
                <Icon name={ico} size={14} /> {label}
              </span>
            </button>
          ))}
        </div>
      </Card>
      <Card title="Color principal" desc="Pinta botones, etiquetas activas, palomitas y el número de la línea actual.">
        <div className="swatches" role="radiogroup" aria-label="Color principal">
          {ACCENTS.map((a) => (
            <button
              key={a.id}
              role="radio"
              aria-checked={accent === a.id}
              aria-label={a.name}
              title={a.name}
              className={`swatch ${accent === a.id ? "on" : ""}`}
              style={
                {
                  "--sw": a.dark,
                  "--sw-l": a.light,
                  "--sw-on": a.onDark ?? "255 255 255",
                  "--sw-on-l": a.onLight ?? "255 255 255",
                } as CSSProperties
              }
              onClick={() => setAccent(a.id)}
            />
          ))}
        </div>
        <p className="set-note">
          Elegido: <b style={{ color: "var(--accent)" }}>{ACCENTS.find((a) => a.id === accent)?.name ?? "Naranja"}</b>
        </p>
      </Card>
    </>
  );
}

/** Encender Ollama al abrir TaskAI / apagarlo al cerrar (se guarda en config.json: Rust lo usa al cerrar). */
function AutoPower() {
  const [p, setP] = useState<{ start: boolean; stop: boolean } | null>(null);
  useEffect(() => {
    invoke<{ start_ai_on_open: boolean; stop_ai_on_exit: boolean }>("get_config").then((c) =>
      setP({ start: c.start_ai_on_open, stop: c.stop_ai_on_exit }),
    );
  }, []);
  if (!p) return null;
  const update = (n: { start: boolean; stop: boolean }) => {
    setP(n);
    invoke("set_ai_power", { startOnOpen: n.start, stopOnExit: n.stop });
  };
  return (
    <div className="switches">
      <label className="switch-row">
        <input type="checkbox" checked={p.start} onChange={(e) => update({ ...p, start: e.target.checked })} />
        <span className="switch" aria-hidden="true" />
        <span>Encender la IA al abrir TaskAI</span>
      </label>
      <label className="switch-row">
        <input type="checkbox" checked={p.stop} onChange={(e) => update({ ...p, stop: e.target.checked })} />
        <span className="switch" aria-hidden="true" />
        <span>Apagar la IA al cerrar TaskAI (recomendado: libera tu tarjeta de video)</span>
      </label>
    </div>
  );
}

// ---------- Inteligencia artificial: Ollama y modelos ----------
function AiTab({
  models,
  model,
  setModel,
  aiOff,
  onRefresh,
  power,
  onPower,
  ask,
}: {
  models: string[];
  model: string;
  setModel: (m: string) => void;
  aiOff: boolean;
  onRefresh: () => Promise<void>;
  power: "idle" | "starting" | "stopping";
  onPower: (on: boolean) => void;
  ask: AskFn;
}) {
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [osTab, setOsTab] = useState<OsKey | null>(null);
  const [showOthers, setShowOthers] = useState(false);
  const [pulls, setPulls] = useState<Record<string, Pull>>({});
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    invoke<SystemInfo>("system_info").then((i) => {
      setInfo(i);
      if (i.os === "windows" || i.os === "macos" || i.os === "linux") setOsTab(i.os);
      else setShowOthers(true);
    });
    const un = listen<{ model: string; status: string; percent: number | null }>("pull-progress", (e) => {
      setPulls((p) => ({ ...p, [e.payload.model]: { status: e.payload.status, percent: e.payload.percent } }));
    });
    return () => {
      un.then((f) => f());
    };
  }, []);

  const detected: OsKey | null =
    info && (info.os === "windows" || info.os === "macos" || info.os === "linux") ? info.os : null;
  const detectedLabel = detected ? (detected === "linux" && info?.distro_name ? info.distro_name : OS_LABEL[detected]) : null;

  async function pull(name: string) {
    setPulls((p) => ({ ...p, [name]: { status: "Iniciando…", percent: 0 } }));
    try {
      await invoke("ai_pull", { model: name });
      setPulls((p) => {
        const { [name]: _, ...rest } = p;
        return rest;
      });
      await onRefresh();
      if (!model) setModel(name);
    } catch (e) {
      setPulls((p) => ({ ...p, [name]: { status: "", percent: null, error: String(e) } }));
    }
  }

  const extra = models.filter((m) => !RECOMMENDED.some((r) => r.name === m));
  const isInstalled = (n: string) => models.includes(n) || models.includes(`${n}:latest`);

  // Cuánto ocupa cada modelo descargado
  const [sizes, setSizes] = useState<Record<string, number>>({});
  const modelsKey = models.join("|");
  useEffect(() => {
    invoke<Record<string, number>>("ai_model_sizes").then(setSizes).catch(() => setSizes({}));
  }, [modelsKey]);
  const gb = (b: number) => `${(b / 1024 ** 3).toFixed(1)} GB`;

  /** Botón de basura: borra el modelo de la computadora (con confirmación). */
  function DeleteModel({ name }: { name: string }) {
    return (
      <button
        className="icon-btn danger-hover"
        title="Eliminar este modelo de tu computadora"
        aria-label={`Eliminar el modelo ${name}`}
        onClick={() =>
          ask({
            title: "¿Eliminar este modelo?",
            text: `Se borrará ${name}${sizes[name] ? ` y liberarás ${gb(sizes[name])}` : ""}. Lo puedes volver a descargar cuando quieras.`,
            ok: "Sí, eliminar",
            run: async () => {
              try {
                await invoke("ai_delete", { model: name });
              } catch (e) {
                alert(String(e));
              }
              await onRefresh(); // si era el que usabas, TaskAI cambia solo a otro que tengas
            },
          })
        }
      >
        <Icon name="trash" size={15} />
      </button>
    );
  }

  return (
    <>
      <section className="set-card status-card">
        <div className={`big-dot ${aiOff ? "off" : "on"}`} />
        <div>
          <b>{power === "starting" ? "Encendiendo la IA…" : power === "stopping" ? "Apagando la IA…" : aiOff ? "La IA está apagada" : "IA encendida"}</b>
          <p>
            {aiOff
              ? "Enciéndela aquí. Si nunca has instalado Ollama, sigue los pasos de abajo: es gratis y tus notas nunca salen de tu compu."
              : model
                ? `Usando ${model}. Todo corre en tu computadora, sin internet.`
                : "Ollama está listo. Descarga un modelo abajo."}
          </p>
        </div>
        <div className="status-actions">
          <button
            className={`btn ${aiOff ? "primary" : "ghost"}`}
            disabled={power !== "idle"}
            onClick={() => onPower(aiOff)}
          >
            <Icon name="power" size={14} /> {aiOff ? "Encender" : "Apagar"}
          </button>
          <button
            className="link"
            disabled={checking}
            onClick={async () => {
              setChecking(true);
              await onRefresh();
              setChecking(false);
            }}
          >
            {checking ? "Revisando…" : "↻ Revisar"}
          </button>
        </div>
      </section>

      <Card
        title="Encendido automático"
        desc="Ollama sigue corriendo aunque cierres TaskAI y, mientras tanto, ocupa memoria de tu tarjeta de video. Aquí decides qué pasa."
      >
        <AutoPower />
        <p className="set-note">
          Si un día desinstalas TaskAI, el desinstalador te pregunta si también quieres quitar Ollama y los modelos,
          para no dejar nada en tu computadora.
        </p>
      </Card>

      <Card title="Modelo" desc="El “cerebro” de la IA. Se descarga una sola vez y funciona sin internet.">
        <div className="models">
          {RECOMMENDED.map((r) => {
            const installed = isInstalled(r.name);
            const pr = pulls[r.name];
            const active = model === r.name;
            return (
              <div key={r.name} className={`model ${active ? "active" : ""}`}>
                <div className="model-info">
                  <div className="model-title">
                    <b>{r.name}</b>
                    <span className={`chip ${r.tag === "Recomendado" ? "accent" : ""}`}>{r.tag}</span>
                    <span className="size">{r.size}</span>
                  </div>
                  <p>{r.desc}</p>
                  {pr && !pr.error && (
                    <div className="progress">
                      <div style={{ width: `${pr.percent ?? 0}%` }} />
                      <span>
                        {pr.percent != null ? `${pr.percent.toFixed(0)}%` : ""} {pr.status}
                      </span>
                    </div>
                  )}
                  {pr?.error && <p className="err-text">Error: {pr.error}</p>}
                </div>
                {installed ? (
                  <div className="model-actions">
                    {active ? (
                      <span className="in-use">✓ En uso</span>
                    ) : (
                      <button className="btn" onClick={() => setModel(r.name)}>
                        Usar
                      </button>
                    )}
                    <DeleteModel name={r.name} />
                  </div>
                ) : (
                  <button className="btn" disabled={aiOff || (!!pr && !pr.error)} onClick={() => pull(r.name)}>
                    {pr && !pr.error ? "Descargando…" : "⬇ Descargar"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {extra.length > 0 && (
          <>
            <p className="set-note">Otros modelos que tienes instalados:</p>
            <div className="models">
              {extra.map((m) => (
                <div key={m} className={`model compact ${model === m ? "active" : ""}`}>
                  <b>
                    {m} {sizes[m] ? <span className="size">{gb(sizes[m])}</span> : null}
                  </b>
                  <div className="model-actions">
                    {model === m ? (
                      <span className="in-use">✓ En uso</span>
                    ) : (
                      <button className="btn" onClick={() => setModel(m)}>
                        Usar
                      </button>
                    )}
                    <DeleteModel name={m} />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
        {aiOff && <p className="hint-box">Primero instala y enciende Ollama para poder descargar modelos.</p>}
      </Card>

      <Card title="Instalar Ollama" desc="Ollama es el programa gratis que corre la IA en tu computadora.">
        {detected && !showOthers && (
          <>
            <p className="detected">
              Detectamos <b>{detectedLabel}</b>. Estos son tus pasos:
            </p>
            <Steps os={detected} info={info} />
            <button className="link" onClick={() => setShowOthers(true)}>
              ¿Usas otro sistema? Ver todos los pasos
            </button>
          </>
        )}
        {showOthers && (
          <>
            {!detected && <p className="detected">No pudimos detectar tu sistema. Elige el tuyo:</p>}
            <div className="os-tabs">
              {(Object.keys(OS_LABEL) as OsKey[]).map((k) => (
                <button key={k} className={osTab === k ? "on" : ""} onClick={() => setOsTab(k)}>
                  {OS_LABEL[k]}
                  {k === detected && <span className="you">tú</span>}
                </button>
              ))}
            </div>
            {osTab ? <Steps os={osTab} info={osTab === detected ? info : null} /> : <p className="hint">Elige tu sistema.</p>}
          </>
        )}
      </Card>
    </>
  );
}

// ---------- Recordatorios ----------
function RemindTab() {
  const [remind, setRemind] = useState<RemindPrefs>(loadRemind);
  const update = (p: RemindPrefs) => {
    setRemind(p);
    saveRemind(p);
  };
  return (
    <Card
      title="Avisos de tus pendientes"
      desc="Avisa de los pendientes que tienen hora y, desde las 8:00 AM, te manda un resumen de lo de hoy. TaskAI tiene que estar abierta (puede estar minimizada)."
    >
      <label className="switch-row">
        <input type="checkbox" checked={remind.on} onChange={(e) => update({ ...remind, on: e.target.checked })} />
        <span className="switch" aria-hidden="true" />
        <span>Avisarme de mis pendientes con fecha</span>
      </label>
      {remind.on && (
        <div className="remind-row">
          <span>Avisar</span>
          <select value={remind.lead} onChange={(e) => update({ ...remind, lead: Number(e.target.value) })}>
            {[0, 5, 10, 15, 30, 60].map((m) => (
              <option key={m} value={m}>
                {m === 0 ? "a la hora exacta" : m === 60 ? "1 hora antes" : `${m} min antes`}
              </option>
            ))}
          </select>
          <button
            className="btn ghost"
            onClick={() => notify("✦ Así se ven tus recordatorios", "Ejemplo: junta con Kuroo · vie 20 nov · 2:00 PM")}
          >
            <Icon name="bell" size={14} /> Probar aviso
          </button>
        </div>
      )}
    </Card>
  );
}

// ---------- Atajos ----------
function KeysTab() {
  return (
    <Card title="Atajos de teclado" desc="Para moverte sin soltar el teclado.">
      <div className="keys">
        {SHORTCUTS.map(([k, what]) => (
          <div key={k} className="key-row">
            <span>{what}</span>
            <span className="kbds">
              {k.split(" + ").map((p, i) => (
                <span key={i}>
                  {i > 0 && <em>+</em>}
                  <kbd>{p}</kbd>
                </span>
              ))}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}
