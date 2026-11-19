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

#[derive(Serialize, Deserialize, Default, Clone)]
struct AppConfig {
    #[serde(default)]
    name: String,
    /// Carpeta de notas elegida por el usuario. None = la de por defecto.
    #[serde(default)]
    notes_dir: Option<String>,
    #[serde(default)]
    onboarded: bool,
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
}

#[tauri::command]
fn get_config() -> Result<ConfigView, String> {
    let c = load_config();
    Ok(ConfigView {
        name: c.name,
        notes_dir: base_dir()?.to_string_lossy().to_string(),
        default_dir: default_dir()?.to_string_lossy().to_string(),
        onboarded: c.onboarded,
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
    let cfg = AppConfig { name: name.trim().chars().take(40).collect(), notes_dir: chosen, onboarded };
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
                .take(90)
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

#[tauri::command]
fn delete_note(id: String) -> Result<(), String> {
    let _ = fs::remove_file(structured_path(&id)?);
    let mut meta = load_meta();
    if meta.remove(&id).is_some() {
        save_meta(&meta)?;
    }
    let (_, path) = find_note(&id)?;
    // También sus imágenes pegadas
    if let (Ok(content), Ok(dir)) = (fs::read_to_string(&path), images_dir()) {
        for name in images_in(&content) {
            let _ = fs::remove_file(dir.join(name));
        }
    }
    fs::remove_file(path).map_err(|e| e.to_string())
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

    // 3) Encenderlo y esperar a que responda
    emit("start", None);
    if !ollama_running().await {
        let dir = windows_ollama_dir().ok_or("No encontré dónde se instaló Ollama")?;
        let app_exe = dir.join("ollama app.exe");
        let mut cmd = if app_exe.exists() {
            std::process::Command::new(app_exe)
        } else {
            let mut c = std::process::Command::new(dir.join("ollama.exe"));
            c.arg("serve");
            c
        };
        hide_window(&mut cmd);
        cmd.spawn().map_err(|e| format!("No pude encender Ollama: {e}"))?;
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

#[tauri::command]
async fn ai_structure(text: String, model: String, today: String, tomorrow: String, calendar: String) -> Result<String, String> {
    let system = SYSTEM_PROMPT.replace("{HOY}", &today).replace("{CALENDARIO}", &calendar);
    let example_out = EXAMPLE_OUT.replace("{MANANA}", &tomorrow);
    let client = reqwest::Client::new();
    let res = client
        .post(format!("{OLLAMA_URL}/api/chat"))
        .json(&serde_json::json!({
            "model": model,
            "stream": false,
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
    let body: ChatResponse = res.json().await.map_err(|e| e.to_string())?;
    let out = body.message.content.trim();
    let out = out.strip_prefix("```markdown").or_else(|| out.strip_prefix("```md")).unwrap_or(out);
    Ok(out.trim_matches('`').trim().to_string())
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
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            list_notes,
            read_note,
            save_note,
            save_structured,
            create_note,
            delete_note,
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
            ai_structure
        ])
        .run(tauri::generate_context!())
        .expect("error al iniciar TaskAI");
}
