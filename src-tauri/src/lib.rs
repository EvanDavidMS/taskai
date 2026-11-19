//! TaskAI — backend en Rust.
//! Las notas se guardan como archivos .md normales dentro de carpetas en ~/Documentos/TaskAI
//! (Notas rápidas, Diario, Escuela…). La versión ordenada por la IA se guarda aparte en .taskai/,
//! así nunca tocamos lo que escribió el usuario.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::UNIX_EPOCH;

const OLLAMA_URL: &str = "http://localhost:11434";

/// Carpetas que trae TaskAI de fábrica. La primera es la bandeja de entrada.
const DEFAULT_FOLDERS: [&str; 5] = ["Notas rápidas", "Diario", "Escuela", "Trabajo", "Hobbys"];
const INBOX: &str = "Notas rápidas";

// ----- Configuración del usuario (la llena el asistente de bienvenida) -----

#[derive(Serialize, Deserialize, Clone)]
struct AppConfig {
    #[serde(default)]
    name: String,
    /// Carpeta de notas elegida por el usuario. None = la de por defecto.
    #[serde(default)]
    notes_dir: Option<String>,
    #[serde(default)]
    onboarded: bool,
    /// Encender Ollama al abrir TaskAI si está apagado.
    #[serde(default = "yes")]
    start_ai_on_open: bool,
    /// Apagar Ollama al cerrar TaskAI (libera la tarjeta de video y la RAM).
    #[serde(default = "yes")]
    stop_ai_on_exit: bool,
}
fn yes() -> bool {
    true
}
impl Default for AppConfig {
    fn default() -> Self {
        AppConfig { name: String::new(), notes_dir: None, onboarded: false, start_ai_on_open: true, stop_ai_on_exit: true }
    }
}

fn config_path() -> Result<PathBuf, String> {
    let dir = dirs::config_dir().ok_or("No encontré la carpeta de configuración")?.join("TaskAI");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("config.json"))
}
fn load_config() -> AppConfig {
    config_path()
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn default_dir() -> Result<PathBuf, String> {
    let base = dirs::document_dir()
        .or_else(dirs::home_dir)
        .ok_or("No encontré la carpeta de documentos")?;
    Ok(base.join("TaskAI"))
}

fn base_dir() -> Result<PathBuf, String> {
    match load_config().notes_dir {
        Some(d) if !d.trim().is_empty() => Ok(PathBuf::from(d)),
        _ => default_dir(),
    }
}

/// Crea las carpetas la primera vez (o si el usuario cambió de carpeta) y mueve notas
/// sueltas en la raíz a Notas rápidas.
fn notes_dir() -> Result<PathBuf, String> {
    static READY: Mutex<Option<PathBuf>> = Mutex::new(None);
    let dir = base_dir()?;
    let mut ready = READY.lock().map_err(|e| e.to_string())?;
    if ready.as_ref() != Some(&dir) {
        fs::create_dir_all(dir.join(".taskai")).map_err(|e| e.to_string())?;
        for f in DEFAULT_FOLDERS {
            fs::create_dir_all(dir.join(f)).map_err(|e| e.to_string())?;
        }
        for entry in fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
            let p = entry.path();
            if p.is_file() && p.extension().and_then(|e| e.to_str()) == Some("md") {
                let _ = fs::rename(&p, dir.join(INBOX).join(entry.file_name()));
            }
        }
        *ready = Some(dir.clone());
    }
    Ok(dir)
}

#[derive(Serialize)]
struct ConfigView {
    name: String,
    notes_dir: String,
    default_dir: String,
    onboarded: bool,
    start_ai_on_open: bool,
    stop_ai_on_exit: bool,
}

#[tauri::command]
fn get_config() -> Result<ConfigView, String> {
    let c = load_config();
    Ok(ConfigView {
        name: c.name,
        notes_dir: base_dir()?.to_string_lossy().to_string(),
        default_dir: default_dir()?.to_string_lossy().to_string(),
        onboarded: c.onboarded,
        start_ai_on_open: c.start_ai_on_open,
        stop_ai_on_exit: c.stop_ai_on_exit,
    })
}

#[tauri::command]
fn save_config(name: String, notes_dir: Option<String>, onboarded: bool) -> Result<(), String> {
    let chosen = notes_dir.filter(|d| !d.trim().is_empty());
    if let Some(d) = &chosen {
        let p = PathBuf::from(d);
        if !p.is_absolute() {
            return Err("La carpeta debe ser una ruta completa".into());
        }
        fs::create_dir_all(&p).map_err(|e| format!("No pude usar esa carpeta: {e}"))?;
    }
    let cfg = AppConfig { name: name.trim().chars().take(40).collect(), notes_dir: chosen, onboarded, ..load_config() };
    let s = serde_json::to_string_pretty(&cfg).map_err(|e| e.to_string())?;
    fs::write(config_path()?, s).map_err(|e| e.to_string())?;
    crate::notes_dir()?; // prepara las carpetas en la ubicación nueva
    Ok(())
}

/// Evita que un id malicioso escape de la carpeta (../../etc/passwd).
fn safe_id(id: &str) -> Result<&str, String> {
    if id.is_empty() || id.contains(['/', '\\']) || id.contains("..") || id.starts_with('.') {
        return Err("Nombre de nota inválido".into());
    }
    Ok(id)
}

fn safe_folder(name: &str) -> Result<String, String> {
    let n = name.trim();
    if n.is_empty() || n.chars().count() > 40 || n.contains(['/', '\\', ':', '*', '?', '"', '<', '>', '|']) || n.contains("..") || n.starts_with('.') {
        return Err("Nombre de carpeta inválido".into());
    }
    Ok(n.to_string())
}

/// Todas las carpetas (no ocultas) dentro de TaskAI.
fn folder_names() -> Result<Vec<String>, String> {
    let dir = notes_dir()?;
    let mut custom: Vec<String> = fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .flatten()
        .filter(|e| e.path().is_dir())
        .map(|e| e.file_name().to_string_lossy().to_string())
        .filter(|n| !n.starts_with('.') && !DEFAULT_FOLDERS.contains(&n.as_str()))
        .collect();
    custom.sort_by_key(|n| n.to_lowercase());
    let mut all: Vec<String> = DEFAULT_FOLDERS.iter().map(|s| s.to_string()).collect();
    all.extend(custom);
    Ok(all)
}

/// Busca en qué carpeta vive una nota.
fn find_note(id: &str) -> Result<(String, PathBuf), String> {
    let dir = notes_dir()?;
    let file = format!("{}.md", safe_id(id)?);
    for f in folder_names()? {
        let p = dir.join(&f).join(&file);
        if p.exists() {
            return Ok((f, p));
        }
    }
    Err("No encontré la nota".into())
}

fn structured_path(id: &str) -> Result<PathBuf, String> {
    Ok(notes_dir()?.join(".taskai").join(format!("{}.md", safe_id(id)?)))
}

// ----- Metadatos: qué notas movió el usuario a mano (la IA ya no las toca) -----

#[derive(Serialize, Deserialize, Default, Clone)]
struct NoteInfo {
    /// La movió el usuario: la IA ya no la cambia de carpeta.
    #[serde(default)]
    locked: bool,
    /// Versión ordenada fijada: la IA ya no la reescribe sola.
    #[serde(default)]
    pinned: bool,
    /// Título que el usuario escribió a propósito (opcional). Manda sobre el de la IA.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    title: String,
}

fn meta_path() -> Result<PathBuf, String> {
    Ok(notes_dir()?.join(".taskai").join("meta.json"))
}
fn load_meta() -> HashMap<String, NoteInfo> {
    meta_path()
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}
fn save_meta(meta: &HashMap<String, NoteInfo>) -> Result<(), String> {
    let s = serde_json::to_string_pretty(meta).map_err(|e| e.to_string())?;
    fs::write(meta_path()?, s).map_err(|e| e.to_string())
}

// ----- Notas -----

#[derive(Serialize)]
struct NoteMeta {
    id: String,
    folder: String,
    title: String,
    preview: String,
    modified: u64,
    tags: Vec<String>,
    locked: bool,
    pinned: bool,
}

#[derive(Serialize)]
struct Note {
    content: String,
    structured: String,
    title: String,
}

/// Las imágenes pegadas quedan en el texto como `![imagen](img/<nombre>)`: no cuentan como texto.
fn is_image_line(l: &str) -> bool {
    let l = l.trim();
    l.starts_with("![") && l.ends_with(')')
}

fn title_of(content: &str) -> String {
    content
        .lines()
        .filter(|l| !is_image_line(l))
        .map(|l| l.trim_start_matches('#').trim())
        .find(|l| !l.is_empty())
        .unwrap_or("Nota sin título")
        .chars()
        .take(60)
        .collect()
}

fn tags_of(content: &str) -> Vec<String> {
    let mut tags: Vec<String> = content
        .split_whitespace()
        .filter(|w| w.starts_with('#') && w.len() > 1 && !w[1..].starts_with('#'))
        .map(|w| w.trim_end_matches([',', '.', ';', ':']).to_lowercase())
        .collect();
    tags.sort();
    tags.dedup();
    tags
}

#[tauri::command]
fn list_notes() -> Result<Vec<NoteMeta>, String> {
    let dir = notes_dir()?;
    let meta = load_meta();
    let mut notes = Vec::new();
    for folder in folder_names()? {
        let Ok(entries) = fs::read_dir(dir.join(&folder)) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("md") {
                continue;
            }
            let id = path.file_stem().unwrap().to_string_lossy().to_string();
            let content = fs::read_to_string(&path).unwrap_or_default();
            let modified = entry
                .metadata()
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            // Título: el que puso el usuario > el de la IA ("# ...") > la primera línea.
            let user_title = meta.get(&id).map(|m| m.title.clone()).filter(|t| !t.is_empty());
            let ai_title = user_title.or_else(|| {
                structured_path(&id)
                    .ok()
                    .and_then(|p| fs::read_to_string(p).ok())
                    .and_then(|s| s.lines().find(|l| l.starts_with("# ")).map(|l| l[2..].trim().to_string()))
                    .filter(|t| !t.is_empty())
            });
            let preview: String = content
                .lines()
                .map(str::trim)
                .filter(|l| !l.is_empty() && !is_image_line(l))
                .skip(if ai_title.is_some() { 0 } else { 1 })
                .collect::<Vec<_>>()
                .join(" ")
                .chars()
                .take(220) // alcanza para las 3 líneas de la tarjeta; el CSS pone los "…"
                .collect();
            notes.push(NoteMeta {
                locked: meta.get(&id).map(|m| m.locked).unwrap_or(false),
                pinned: meta.get(&id).map(|m| m.pinned).unwrap_or(false),
                id,
                folder: folder.clone(),
                title: ai_title.unwrap_or_else(|| title_of(&content)),
                preview,
                modified,
                tags: tags_of(&content),
            });
        }
    }
    notes.sort_by(|a, b| b.modified.cmp(&a.modified));
    Ok(notes)
}

#[tauri::command]
fn read_note(id: String) -> Result<Note, String> {
    let (_, path) = find_note(&id)?;
    Ok(Note {
        content: fs::read_to_string(path).unwrap_or_default(),
        structured: fs::read_to_string(structured_path(&id)?).unwrap_or_default(),
        title: load_meta().get(&id).map(|m| m.title.clone()).unwrap_or_default(),
    })
}

/// Guarda el título opcional que escribió el usuario (vacío = sin título propio).
#[tauri::command]
fn set_title(id: String, title: String) -> Result<(), String> {
    safe_id(&id)?;
    let title: String = title.trim().chars().take(80).collect();
    let mut meta = load_meta();
    if meta.get(&id).map(|m| m.title == title).unwrap_or(title.is_empty()) {
        return Ok(()); // sin cambios: no reescribimos meta.json
    }
    meta.entry(id).or_default().title = title;
    save_meta(&meta)
}

// ----- Imágenes pegadas (Ctrl + V) -----

fn images_dir() -> Result<PathBuf, String> {
    Ok(notes_dir()?.join(".taskai").join("img"))
}

/// Solo nombres que generamos nosotros: `1763532000000.png`.
fn safe_image(name: &str) -> Result<&str, String> {
    let ok = !name.is_empty()
        && !name.starts_with('.')
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_')
        && !name.contains("..");
    if ok { Ok(name) } else { Err("Nombre de imagen inválido".into()) }
}

/// Recibe los bytes crudos de la imagen (sin pasarlos por JSON) y devuelve su nombre.
#[tauri::command]
fn save_image(request: tauri::ipc::Request) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("No llegó la imagen".into());
    };
    if bytes.is_empty() || bytes.len() > 25 * 1024 * 1024 {
        return Err("La imagen está vacía o pesa más de 25 MB".into());
    }
    let ext = request.headers().get("x-ext").and_then(|v| v.to_str().ok()).unwrap_or("png");
    let ext = match ext {
        "png" | "jpg" | "gif" | "webp" | "bmp" => ext,
        _ => "png",
    };
    let dir = images_dir()?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut ms = std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    while dir.join(format!("{ms}.{ext}")).exists() {
        ms += 1;
    }
    let name = format!("{ms}.{ext}");
    fs::write(dir.join(&name), bytes).map_err(|e| e.to_string())?;
    Ok(name)
}

/// Devuelve los bytes de una imagen tal cual (llegan como ArrayBuffer a la interfaz).
#[tauri::command]
fn load_image(name: String) -> Result<tauri::ipc::Response, String> {
    let bytes = fs::read(images_dir()?.join(safe_image(&name)?)).map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Nombres de las imágenes que aparecen en el texto de una nota.
fn images_in(content: &str) -> Vec<String> {
    content
        .split("](img/")
        .skip(1)
        .filter_map(|rest| rest.split(')').next())
        .filter(|n| safe_image(n).is_ok())
        .map(String::from)
        .collect()
}

#[tauri::command]
fn save_note(id: String, content: String) -> Result<(), String> {
    let (_, path) = find_note(&id)?;
    fs::write(path, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_structured(id: String, content: String) -> Result<(), String> {
    fs::write(structured_path(&id)?, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn create_note(folder: Option<String>) -> Result<String, String> {
    let folder = safe_folder(folder.as_deref().unwrap_or(INBOX))?;
    let dir = notes_dir()?.join(&folder);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let ms = std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    let id = format!("nota-{ms}");
    fs::write(dir.join(format!("{id}.md")), "").map_err(|e| e.to_string())?;
    // Si el usuario la creó dentro de una carpeta concreta, esa es su decisión.
    if folder != INBOX {
        let mut meta = load_meta();
        meta.entry(id.clone()).or_default().locked = true;
        save_meta(&meta)?;
    }
    Ok(id)
}

// ----- Papelera: borrar no es para siempre; las notas se pueden restaurar durante 30 días -----

const TRASH_DAYS: u64 = 30;

#[derive(Serialize, Deserialize, Clone)]
struct TrashInfo {
    folder: String,
    deleted: u64,
    title: String,
    #[serde(default)]
    preview: String,
    #[serde(default)]
    info: NoteInfo,
}

#[derive(Serialize)]
struct TrashItem {
    id: String,
    folder: String,
    title: String,
    preview: String,
    deleted: u64,
    days_left: u64,
}

fn trash_dir() -> Result<PathBuf, String> {
    Ok(notes_dir()?.join(".taskai").join("papelera"))
}
fn load_trash() -> HashMap<String, TrashInfo> {
    trash_dir()
        .ok()
        .and_then(|d| fs::read_to_string(d.join("indice.json")).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}
fn save_trash(t: &HashMap<String, TrashInfo>) -> Result<(), String> {
    let dir = trash_dir()?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let s = serde_json::to_string_pretty(t).map_err(|e| e.to_string())?;
    fs::write(dir.join("indice.json"), s).map_err(|e| e.to_string())
}
fn now_secs() -> u64 {
    std::time::SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// Título que se muestra: el que puso el usuario > el de la IA ("# ...") > la primera línea.
fn display_title(id: &str, content: &str, meta: &HashMap<String, NoteInfo>) -> String {
    meta.get(id)
        .map(|m| m.title.clone())
        .filter(|t| !t.is_empty())
        .or_else(|| {
            structured_path(id)
                .ok()
                .and_then(|p| fs::read_to_string(p).ok())
                .and_then(|s| s.lines().find(|l| l.starts_with("# ")).map(|l| l[2..].trim().to_string()))
                .filter(|t| !t.is_empty())
        })
        .unwrap_or_else(|| title_of(content))
}

/// Borra para siempre los archivos de una nota que está en la papelera (y sus imágenes).
fn purge_files(id: &str) -> Result<(), String> {
    let dir = trash_dir()?;
    let raw = dir.join(format!("{}.md", safe_id(id)?));
    if let (Ok(content), Ok(img)) = (fs::read_to_string(&raw), images_dir()) {
        for name in images_in(&content) {
            let _ = fs::remove_file(img.join(name));
        }
    }
    let _ = fs::remove_file(raw);
    let _ = fs::remove_file(dir.join(format!("{id}.ordenada.md")));
    Ok(())
}

/// Manda la nota a la papelera (se puede restaurar durante 30 días).
#[tauri::command]
fn delete_note(id: String) -> Result<(), String> {
    let (folder, path) = find_note(&id)?;
    let content = fs::read_to_string(&path).unwrap_or_default();
    let mut meta = load_meta();
    let title = display_title(&id, &content, &meta);
    let preview: String = content
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !is_image_line(l))
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(160)
        .collect();
    let dir = trash_dir()?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    fs::rename(&path, dir.join(format!("{id}.md"))).map_err(|e| e.to_string())?;
    let sp = structured_path(&id)?;
    if sp.exists() {
        let _ = fs::rename(&sp, dir.join(format!("{id}.ordenada.md")));
    }
    let info = meta.remove(&id).unwrap_or_default();
    save_meta(&meta)?;
    let mut trash = load_trash();
    trash.insert(id, TrashInfo { folder, deleted: now_secs(), title, preview, info });
    save_trash(&trash)
}

/// Lo que hay en la papelera (y de paso borra lo que ya cumplió 30 días).
#[tauri::command]
fn list_trash() -> Result<Vec<TrashItem>, String> {
    let mut trash = load_trash();
    let now = now_secs();
    let limit = TRASH_DAYS * 86400;
    let expired: Vec<String> = trash.iter().filter(|(_, t)| now.saturating_sub(t.deleted) > limit).map(|(k, _)| k.clone()).collect();
    for id in &expired {
        purge_files(id)?;
        trash.remove(id);
    }
    if !expired.is_empty() {
        save_trash(&trash)?;
    }
    let mut items: Vec<TrashItem> = trash
        .into_iter()
        .map(|(id, t)| TrashItem {
            days_left: TRASH_DAYS.saturating_sub(now.saturating_sub(t.deleted) / 86400),
            id,
            folder: t.folder,
            title: t.title,
            preview: t.preview,
            deleted: t.deleted,
        })
        .collect();
    items.sort_by(|a, b| b.deleted.cmp(&a.deleted));
    Ok(items)
}

/// Saca la nota de la papelera y la regresa a su carpeta (o a Notas rápidas si esa ya no existe).
#[tauri::command]
fn restore_note(id: String) -> Result<String, String> {
    safe_id(&id)?;
    let mut trash = load_trash();
    let t = trash.remove(&id).ok_or("Esa nota ya no está en la papelera")?;
    let folder = if folder_names()?.contains(&t.folder) { t.folder } else { INBOX.to_string() };
    let dir = trash_dir()?;
    let to = notes_dir()?.join(&folder);
    fs::create_dir_all(&to).map_err(|e| e.to_string())?;
    fs::rename(dir.join(format!("{id}.md")), to.join(format!("{id}.md"))).map_err(|e| e.to_string())?;
    let ordered = dir.join(format!("{id}.ordenada.md"));
    if ordered.exists() {
        let _ = fs::rename(ordered, structured_path(&id)?);
    }
    let mut meta = load_meta();
    meta.insert(id, t.info);
    save_meta(&meta)?;
    save_trash(&trash)?;
    Ok(folder)
}

/// Borra para siempre una nota de la papelera.
#[tauri::command]
fn purge_note(id: String) -> Result<(), String> {
    safe_id(&id)?;
    let mut trash = load_trash();
    purge_files(&id)?;
    trash.remove(&id);
    save_trash(&trash)
}

#[tauri::command]
fn empty_trash() -> Result<(), String> {
    let trash = load_trash();
    for id in trash.keys() {
        purge_files(id)?;
    }
    save_trash(&HashMap::new())
}

/// Una nota sin texto ni título no vale la pena guardarla: se borra del todo (sin papelera).
fn is_blank(id: &str, path: &PathBuf, meta: &HashMap<String, NoteInfo>) -> bool {
    let content = fs::read_to_string(path).unwrap_or_default();
    content.trim().is_empty() && meta.get(id).map(|m| m.title.is_empty() && !m.pinned).unwrap_or(true)
}
fn remove_blank(id: &str, path: &PathBuf, meta: &mut HashMap<String, NoteInfo>) {
    let _ = fs::remove_file(path);
    if let Ok(sp) = structured_path(id) {
        let _ = fs::remove_file(sp);
    }
    meta.remove(id);
}

/// Si la nota quedó vacía, la borra. Devuelve true si la borró.
#[tauri::command]
fn discard_if_blank(id: String) -> Result<bool, String> {
    let Ok((_, path)) = find_note(&id) else { return Ok(false) };
    let mut meta = load_meta();
    if !is_blank(&id, &path, &meta) {
        return Ok(false);
    }
    remove_blank(&id, &path, &mut meta);
    save_meta(&meta)?;
    Ok(true)
}

/// Al abrir la app: borra todas las notas vacías que hayan quedado de antes.
#[tauri::command]
fn discard_blank_notes() -> Result<usize, String> {
    let dir = notes_dir()?;
    let mut meta = load_meta();
    let mut n = 0;
    for folder in folder_names()? {
        let Ok(entries) = fs::read_dir(dir.join(&folder)) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("md") {
                continue;
            }
            let id = path.file_stem().unwrap().to_string_lossy().to_string();
            if is_blank(&id, &path, &meta) {
                remove_blank(&id, &path, &mut meta);
                n += 1;
            }
        }
    }
    if n > 0 {
        save_meta(&meta)?;
    }
    Ok(n)
}

/// Mueve una nota. `manual = true` significa que la movió el usuario: la IA ya no la vuelve a mover.
#[tauri::command]
fn move_note(id: String, folder: String, manual: bool) -> Result<(), String> {
    let folder = safe_folder(&folder)?;
    let (_, from) = find_note(&id)?;
    let to_dir = notes_dir()?.join(&folder);
    fs::create_dir_all(&to_dir).map_err(|e| e.to_string())?;
    fs::rename(&from, to_dir.join(format!("{}.md", safe_id(&id)?))).map_err(|e| e.to_string())?;
    if manual {
        let mut meta = load_meta();
        meta.entry(id).or_default().locked = true;
        save_meta(&meta)?;
    }
    Ok(())
}

#[tauri::command]
fn set_pinned(id: String, pinned: bool) -> Result<(), String> {
    safe_id(&id)?;
    let mut meta = load_meta();
    meta.entry(id).or_default().pinned = pinned;
    save_meta(&meta)
}

// ----- Carpetas -----

#[derive(Serialize)]
struct FolderInfo {
    name: String,
    count: usize,
    builtin: bool,
}

#[tauri::command]
fn list_folders() -> Result<Vec<FolderInfo>, String> {
    let dir = notes_dir()?;
    Ok(folder_names()?
        .into_iter()
        .map(|name| {
            let count = fs::read_dir(dir.join(&name))
                .map(|r| r.flatten().filter(|e| e.path().extension().and_then(|x| x.to_str()) == Some("md")).count())
                .unwrap_or(0);
            FolderInfo { builtin: DEFAULT_FOLDERS.contains(&name.as_str()), name, count }
        })
        .collect())
}

#[tauri::command]
fn create_folder(name: String) -> Result<String, String> {
    let name = safe_folder(&name)?;
    let path = notes_dir()?.join(&name);
    if path.exists() {
        return Err("Ya existe una carpeta con ese nombre".into());
    }
    fs::create_dir(&path).map_err(|e| e.to_string())?;
    Ok(name)
}

/// Solo borra carpetas propias y vacías: nunca se pierde una nota por accidente.
#[tauri::command]
fn delete_folder(name: String) -> Result<(), String> {
    let name = safe_folder(&name)?;
    if DEFAULT_FOLDERS.contains(&name.as_str()) {
        return Err("Las carpetas de fábrica no se pueden borrar".into());
    }
    fs::remove_dir(notes_dir()?.join(&name)).map_err(|_| "La carpeta debe estar vacía para borrarla".to_string())
}

#[tauri::command]
fn notes_folder() -> Result<String, String> {
    Ok(notes_dir()?.to_string_lossy().to_string())
}

// ---------- Sistema ----------

#[derive(Serialize)]
struct SystemInfo {
    /// "windows" | "macos" | "linux" | otro
    os: String,
    /// En Linux: ID de /etc/os-release (arch, ubuntu, fedora…) y sus "parientes" (ID_LIKE)
    distro: Option<String>,
    distro_like: Option<String>,
    distro_name: Option<String>,
}

#[tauri::command]
fn system_info() -> SystemInfo {
    let mut info = SystemInfo {
        os: std::env::consts::OS.to_string(),
        distro: None,
        distro_like: None,
        distro_name: None,
    };
    if info.os == "linux" {
        if let Ok(txt) = fs::read_to_string("/etc/os-release") {
            for line in txt.lines() {
                let (k, v) = match line.split_once('=') {
                    Some(kv) => kv,
                    None => continue,
                };
                let v = v.trim_matches('"').to_string();
                match k {
                    "ID" => info.distro = Some(v),
                    "ID_LIKE" => info.distro_like = Some(v),
                    "PRETTY_NAME" => info.distro_name = Some(v),
                    _ => {}
                }
            }
        }
    }
    info
}

// ---------- IA (Ollama local, gratis) ----------

#[derive(Deserialize)]
struct OllamaTags {
    models: Vec<OllamaModel>,
}
#[derive(Deserialize)]
struct OllamaModel {
    name: String,
}

/// Devuelve los modelos instalados, o error si Ollama no está corriendo.
#[tauri::command]
async fn ai_models() -> Result<Vec<String>, String> {
    let res = reqwest::get(format!("{OLLAMA_URL}/api/tags"))
        .await
        .map_err(|_| "OLLAMA_OFF".to_string())?;
    let tags: OllamaTags = res.json().await.map_err(|e| e.to_string())?;
    Ok(tags.models.into_iter().map(|m| m.name).collect())
}

#[derive(Serialize, Clone)]
struct PullProgress {
    model: String,
    status: String,
    percent: Option<f64>,
}

/// Descarga un modelo desde la app, avisando el progreso con el evento "pull-progress".
#[tauri::command]
async fn ai_pull(app: tauri::AppHandle, model: String) -> Result<(), String> {
    use tauri::Emitter;
    let client = reqwest::Client::new();
    let mut res = client
        .post(format!("{OLLAMA_URL}/api/pull"))
        .json(&serde_json::json!({ "model": model, "stream": true }))
        .send()
        .await
        .map_err(|_| "OLLAMA_OFF".to_string())?;

    let mut buf = String::new();
    while let Some(chunk) = res.chunk().await.map_err(|e| e.to_string())? {
        buf.push_str(&String::from_utf8_lossy(&chunk));
        while let Some(pos) = buf.find('\n') {
            let line: String = buf.drain(..=pos).collect();
            let Ok(v) = serde_json::from_str::<serde_json::Value>(line.trim()) else { continue };
            if let Some(err) = v.get("error").and_then(|e| e.as_str()) {
                return Err(err.to_string());
            }
            let status = v.get("status").and_then(|s| s.as_str()).unwrap_or("").to_string();
            let percent = match (v.get("completed").and_then(|c| c.as_f64()), v.get("total").and_then(|t| t.as_f64())) {
                (Some(c), Some(t)) if t > 0.0 => Some(c / t * 100.0),
                _ => None,
            };
            let _ = app.emit("pull-progress", PullProgress { model: model.clone(), status, percent });
        }
    }
    Ok(())
}

#[derive(Serialize)]
struct OllamaStatus {
    installed: bool,
    running: bool,
}

/// Ruta donde el instalador oficial deja Ollama en Windows.
fn windows_ollama_dir() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA").map(|d| PathBuf::from(d).join("Programs").join("Ollama"))
}

fn ollama_binary_exists() -> bool {
    if cfg!(windows) && windows_ollama_dir().is_some_and(|d| d.join("ollama.exe").exists()) {
        return true;
    }
    let mut cmd = std::process::Command::new("ollama");
    cmd.arg("--version").stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
    hide_window(&mut cmd);
    cmd.status().map(|s| s.success()).unwrap_or(false)
}

/// En Windows, que los procesos no abran una ventana de consola negra.
fn hide_window(_cmd: &mut std::process::Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        _cmd.creation_flags(CREATE_NO_WINDOW);
    }
}

async fn ollama_running() -> bool {
    reqwest::Client::new()
        .get(format!("{OLLAMA_URL}/api/tags"))
        .timeout(std::time::Duration::from_secs(2))
        .send()
        .await
        .is_ok()
}

#[tauri::command]
async fn ollama_status() -> OllamaStatus {
    let running = ollama_running().await;
    OllamaStatus { installed: running || ollama_binary_exists(), running }
}

#[derive(Serialize, Clone)]
struct InstallProgress {
    /// "download" | "install" | "start" | "ready"
    stage: String,
    percent: Option<f64>,
}

/// Windows: descarga el instalador oficial de Ollama, lo instala en silencio y lo enciende.
/// En macOS y Linux no se puede sin permisos de administrador: la interfaz muestra los pasos.
#[tauri::command]
async fn install_ollama(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Emitter;
    if !cfg!(windows) {
        return Err("UNSUPPORTED".into());
    }
    let emit = |stage: &str, percent: Option<f64>| {
        let _ = app.emit("ollama-install", InstallProgress { stage: stage.into(), percent });
    };

    // 1) Descargar (desde el sitio oficial, por HTTPS)
    let setup = std::env::temp_dir().join("OllamaSetup.exe");
    let mut res = reqwest::get("https://ollama.com/download/OllamaSetup.exe")
        .await
        .map_err(|e| format!("No pude descargar Ollama: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("La descarga de Ollama falló ({})", res.status()));
    }
    let total = res.content_length().map(|t| t as f64);
    let mut file = fs::File::create(&setup).map_err(|e| e.to_string())?;
    let mut done = 0f64;
    let mut last = -1i64;
    while let Some(chunk) = res.chunk().await.map_err(|e| e.to_string())? {
        use std::io::Write;
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        done += chunk.len() as f64;
        let pct = total.map(|t| done / t * 100.0);
        let whole = pct.map(|p| p as i64).unwrap_or(-1);
        if whole != last {
            last = whole;
            emit("download", pct);
        }
    }
    drop(file);

    // 2) Instalar en silencio (el instalador de Ollama es Inno Setup)
    emit("install", None);
    let setup_for_thread = setup.clone();
    let ok = tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = std::process::Command::new(setup_for_thread);
        cmd.args(["/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART"]);
        cmd.status().map(|s| s.success())
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| format!("No pude ejecutar el instalador: {e}"))?;
    let _ = fs::remove_file(&setup);
    if !ok {
        return Err("El instalador de Ollama terminó con error".into());
    }

    // 3) El instalador de Ollama abre su app de escritorio al terminar (pide iniciar sesión, ofrece
    //    una terminal…) y eso confunde. La cerramos y TaskAI enciende solo el servidor, invisible.
    emit("start", None);
    for _ in 0..30 {
        if ollama_gui_running() {
            tokio::time::sleep(std::time::Duration::from_millis(800)).await; // que termine de abrir
            let _ = kill_ollama();
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }
    // Tampoco queremos que esa ventana salga cada vez que se prende la compu: TaskAI enciende la IA al abrirse.
    remove_ollama_autostart();
    if !ollama_running().await {
        spawn_ollama()?;
    }
    for _ in 0..60 {
        if ollama_running().await {
            emit("ready", Some(100.0));
            return Ok(());
        }
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
    }
    Err("Ollama se instaló, pero no respondió. Ábrelo desde el menú Inicio y dale \"Revisar\".".into())
}

/// ¿Está abierta la app de escritorio de Ollama ("ollama app.exe")? Solo aplica a Windows.
fn ollama_gui_running() -> bool {
    if !cfg!(windows) {
        return false;
    }
    let mut c = std::process::Command::new("tasklist");
    c.args(["/FI", "IMAGENAME eq ollama app.exe", "/NH"]);
    hide_window(&mut c);
    c.output()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_lowercase().contains("ollama app.exe"))
        .unwrap_or(false)
}

/// Quita el acceso directo que el instalador de Ollama pone en "Inicio" de Windows
/// (si no, su ventana se abre sola cada vez que se prende la compu).
fn remove_ollama_autostart() {
    if let Some(dir) = dirs::config_dir() {
        let link = dir.join("Microsoft").join("Windows").join("Start Menu").join("Programs").join("Startup").join("Ollama.lnk");
        let _ = fs::remove_file(link);
    }
}

// ----- Encender y apagar la IA desde TaskAI -----

/// Arranca Ollama sin ventanas de consola (no espera a que responda).
fn spawn_ollama() -> Result<(), String> {
    use std::process::{Command, Stdio};
    let mut cmd = if cfg!(windows) {
        // Solo el servidor, invisible. (La "ollama app.exe" de la bandeja abre su propia ventana.)
        let dir = windows_ollama_dir().ok_or("No encontré dónde está instalado Ollama")?;
        let mut c = Command::new(dir.join("ollama.exe"));
        c.arg("serve");
        c
    } else if cfg!(target_os = "macos") {
        let mut c = Command::new("open");
        c.args(["-a", "Ollama"]);
        c
    } else {
        let mut c = Command::new("ollama");
        c.arg("serve");
        c
    };
    cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    hide_window(&mut cmd);
    cmd.spawn().map(|_| ()).map_err(|e| format!("No pude encender Ollama: {e}"))
}

/// Descarga de la memoria (VRAM/RAM) los modelos que tenga cargados Ollama.
async fn unload_models() {
    #[derive(Deserialize)]
    struct Ps {
        #[serde(default)]
        models: Vec<OllamaModel>,
    }
    let client = reqwest::Client::new();
    let Ok(res) = client.get(format!("{OLLAMA_URL}/api/ps")).timeout(std::time::Duration::from_secs(2)).send().await else {
        return;
    };
    let Ok(ps) = res.json::<Ps>().await else { return };
    for m in ps.models {
        let _ = client
            .post(format!("{OLLAMA_URL}/api/generate"))
            .json(&serde_json::json!({ "model": m.name, "keep_alive": 0 }))
            .timeout(std::time::Duration::from_secs(10))
            .send()
            .await;
    }
}

/// Cierra los procesos de Ollama. En Linux, si corre como servicio de systemd, no se puede sin sudo.
fn kill_ollama() -> Result<(), String> {
    use std::process::{Command, Stdio};
    let run = |prog: &str, args: &[&str]| {
        let mut c = Command::new(prog);
        c.args(args).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
        hide_window(&mut c);
        c.status().map(|s| s.success()).unwrap_or(false)
    };
    if cfg!(windows) {
        run("taskkill", &["/F", "/IM", "ollama app.exe"]);
        run("taskkill", &["/F", "/IM", "ollama.exe"]);
    } else if cfg!(target_os = "macos") {
        run("osascript", &["-e", "quit app \"Ollama\""]);
        run("pkill", &["-x", "ollama"]);
    } else {
        if run("systemctl", &["is-active", "--quiet", "ollama"]) {
            return Err("En Linux, Ollama corre como servicio. Apágalo con: sudo systemctl stop ollama".into());
        }
        run("pkill", &["-x", "ollama"]);
    }
    Ok(())
}

/// Enciende Ollama y espera (hasta 30 s) a que responda.
#[tauri::command]
async fn ollama_start() -> Result<(), String> {
    if ollama_running().await {
        return Ok(());
    }
    if !ollama_binary_exists() {
        return Err("NOT_INSTALLED".into());
    }
    spawn_ollama()?;
    for _ in 0..60 {
        if ollama_running().await {
            return Ok(());
        }
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }
    Err("Ollama no respondió. Ábrelo desde el menú Inicio.".into())
}

/// Apaga Ollama: primero libera la memoria del modelo y luego cierra sus procesos.
#[tauri::command]
async fn ollama_stop() -> Result<(), String> {
    unload_models().await;
    kill_ollama()?;
    for _ in 0..20 {
        if !ollama_running().await {
            return Ok(());
        }
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }
    Err("Ollama sigue encendido. Ciérralo desde su ícono junto al reloj.".into())
}

/// Preferencias de encendido: guardadas en config.json porque Rust las necesita al cerrar la app.
#[tauri::command]
fn set_ai_power(start_on_open: bool, stop_on_exit: bool) -> Result<(), String> {
    let mut cfg = load_config();
    cfg.start_ai_on_open = start_on_open;
    cfg.stop_ai_on_exit = stop_on_exit;
    let s = serde_json::to_string_pretty(&cfg).map_err(|e| e.to_string())?;
    fs::write(config_path()?, s).map_err(|e| e.to_string())
}


/// Instrucciones fijas: el mismo formato siempre, para que la misma nota dé el mismo resultado.
const SYSTEM_PROMPT: &str = r###"Eres el motor de TaskAI. Conviertes apuntes rápidos y desordenados en una nota de estudio clara.
Hoy es {HOY}.
Calendario de los próximos días (úsalo para las fechas, no calcules tú): {CALENDARIO}.

Antes de escribir, piensa en silencio (NO lo muestres):
1. ¿Cuál es el tema principal?
2. ¿Qué ideas van juntas y en qué orden se entienden mejor?
3. ¿Qué abreviaturas o faltas hay que corregir?
4. ¿Hay tareas, fechas o exámenes? Convierte fechas relativas (hoy, mañana, el viernes) en fechas concretas usando la fecha de hoy.
5. ¿Qué le faltaría saber a alguien para entender bien estos apuntes?

Responde SIEMPRE con este formato exacto, en este orden. Omite una sección solo si quedaría vacía:

# <Título específico del contenido, máximo 6 palabras>
> <Resumen de una sola frase>

## <Subtema>
- **<Concepto>**: <explicación corta>

## 💡 Para entender mejor
- <1 a 3 aclaraciones breves que agregas tú para entender los conceptos. SOLO en notas de estudio o trabajo; en notas personales omite esta sección>

## 📌 Pendientes
- [ ] <Tarea> — **<fecha concreta>**

Reglas:
- Responde solo con Markdown. Nada de ``` ni texto antes o después.
- Fuera de "💡 Para entender mejor", NO inventes nada que no esté en los apuntes.
- Corrige ortografía y abreviaturas (q → que, pa → para, xq → porque).
- No copies hashtags (#etiqueta) al resultado.
- En "📌 Pendientes" copia cada tarea tal como aparece en los apuntes, agregando la materia. Ejemplo: "examen el viernes" en apuntes de redes → "- [ ] Examen de redes — **<fecha del viernes según el calendario>**". Nunca la cambies por "estudiar" ni inventes tareas nuevas.
- Título específico, nunca genérico ("Diario", "Notas").
- Lo que está entre corchetes [jueves, 19 de noviembre] [1:00 PM] ya está calculado: úsalo tal cual para fechas y horas, sin corchetes. No hagas cuentas tú.
- Pendientes = solo compromisos (juntas, citas, clases, prácticas, exámenes, entregas). Comer, jugar, descansar o los deseos ("ojalá") NO son pendientes.
- Usa el mismo idioma que los apuntes."###;

/// Un ejemplo resuelto: le enseña al modelo exactamente el estilo que queremos.
const EXAMPLE_IN: &str = "bio hoy celula, la mitocondria hace energia (atp) y el nucleo tiene el adn\nribosomas = proteinas\ntarea: dibujar celula pa mañana #bio";
const EXAMPLE_OUT: &str = "# La célula y sus organelos\n> Cada organelo de la célula cumple una función específica.\n\n## Organelos\n- **Mitocondria**: produce la energía de la célula (ATP).\n- **Núcleo**: guarda el ADN.\n- **Ribosomas**: fabrican proteínas.\n\n## 💡 Para entender mejor\n- El **ATP** es como la \"batería\" que usa la célula para todas sus funciones.\n- El **ADN** contiene las instrucciones para fabricar las proteínas que hacen los ribosomas.\n\n## 📌 Pendientes\n- [ ] Dibujar una célula — **{MANANA}**";

/// Segundo ejemplo: nota personal. Enseña que los deseos no son pendientes y que las citas sí.
const EXAMPLE2_IN: &str = "hoy me fue bien, me levante tarde, comi con mi abuela y luego jugue fut con los compas. mañana [{MANANA}] tengo cita con el dentista a las 10am [10:00 AM] y luego voy a ver una peli y jugar play. ojala pueda dormir mas";
const EXAMPLE2_OUT: &str = "# Comida con la abuela y fútbol\n> Un día tranquilo con familia y deporte.\n\n## Hoy\n- Me levanté tarde.\n- **Comí con mi abuela**.\n- Jugué **fútbol** con mis amigos.\n\n## Mañana\n- Cita con el dentista a las 10:00 AM.\n- Después: ver una película y jugar videojuegos.\n- Ojalá pueda dormir más.\n\n## 📌 Pendientes\n- [ ] Cita con el dentista — **{MANANA}, 10:00 AM**";

#[derive(Deserialize)]
struct ChatResponse {
    message: ChatMessage,
}
#[derive(Deserialize)]
struct ChatMessage {
    content: String,
}

/// Un pedazo de la respuesta de Ollama mientras se va escribiendo (streaming).
#[derive(Deserialize)]
struct ChatChunk {
    #[serde(default)]
    message: Option<ChatMessage>,
    #[serde(default)]
    error: Option<String>,
}

#[derive(Serialize, Clone)]
struct AiStream {
    id: String,
    text: String,
}

/// Ordena la nota. Va mandando a la interfaz el texto conforme la IA lo escribe ("ai-stream"),
/// para que se vea en vivo; al final devuelve la respuesta completa.
#[tauri::command]
async fn ai_structure(
    app: tauri::AppHandle,
    id: String,
    text: String,
    model: String,
    today: String,
    tomorrow: String,
    calendar: String,
) -> Result<String, String> {
    use tauri::Emitter;
    let system = SYSTEM_PROMPT.replace("{HOY}", &today).replace("{CALENDARIO}", &calendar);
    let example_out = EXAMPLE_OUT.replace("{MANANA}", &tomorrow);
    let client = reqwest::Client::new();
    let mut res = client
        .post(format!("{OLLAMA_URL}/api/chat"))
        .json(&serde_json::json!({
            "model": model,
            "stream": true,
            "messages": [
                { "role": "system", "content": system },
                { "role": "user", "content": EXAMPLE_IN },
                { "role": "assistant", "content": example_out },
                { "role": "user", "content": EXAMPLE2_IN.replace("{MANANA}", &tomorrow) },
                { "role": "assistant", "content": EXAMPLE2_OUT.replace("{MANANA}", &tomorrow) },
                { "role": "user", "content": text }
            ],
            // temperatura 0 + semilla fija = misma nota, mismo resultado.
            // num_ctx debe ser igual en ai_classify: si cambia, Ollama recarga el modelo.
            "keep_alive": "30m",
            "options": { "temperature": 0, "seed": 42, "top_k": 1, "num_ctx": 8192 }
        }))
        .send()
        .await
        .map_err(|_| "OLLAMA_OFF".to_string())?;
    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        return Err(format!("Ollama respondió {status}: {body}"));
    }
    // Llega una línea JSON por cada pedacito. Se junta en bytes y se corta por "\n"
    // para no partir a la mitad letras como "ñ" o "á".
    let mut buf: Vec<u8> = Vec::new();
    let mut full = String::new();
    while let Some(chunk) = res.chunk().await.map_err(|e| e.to_string())? {
        buf.extend_from_slice(&chunk);
        while let Some(pos) = buf.iter().position(|&b| b == b'\n') {
            let line: Vec<u8> = buf.drain(..=pos).collect();
            let Ok(part) = serde_json::from_slice::<ChatChunk>(&line) else { continue };
            if let Some(e) = part.error {
                return Err(format!("Ollama: {e}"));
            }
            if let Some(m) = part.message {
                full.push_str(&m.content);
                let _ = app.emit("ai-stream", AiStream { id: id.clone(), text: full.clone() });
            }
        }
    }
    let out = full.trim();
    let out = out.strip_prefix("```markdown").or_else(|| out.strip_prefix("```md")).unwrap_or(out);
    Ok(out.trim_matches('`').trim().to_string())
}

/// Las versiones ordenadas de todas las notas (para juntar los pendientes en una sola vista).
#[tauri::command]
fn all_structured() -> Result<HashMap<String, String>, String> {
    let dir = notes_dir()?;
    let mut out = HashMap::new();
    for folder in folder_names()? {
        let Ok(entries) = fs::read_dir(dir.join(&folder)) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("md") {
                continue;
            }
            let id = path.file_stem().unwrap().to_string_lossy().to_string();
            if let Ok(s) = fs::read_to_string(structured_path(&id)?) {
                if s.contains("- [") {
                    out.insert(id, s);
                }
            }
        }
    }
    Ok(out)
}

/// Pistas para que la IA entienda cada carpeta de fábrica.
fn folder_hint(name: &str) -> &'static str {
    match name {
        "Notas rápidas" => "recordatorios sueltos, listas cortas, ideas al vuelo o cosas que no encajan en otra carpeta",
        "Diario" => "vivencias personales: qué hice hoy, cómo me sentí, reflexiones, familia, amigos, relaciones",
        "Escuela" => "lo de la escuela o universidad: clases, materias, prácticas, estudiar, tareas, exámenes, profesores, calificaciones",
        "Trabajo" => "empleo: juntas, clientes, jefes, proyectos laborales, entregas del trabajo, dinero del negocio",
        "Hobbys" => "pasatiempos y cosas que aprendes por gusto: tocar un instrumento, música, videojuegos, deportes, series, películas, cocina y recetas, dibujo, lectura, viajes",
        _ => "",
    }
}

#[derive(Deserialize)]
struct Classified {
    folder: String,
}

/// Decide en qué carpeta va una nota. Solo puede responder con una carpeta que exista.
#[tauri::command]
async fn ai_classify(text: String, model: String) -> Result<String, String> {
    let folders = folder_names()?;
    let list = folders
        .iter()
        .map(|f| match folder_hint(f) {
            "" => format!("- {f}: carpeta creada por el usuario; úsala si el tema coincide con su nombre"),
            h => format!("- {f}: {h}"),
        })
        .collect::<Vec<_>>()
        .join("\n");
    let system = format!(
        "Clasificas apuntes en carpetas. Elige UNA carpeta de esta lista según el tema principal:\n{list}\n\n\
         Si la nota empieza con \"Título:\", ese título lo puso el usuario: es la mejor pista del tema.\n\
         Si la nota mezcla temas, elige la carpeta de la MAYORÍA de las cosas o de la más importante. Usa \"{INBOX}\" solo para recordatorios sueltos que no encajan en ninguna otra.\n\
         Responde solo con JSON: {{\"folder\": \"<nombre exacto>\"}}"
    );
    let client = reqwest::Client::new();
    let res = client
        .post(format!("{OLLAMA_URL}/api/chat"))
        .json(&serde_json::json!({
            "model": model,
            "stream": false,
            "messages": [
                { "role": "system", "content": system },
                { "role": "user", "content": text }
            ],
            "format": {
                "type": "object",
                "properties": { "folder": { "type": "string", "enum": folders } },
                "required": ["folder"]
            },
            // mismo num_ctx que ai_structure para no recargar el modelo entre llamadas
            "keep_alive": "30m",
            "options": { "temperature": 0, "seed": 42, "top_k": 1, "num_ctx": 8192 }
        }))
        .send()
        .await
        .map_err(|_| "OLLAMA_OFF".to_string())?;
    if !res.status().is_success() {
        return Err(format!("Ollama respondió {}", res.status()));
    }
    let body: ChatResponse = res.json().await.map_err(|e| e.to_string())?;
    let c: Classified = serde_json::from_str(body.message.content.trim()).map_err(|e| e.to_string())?;
    if folders.contains(&c.folder) { Ok(c.folder) } else { Ok(INBOX.to_string()) }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Solo una ventana de TaskAI: si ya está abierto, se trae al frente en vez de abrir otro.
        // (Tiene que ir primero. También evita que dos copias se peleen por encender/apagar Ollama.)
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            use tauri::Manager;
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            list_notes,
            read_note,
            save_note,
            save_structured,
            all_structured,
            create_note,
            delete_note,
            list_trash,
            restore_note,
            purge_note,
            empty_trash,
            discard_if_blank,
            discard_blank_notes,
            set_title,
            save_image,
            load_image,
            notes_folder,
            get_config,
            save_config,
            ollama_status,
            install_ollama,
            move_note,
            set_pinned,
            list_folders,
            create_folder,
            delete_folder,
            ai_classify,
            system_info,
            ai_models,
            ai_pull,
            ai_structure,
            ollama_start,
            ollama_stop,
            set_ai_power
        ])
        .build(tauri::generate_context!())
        .expect("error al iniciar TaskAI")
        .run(|_app, event| {
            // Al cerrar TaskAI: apagar Ollama (si el usuario lo dejó activado) para liberar la tarjeta de video
            if let tauri::RunEvent::Exit = event {
                if load_config().stop_ai_on_exit {
                    tauri::async_runtime::block_on(unload_models());
                    let _ = kill_ollama();
                }
            }
        });
}
