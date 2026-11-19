import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Cmd, OS_LABEL, RECOMMENDED, Steps, type OsKey, type SystemInfo } from "./Settings";

type ThemePref = "system" | "light" | "dark";
type Config = { name: string; notes_dir: string; default_dir: string; onboarded: boolean };
type OllamaStatus = { installed: boolean; running: boolean };
type Install = { stage: "download" | "install" | "start" | "ready"; percent: number | null };
type Pull = { status: string; percent: number | null };

const STEPS = ["Nombre", "Apariencia", "Notas", "IA", "Modelo", "Listo"];

/**
 * Asistente de bienvenida: sale la primera vez que se abre TaskAI.
 * Pregunta nombre, tema y carpeta; detecta el sistema e instala Ollama y un modelo.
 */
export default function Onboarding({
  theme,
  setTheme,
  setModel,
  onDone,
}: {
  theme: ThemePref;
  setTheme: (t: ThemePref) => void;
  setModel: (m: string) => void;
  onDone: () => void;
}) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [cfg, setCfg] = useState<Config | null>(null);
  const [folder, setFolder] = useState("");
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [osPick, setOsPick] = useState<OsKey | null>(null);
  const [ollama, setOllama] = useState<OllamaStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [install, setInstall] = useState<Install | null>(null);
  const [installError, setInstallError] = useState("");
  const [installed, setInstalled] = useState<string[]>([]);
  const [choice, setChoice] = useState("qwen2.5:7b");
  const [pull, setPull] = useState<Pull | null>(null);
  const [pullError, setPullError] = useState("");
  const [error, setError] = useState("");

  const detected: OsKey | null =
    info && (info.os === "windows" || info.os === "macos" || info.os === "linux") ? info.os : null;
  const os = detected ?? osPick;
  const osLabel = detected === "linux" && info?.distro_name ? info.distro_name : detected ? OS_LABEL[detected] : "";

  async function check() {
    setChecking(true);
    const st = await invoke<OllamaStatus>("ollama_status");
    setOllama(st);
    if (st.running) setInstalled(await invoke<string[]>("ai_models").catch(() => []));
    setChecking(false);
  }

  useEffect(() => {
    invoke<Config>("get_config").then((c) => {
      setCfg(c);
      setName(c.name);
      setFolder(c.notes_dir);
    });
    invoke<SystemInfo>("system_info").then(setInfo);
    check();
    const a = listen<Install>("ollama-install", (e) => setInstall(e.payload));
    const b = listen<{ model: string; status: string; percent: number | null }>("pull-progress", (e) =>
      setPull({ status: e.payload.status, percent: e.payload.percent }),
    );
    return () => {
      a.then((f) => f());
      b.then((f) => f());
    };
  }, []);

  async function chooseFolder() {
    const picked = await openDialog({ directory: true, title: "¿Dónde guardo tus notas?", defaultPath: folder });
    if (typeof picked !== "string") return;
    // Guardamos dentro de una subcarpeta "TaskAI" para no regar archivos en la carpeta elegida
    const sep = picked.includes("\\") ? "\\" : "/";
    setFolder(/TaskAI[\\/]?$/.test(picked) ? picked : picked.replace(/[\\/]+$/, "") + sep + "TaskAI");
  }

  async function autoInstall() {
    setInstallError("");
    setInstall({ stage: "download", percent: 0 });
    try {
      await invoke("install_ollama");
      await check();
    } catch (e) {
      setInstallError(String(e));
      setInstall(null);
    }
  }

  async function downloadModel() {
    setPullError("");
    setPull({ status: "Iniciando…", percent: 0 });
    try {
      await invoke("ai_pull", { model: choice });
      setInstalled(await invoke<string[]>("ai_models"));
      setPull(null);
      setStep(5);
    } catch (e) {
      setPullError(String(e));
      setPull(null);
    }
  }

  async function finish() {
    setError("");
    try {
      await invoke("save_config", {
        name,
        notesDir: cfg && folder !== cfg.default_dir ? folder : null,
        onboarded: true,
      });
      if (installed.includes(choice)) setModel(choice);
      else if (installed.length) setModel(installed[0]);
      onDone();
    } catch (e) {
      setError(String(e));
    }
  }

  const modelReady = installed.includes(choice);
  const stageLabel: Record<Install["stage"], string> = {
    download: "Descargando Ollama…",
    install: "Instalando… (puede tardar un minuto)",
    start: "Encendiendo Ollama…",
    ready: "¡Listo!",
  };

  return (
    <div className="onb">
      <div className="hero-bg" />
      <div className="onb-card" role="dialog" aria-label="Bienvenida a TaskAI">
        <div className="onb-progress" aria-hidden>
          {STEPS.map((s, i) => (
            <span key={s} className={i <= step ? "on" : ""} />
          ))}
        </div>

        {step === 0 && (
          <section>
            <div className="logo big">✦</div>
            <h1>Bienvenido a TaskAI</h1>
            <p className="muted">Escribe como piensas; la IA lo ordena. Antes de empezar, ¿cómo te llamas?</p>
            <input
              className="onb-input"
              autoFocus
              placeholder="Tu nombre"
              maxLength={40}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && name.trim() && setStep(1)}
            />
            <div className="onb-actions">
              <span />
              <button className="btn primary" disabled={!name.trim()} onClick={() => setStep(1)}>
                Siguiente →
              </button>
            </div>
          </section>
        )}

        {step === 1 && (
          <section>
            <h1>¡Hola, {name.trim()}! 👋</h1>
            <p className="muted">¿Cómo prefieres ver TaskAI? Puedes cambiarlo cuando quieras.</p>
            <div className="theme-cards">
              {(
                [
                  ["light", "☀", "Claro"],
                  ["dark", "☾", "Oscuro"],
                  ["system", "◐", "Como mi sistema"],
                ] as const
              ).map(([k, ico, label]) => (
                <button key={k} className={`theme-card ${k} ${theme === k ? "on" : ""}`} onClick={() => setTheme(k)}>
                  <span className="mock">
                    <i />
                    <i />
                    <i />
                  </span>
                  {ico} {label}
                </button>
              ))}
            </div>
            <div className="onb-actions">
              <button className="link" onClick={() => setStep(0)}>
                ← Atrás
              </button>
              <button className="btn primary" onClick={() => setStep(2)}>
                Siguiente →
              </button>
            </div>
          </section>
        )}

        {step === 2 && (
          <section>
            <h1>¿Dónde guardo tus notas?</h1>
            <p className="muted">
              Son archivos <code>.md</code> normales: los puedes respaldar, sincronizar con tu nube o abrir en Obsidian.
            </p>
            <div className="cmd">
              <code title={folder}>{folder}</code>
              <button onClick={chooseFolder}>Cambiar…</button>
            </div>
            {cfg && folder !== cfg.default_dir && (
              <button className="link small-link" onClick={() => setFolder(cfg.default_dir)}>
                Usar la carpeta recomendada
              </button>
            )}
            <div className="onb-actions">
              <button className="link" onClick={() => setStep(1)}>
                ← Atrás
              </button>
              <button className="btn primary" onClick={() => setStep(3)}>
                Siguiente →
              </button>
            </div>
          </section>
        )}

        {step === 3 && (
          <section>
            <h1>Tu IA local</h1>
            <p className="muted">
              TaskAI usa <b>Ollama</b> para correr la IA en tu computadora: gratis, privado y sin internet.
            </p>

            {detected ? (
              <p className="detected">
                Detectamos <b>{osLabel}</b>.
              </p>
            ) : (
              <>
                <p className="detected">No pudimos detectar tu sistema. ¿Cuál usas?</p>
                <div className="os-tabs">
                  {(Object.keys(OS_LABEL) as OsKey[]).map((k) => (
                    <button key={k} className={osPick === k ? "on" : ""} onClick={() => setOsPick(k)}>
                      {OS_LABEL[k]}
                    </button>
                  ))}
                </div>
              </>
            )}

            {ollama?.running ? (
              <div className="ok-box">✓ Ollama ya está instalado y encendido.</div>
            ) : ollama?.installed ? (
              <div className="hint-box">
                Ollama está instalado pero apagado.{" "}
                {os === "windows" && "Ábrelo desde el menú Inicio."}
                {os === "macos" && "Ábrelo desde Aplicaciones."}
                {os === "linux" && <Cmd>sudo systemctl enable --now ollama</Cmd>}
              </div>
            ) : os === "windows" ? (
              <div className="auto-install">
                {install ? (
                  <>
                    <b>{stageLabel[install.stage]}</b>
                    <div className="progress">
                      <div style={{ width: `${install.stage === "download" ? (install.percent ?? 0) : 100}%` }} />
                      <span>{install.stage === "download" && install.percent != null ? `${install.percent.toFixed(0)}%` : ""}</span>
                    </div>
                  </>
                ) : (
                  <>
                    <button className="btn primary big" onClick={autoInstall}>
                      ⬇ Instalar Ollama automáticamente
                    </button>
                    <p className="muted small">Descarga el instalador oficial de ollama.com (≈1 GB) y lo instala por ti.</p>
                  </>
                )}
                {installError && <p className="err-text">{installError}</p>}
              </div>
            ) : os ? (
              <Steps os={os} info={detected ? info : null} />
            ) : null}

            <div className="onb-actions">
              <button className="link" onClick={() => setStep(2)}>
                ← Atrás
              </button>
              <div className="row">
                {!ollama?.running && (
                  <button className="btn" onClick={check} disabled={checking || (!!install && install.stage !== "ready")}>
                    {checking ? "Revisando…" : "↻ Revisar"}
                  </button>
                )}
                {ollama?.running ? (
                  <button className="btn primary" onClick={() => setStep(4)}>
                    Siguiente →
                  </button>
                ) : (
                  <button className="link" onClick={() => setStep(5)}>
                    Saltar por ahora
                  </button>
                )}
              </div>
            </div>
          </section>
        )}

        {step === 4 && (
          <section>
            <h1>Elige el cerebro de tu IA</h1>
            <p className="muted">Se descarga una sola vez. Después puedes cambiarlo en ⚙ Configuración.</p>
            <div className="models">
              {RECOMMENDED.map((r) => (
                <button
                  key={r.name}
                  className={`model pick ${choice === r.name ? "active" : ""}`}
                  onClick={() => !pull && setChoice(r.name)}
                >
                  <span className={`radio ${choice === r.name ? "on" : ""}`} />
                  <span className="model-info">
                    <span className="model-title">
                      <b>{r.name}</b>
                      <span className={`chip ${r.tag === "Recomendado" ? "accent" : ""}`}>{r.tag}</span>
                      <span className="size">{r.size}</span>
                      {installed.includes(r.name) && <span className="in-use">✓ Instalado</span>}
                    </span>
                    <p>{r.desc}</p>
                  </span>
                </button>
              ))}
            </div>
            {pull && (
              <div className="progress tall">
                <div style={{ width: `${pull.percent ?? 0}%` }} />
                <span>
                  {pull.percent != null ? `${pull.percent.toFixed(0)}% · ` : ""}
                  {pull.status}
                </span>
              </div>
            )}
            {pullError && <p className="err-text">{pullError}</p>}
            <div className="onb-actions">
              <button className="link" onClick={() => setStep(3)} disabled={!!pull}>
                ← Atrás
              </button>
              <div className="row">
                <button className="link" onClick={() => setStep(5)} disabled={!!pull}>
                  Después
                </button>
                {modelReady ? (
                  <button className="btn primary" onClick={() => setStep(5)}>
                    Usar este →
                  </button>
                ) : (
                  <button className="btn primary" onClick={downloadModel} disabled={!!pull}>
                    {pull ? "Descargando…" : "⬇ Descargar y continuar"}
                  </button>
                )}
              </div>
            </div>
          </section>
        )}

        {step === 5 && (
          <section>
            <div className="logo big">✦</div>
            <h1>¡Todo listo, {name.trim()}!</h1>
            <ul className="summary">
              <li>
                <span>Tema</span>
                <b>{theme === "light" ? "☀ Claro" : theme === "dark" ? "☾ Oscuro" : "◐ Como mi sistema"}</b>
              </li>
              <li>
                <span>Notas</span>
                <b title={folder}>{folder}</b>
              </li>
              <li>
                <span>IA</span>
                <b>
                  {ollama?.running
                    ? installed.length
                      ? `✓ ${installed.includes(choice) ? choice : installed[0]}`
                      : "Falta descargar un modelo (⚙ Configuración)"
                    : "Pendiente: instala Ollama en ⚙ Configuración"}
                </b>
              </li>
            </ul>
            {error && <p className="err-text">{error}</p>}
            <div className="onb-actions">
              <button className="link" onClick={() => setStep(ollama?.running ? 4 : 3)}>
                ← Atrás
              </button>
              <button className="btn primary big" onClick={finish}>
                Empezar a escribir →
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
