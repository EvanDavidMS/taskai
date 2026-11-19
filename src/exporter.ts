// Exportar una nota: PDF (con la impresión del sistema), archivo .md, o copiar como texto / Markdown.
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";

/** Markdown → texto plano bonito (para pegar en WhatsApp, un correo, etc.). */
export function mdToText(md: string): string {
  return md
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/^\s*[-*+]\s+\[[xX]\]\s+/gm, "☑ ")
    .replace(/^\s*[-*+]\s+\[ \]\s+/gm, "☐ ")
    .replace(/^\s*[-*+]\s+/gm, "• ")
    .replace(/^>\s?/gm, "")
    .replace(/`/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Nombre de archivo válido en Windows a partir del título. */
export function fileName(title: string): string {
  return (title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "").trim() || "Nota").slice(0, 80);
}

/** "Guardar como" → escribe el .md donde el usuario elija. Devuelve false si canceló. */
export async function saveMarkdown(title: string, md: string): Promise<boolean> {
  const path = await save({
    title: "Guardar nota como Markdown",
    defaultPath: `${fileName(title)}.md`,
    filters: [{ name: "Markdown", extensions: ["md"] }],
  });
  if (!path) return false;
  await invoke("export_file", { path, content: md });
  return true;
}

/**
 * PDF: abre la ventana de impresión del sistema. Solo se imprime la nota (ver @media print en App.css);
 * ahí se elige "Microsoft Print to PDF". El título del documento se usa como nombre sugerido del archivo.
 */
export function printPdf(title: string) {
  const prev = document.title;
  document.title = fileName(title);
  document.documentElement.classList.add("printing");
  const done = () => {
    document.title = prev;
    document.documentElement.classList.remove("printing");
    window.removeEventListener("afterprint", done);
  };
  window.addEventListener("afterprint", done);
  window.print();
  setTimeout(done, 60000); // por si el navegador no avisa "afterprint"
}
