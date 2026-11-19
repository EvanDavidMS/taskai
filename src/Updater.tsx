// Actualizaciones automáticas: revisa el último Release de GitHub (latest.json, firmado por Evan)
// y ofrece instalar la versión nueva. Si no hay internet o no hay nada nuevo, no molesta.
import { useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { Icon } from "./icons";

/** ¿Buscar actualizaciones solo al abrir TaskAI? (Configuración → General → Versión). Encendido por defecto. */
export function autoUpdates(): boolean {
  try {
    return localStorage.getItem("taskai.autoUpdate") !== "0";
  } catch {
    return true;
  }
}
export function setAutoUpdates(on: boolean) {
  try {
    localStorage.setItem("taskai.autoUpdate", on ? "1" : "0");
  } catch {
    /* sin almacenamiento: se queda encendido */
  }
}

export async function findUpdate(): Promise<Update | null> {
  try {
    return await check();
  } catch {
    return null; // sin internet, GitHub caído o versión de desarrollo: no pasa nada
  }
}

/** Aviso flotante "Hay una versión nueva". `beforeInstall` guarda la nota abierta antes de cerrar la app. */
export function UpdateBanner({
  update,
  onClose,
  beforeInstall,
}: {
  update: Update;
  onClose: () => void;
  beforeInstall: () => Promise<void>;
}) {
  const [pct, setPct] = useState<number | null>(null);
  const [err, setErr] = useState("");

  async function install() {
    setErr("");
    setPct(0);
    try {
      await beforeInstall();
      let total = 0;
      let done = 0;
      await update.downloadAndInstall((e) => {
        if (e.event === "Started") total = e.data.contentLength ?? 0;
        if (e.event === "Progress") {
          done += e.data.chunkLength;
          setPct(total ? Math.min(100, (done / total) * 100) : null);
        }
        if (e.event === "Finished") setPct(100);
      });
      await relaunch(); // en Windows el instalador ya cierra y vuelve a abrir TaskAI
    } catch (e) {
      setPct(null);
      setErr(String(e));
    }
  }

  // Solo los puntos de la sección "Novedades" de las notas del Release, en corto ("Actualizaciones automáticas")
  const lines = (update.body ?? "").split("\n");
  const from = lines.findIndex((l) => /novedades/i.test(l));
  const notes = lines
    .slice(from + 1)
    .filter((l) => /^\s*[-*]\s+/.test(l))
    .map((l) => {
      const bold = l.match(/\*\*(.+?)\*\*/);
      return (bold ? bold[1] : l.replace(/^\s*[-*]\s+/, "")).replace(/:$/, "").trim();
    })
    .slice(0, 4);

  return (
    <div className="update-card" role="status">
      <div className="update-head">
        <span className="update-ico">
          <Icon name="sparkle" size={16} />
        </span>
        <div>
          <b>Hay una versión nueva de TaskAI</b>
          <p>
            {update.currentVersion} → <b>{update.version}</b>
          </p>
        </div>
        {pct == null && (
          <button className="icon-btn" title="Luego" aria-label="Cerrar aviso" onClick={onClose}>
            <Icon name="x" size={15} />
          </button>
        )}
      </div>
      {notes.length > 0 && pct == null && (
        <ul className="update-notes">
          {notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}
      {pct != null ? (
        <div className="progress">
          <div style={{ width: `${pct}%` }} />
          <span>{pct >= 100 ? "Instalando… TaskAI se volverá a abrir solo" : `Descargando ${pct.toFixed(0)}%`}</span>
        </div>
      ) : (
        <div className="update-actions">
          <button className="btn ghost" onClick={onClose}>
            Luego
          </button>
          <button className="btn primary" onClick={install}>
            Actualizar ahora
          </button>
        </div>
      )}
      {err && <p className="err-text">No se pudo actualizar: {err}</p>}
    </div>
  );
}
