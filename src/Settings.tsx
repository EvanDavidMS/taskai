import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { ACCENTS } from "./accents";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";

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
          <b>Descarga un modelo</b> aquí abajo, con un clic.
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
          <b>Descarga un modelo</b> aquí abajo, con un clic.
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
        <b>Descarga un modelo</b> aquí abajo, con un clic.
      </li>
    </ol>
  );
}

export default function Settings({
  onClose,
  models,
  model,
  setModel,
  aiOff,
  onRefresh,
  folder,
  theme,
  setTheme,
  accent,
  setAccent,
}: {
  onClose: () => void;
  models: string[];
  model: string;
  setModel: (m: string) => void;
  aiOff: boolean;
  onRefresh: () => Promise<void>;
  folder: string;
  theme: "system" | "light" | "dark";
  setTheme: (t: "system" | "light" | "dark") => void;
  accent: string;
  setAccent: (id: string) => void;
}) {
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [tab, setTab] = useState<OsKey | null>(null);
  const [showOthers, setShowOthers] = useState(false);
  const [pulls, setPulls] = useState<Record<string, Pull>>({});
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    invoke<SystemInfo>("system_info").then((i) => {
      setInfo(i);
      if (i.os === "windows" || i.os === "macos" || i.os === "linux") setTab(i.os);
      else setShowOthers(true); // no se pudo detectar: mostramos todas las opciones
    });
    const un = listen<{ model: string; status: string; percent: number | null }>("pull-progress", (e) => {
      setPulls((p) => ({ ...p, [e.payload.model]: { status: e.payload.status, percent: e.payload.percent } }));
    });
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      un.then((f) => f());
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const detected: OsKey | null =
    info && (info.os === "windows" || info.os === "macos" || info.os === "linux") ? info.os : null;
  const detectedLabel = detected
    ? detected === "linux" && info?.distro_name
      ? info.distro_name
      : OS_LABEL[detected]
    : null;

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

  async function recheck() {
    setChecking(true);
    await onRefresh();
    setChecking(false);
  }

  const extra = models.filter((m) => !RECOMMENDED.some((r) => r.name === m));
  const isInstalled = (n: string) => models.includes(n) || models.includes(`${n}:latest`);

  return (
    <div className="modal-wrap" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Configuración">
        <header className="modal-head">
          <h2>⚙ Configuración</h2>
          <button className="icon-btn" onClick={onClose} title="Cerrar (Esc)">
            ✕
          </button>
        </header>

        <div className="modal-body">
          {/* ---------- Estado ---------- */}
          <section className="card status-card">
            <div className={`big-dot ${aiOff ? "off" : "on"}`} />
            <div>
              <b>{aiOff ? "Ollama no está corriendo" : "IA local conectada"}</b>
              <p>
                {aiOff
                  ? "Sigue los pasos de abajo para instalarlo. Es gratis y tus notas nunca salen de tu compu."
                  : model
                    ? `Usando ${model}. Todo corre en tu computadora.`
                    : "Ollama está listo. Descarga un modelo abajo."}
              </p>
            </div>
            <button className="btn" onClick={recheck} disabled={checking}>
              {checking ? "Revisando…" : "↻ Revisar"}
            </button>
          </section>

          {/* ---------- Instalar Ollama ---------- */}
          <section>
            <h3>1 · Instalar Ollama</h3>
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
                    <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
                      {OS_LABEL[k]}
                      {k === detected && <span className="you">tú</span>}
                    </button>
                  ))}
                </div>
                {tab ? <Steps os={tab} info={tab === detected ? info : null} /> : <p className="hint">Elige tu sistema.</p>}
              </>
            )}
          </section>

          {/* ---------- Modelos ---------- */}
          <section>
            <h3>2 · Elige tu modelo</h3>
            <p className="muted">
              El modelo es el "cerebro" de la IA. Se descarga una sola vez y funciona sin internet.
            </p>
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
                      active ? (
                        <span className="in-use">✓ En uso</span>
                      ) : (
                        <button className="btn" onClick={() => setModel(r.name)}>
                          Usar
                        </button>
                      )
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
                <p className="muted small">Otros modelos que tienes instalados:</p>
                <div className="models">
                  {extra.map((m) => (
                    <div key={m} className={`model compact ${model === m ? "active" : ""}`}>
                      <b>{m}</b>
                      {model === m ? (
                        <span className="in-use">✓ En uso</span>
                      ) : (
                        <button className="btn" onClick={() => setModel(m)}>
                          Usar
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
            {aiOff && <p className="hint-box">Primero instala y enciende Ollama para poder descargar modelos.</p>}
          </section>

          {/* ---------- Apariencia ---------- */}
          <section>
            <h3>Apariencia</h3>
            <div className="os-tabs">
              {(
                [
                  ["light", "☀ Claro"],
                  ["dark", "☾ Oscuro"],
                  ["system", "◐ Sistema"],
                ] as const
              ).map(([k, label]) => (
                <button key={k} className={theme === k ? "on" : ""} onClick={() => setTheme(k)}>
                  {label}
                </button>
              ))}
            </div>
            <p className="muted small">"Sistema" sigue el modo claro u oscuro de tu computadora.</p>

            <h3 style={{ marginTop: 20 }}>
              Color principal:{" "}
              <span style={{ color: "var(--accent)" }}>{ACCENTS.find((a) => a.id === accent)?.name ?? "Naranja"}</span>
            </h3>
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
          </section>

          {/* ---------- Notas ---------- */}
          <section>
            <h3>Tus notas</h3>
            <p className="muted">
              Se guardan como archivos <code>.md</code> normales (los puedes abrir en Obsidian o cualquier editor):
            </p>
            <div className="cmd">
              <code>{folder}</code>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
