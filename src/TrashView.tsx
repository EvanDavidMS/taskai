// Papelera: las notas borradas se guardan 30 días y se pueden recuperar.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FolderTag, Icon } from "./icons";

type TrashItem = { id: string; folder: string; title: string; preview: string; deleted: number; days_left: number };

export default function TrashView({
  onRestored,
  ask,
}: {
  onRestored: (folder: string) => void;
  ask: (opts: { title: string; text: string; ok: string; run: () => void }) => void;
}) {
  const [items, setItems] = useState<TrashItem[] | null>(null);
  const load = () => invoke<TrashItem[]>("list_trash").then(setItems);
  useEffect(() => {
    load();
  }, []);

  if (!items) return null;
  return (
    <div className="tasks">
      <div className="tasks-bar">
        <span className="board-count">
          {items.length} {items.length === 1 ? "nota" : "notas"} · se borran solas a los 30 días
        </span>
        {items.length > 0 && (
          <button
            className="btn ghost danger-text"
            onClick={() =>
              ask({
                title: "¿Vaciar la papelera?",
                text: `Se borrarán para siempre ${items.length === 1 ? "1 nota" : `${items.length} notas`}. Esto sí no se puede deshacer.`,
                ok: "Sí, vaciar",
                run: async () => {
                  await invoke("empty_trash");
                  load();
                },
              })
            }
          >
            <Icon name="trash" size={14} /> Vaciar papelera
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="board-none">
          <div className="tasks-empty-ico">
            <Icon name="trash" size={24} />
          </div>
          <p>La papelera está vacía. Lo que borres se queda aquí 30 días por si te arrepientes.</p>
        </div>
      ) : (
        <div className="tlist">
          {items.map((n) => (
            <div key={n.id} className="trash-row">
              <div className="tmain">
                <div className="ttext">{n.title}</div>
                {n.preview && <p className="trash-preview">{n.preview}</p>}
                <div className="tmeta">
                  <FolderTag name={n.folder} />
                  <span className="trash-left">
                    {n.days_left <= 1 ? "Se borra mañana" : `Se borra en ${n.days_left} días`}
                  </span>
                </div>
              </div>
              <div className="trash-actions">
                <button
                  className="btn"
                  onClick={async () => {
                    const folder = await invoke<string>("restore_note", { id: n.id });
                    await load();
                    onRestored(folder);
                  }}
                >
                  <Icon name="restore" size={14} /> Restaurar
                </button>
                <button
                  className="icon-btn danger-hover"
                  title="Borrar para siempre"
                  aria-label={`Borrar para siempre ${n.title}`}
                  onClick={() =>
                    ask({
                      title: "¿Borrar para siempre?",
                      text: `“${n.title}” se borrará definitivamente. Esto no se puede deshacer.`,
                      ok: "Borrar para siempre",
                      run: async () => {
                        await invoke("purge_note", { id: n.id });
                        load();
                      },
                    })
                  }
                >
                  <Icon name="x" size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
