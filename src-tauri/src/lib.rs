//! TaskAI — backend en Rust.
//! Las notas se guardan como archivos .md normales en ~/Documentos/TaskAI (o ~/Documents/TaskAI).
//! La versión ordenada por la IA se guarda aparte en .taskai/, así nunca tocamos lo que escribió el usuario.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::time::UNIX_EPOCH;

const OLLAMA_URL: &str = "http://localhost:11434";

fn notes_dir() -> Result<PathBuf, String> {
    let base = dirs::document_dir()
        .or_else(dirs::home_dir)
        .ok_or("No encontré la carpeta de documentos")?;
    let dir = base.join("TaskAI");
    fs::create_dir_all(dir.join(".taskai")).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Evita que un id malicioso escape de la carpeta (../../etc/passwd).
fn safe_id(id: &str) -> Result<&str, String> {
    if id.is_empty() || id.contains(['/', '\\']) || id.contains("..") || id.starts_with('.') {
        return Err("Nombre de nota inválido".into());
    }
    Ok(id)
}

fn note_path(id: &str) -> Result<PathBuf, String> {
    Ok(notes_dir()?.join(format!("{}.md", safe_id(id)?)))
}

fn structured_path(id: &str) -> Result<PathBuf, String> {
    Ok(notes_dir()?.join(".taskai").join(format!("{}.md", safe_id(id)?)))
}

#[derive(Serialize)]
struct NoteMeta {
    id: String,
    title: String,
    preview: String,
    modified: u64,
    tags: Vec<String>,
}

#[derive(Serialize)]
struct Note {
    content: String,
    structured: String,
}

fn title_of(content: &str) -> String {
    content
        .lines()
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
    let mut notes = Vec::new();
    for entry in fs::read_dir(notes_dir()?).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
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
        let title = title_of(&content);
        let preview: String = content
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty())
            .skip(1)
            .collect::<Vec<_>>()
            .join(" ")
            .chars()
            .take(90)
            .collect();
        notes.push(NoteMeta { id, title, preview, modified, tags: tags_of(&content) });
    }
    notes.sort_by(|a, b| b.modified.cmp(&a.modified));
    Ok(notes)
}

#[tauri::command]
fn read_note(id: String) -> Result<Note, String> {
    Ok(Note {
        content: fs::read_to_string(note_path(&id)?).unwrap_or_default(),
        structured: fs::read_to_string(structured_path(&id)?).unwrap_or_default(),
    })
}

#[tauri::command]
fn save_note(id: String, content: String) -> Result<(), String> {
    fs::write(note_path(&id)?, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_structured(id: String, content: String) -> Result<(), String> {
    fs::write(structured_path(&id)?, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn create_note() -> Result<String, String> {
    let secs = std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    let id = format!("nota-{secs}");
    fs::write(note_path(&id)?, "").map_err(|e| e.to_string())?;
    Ok(id)
}

#[tauri::command]
fn delete_note(id: String) -> Result<(), String> {
    let _ = fs::remove_file(structured_path(&id)?);
    fs::remove_file(note_path(&id)?).map_err(|e| e.to_string())
}

#[tauri::command]
fn notes_folder() -> Result<String, String> {
    Ok(notes_dir()?.to_string_lossy().to_string())
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
#[derive(Deserialize)]
struct OllamaResponse {
    response: String,
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

const PROMPT: &str = r###"Eres el asistente de TaskAI. Recibes apuntes escritos rápido, desordenados y con faltas.
Tu trabajo: devolver una versión ORDENADA en Markdown.

Reglas:
- Responde SOLO con el Markdown, sin explicaciones ni ```.
- Empieza con un título "# ..." que resuma el tema.
- Agrupa ideas en secciones "## ..." con viñetas cortas.
- Pon en **negritas** los conceptos clave.
- Corrige ortografía, pero NO inventes información que no esté en los apuntes.
- Si hay tareas, fechas, exámenes o pendientes, ponlos al final en "## 📌 Pendientes" como lista "- [ ] ...".
- Escribe en el mismo idioma que los apuntes.

Apuntes:
"###;

#[tauri::command]
async fn ai_structure(text: String, model: String) -> Result<String, String> {
    let client = reqwest::Client::new();
    let res = client
        .post(format!("{OLLAMA_URL}/api/generate"))
        .json(&serde_json::json!({
            "model": model,
            "prompt": format!("{PROMPT}{text}"),
            "stream": false,
            "options": { "temperature": 0.2 }
        }))
        .send()
        .await
        .map_err(|_| "OLLAMA_OFF".to_string())?;
    if !res.status().is_success() {
        return Err(format!("Ollama respondió {}", res.status()));
    }
    let body: OllamaResponse = res.json().await.map_err(|e| e.to_string())?;
    Ok(body.response.trim().trim_start_matches("```markdown").trim_matches('`').trim().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            list_notes,
            read_note,
            save_note,
            save_structured,
            create_note,
            delete_note,
            notes_folder,
            ai_models,
            ai_structure
        ])
        .run(tauri::generate_context!())
        .expect("error al iniciar TaskAI");
}
