# HANDOFF — continuar TaskAI en otra computadora

> Para la próxima sesión de Claude Code: lee esto completo y luego [`CLAUDE.md`](CLAUDE.md).
> Última actualización: 18 de noviembre de 2026, desde la laptop de Evan (EndeavourOS/Arch, RTX 5060).
> **La compu nueva es Windows** (RTX 3060 Ti 8 GB, 16 GB RAM).

## 1. Dónde vamos

TaskAI ya funciona de punta a punta:

- ✍️ Editor a la izquierda, **versión ordenada por IA** a la derecha, en vivo (3 s después de dejar de escribir).
- 📁 **Carpetas**: Notas rápidas, Diario, Escuela, Trabajo, Hobbys y las que cree el usuario. La IA **acomoda cada nota sola** (con aviso "Deshacer"). Si el usuario la mueve a mano, la IA ya no la toca.
- ☑️ **Pendientes interactivos**: los checkbox se palomean, se guardan y sobreviven cuando la IA reordena.
- 📌 **Fijar**: congela la versión ordenada; luego "✦ Revisar" la actualiza a mano.
- 📅 Fechas y horas correctas: las calcula el código, no el modelo.
- ⚙ **Configuración**: detecta el SO (y la distro en Linux) y muestra solo sus pasos para instalar Ollama; descarga modelos con barra de progreso; tema.
- ☀️/☾ **Modo claro, oscuro y sistema**.
- 👋 **Asistente de bienvenida** (primera vez que se abre): nombre → tema → carpeta de notas → detecta el SO e **instala Ollama solo en Windows** (descarga `OllamaSetup.exe` oficial, `/VERYSILENT`, lo enciende) → elegir y descargar modelo → listo. Si no detecta el SO, pregunta.
- 📦 Instalador `.exe` (NSIS) en español, por usuario (sin pedir admin).
- 🧱 Layout de 3 columnas (biblioteca con carpetas como chips + apuntes + IA); ☰ activa el **modo enfoque** (2 columnas); en ventana angosta, cajón + pestañas.
- Probado: el clasificador acertó 10 de 10 notas de prueba; las fechas y horas pasan sus pruebas.

## 2. Qué instalar en la compu nueva

El hardware sirve de sobra: una **RTX 3060 Ti (8 GB)** carga `qwen2.5:7b` (4.7 GB) completo en la GPU.

### Windows 10/11 (la compu de escritorio de Evan)

1. **Git**: <https://git-scm.com/download/win>
2. **GitHub CLI** (para clonar el repo privado): <https://cli.github.com/>. Luego, en una terminal: `gh auth login`.
3. **Node.js 20+** (LTS): <https://nodejs.org>. Luego: `npm install -g pnpm`.
4. **Herramientas de C++ de Microsoft** (Rust las necesita): instala "Build Tools for Visual Studio" y marca **"Desarrollo para el escritorio con C++"**: <https://visualstudio.microsoft.com/visual-cpp-build-tools/>
5. **Rust**: <https://rustup.rs> (descarga `rustup-init.exe` y acepta las opciones por defecto).
6. **WebView2**: ya viene en Windows 10/11 actualizados.
7. **Ollama**: <https://ollama.com/download/windows>. Usa CUDA con la NVIDIA automáticamente. Luego:
   ```powershell
   ollama pull qwen2.5:7b
   ```
8. Clonar y correr:
   ```powershell
   gh repo clone EvanDavidMS/taskai
   cd taskai
   pnpm install
   pnpm tauri dev
   ```
   - La primera compilación de Rust tarda varios minutos; después es rápida.
   - Las notas se guardan en `Documentos\TaskAI` (`C:\Users\<usuario>\Documents\TaskAI`).
   - Instalador para Windows: `pnpm tauri build` → `src-tauri\target\release\bundle\` (`.msi` y `-setup.exe`).

### Generar el instalador `.exe` en Windows

```powershell
pnpm tauri build
# Resultado:
#   src-tauri\target\release\bundle\nsis\TaskAI_0.1.0_x64-setup.exe   ← instalador en español
#   src-tauri\target\release\bundle\msi\TaskAI_0.1.0_x64_es-ES.msi
```

Al instalarlo y abrirlo, sale el asistente de bienvenida. **Para probar el asistente otra vez**, borra `%APPDATA%\TaskAI\config.json`.

Alternativa sin compilar: GitHub → Actions → **"Instalador de Windows"** → Run workflow → descargar el artefacto. Es manual a propósito: el repo es privado y gasta minutos gratis (Windows cuenta x2).

**Cosas por verificar la primera vez en Windows** (no se pudieron probar desde Linux):
- [ ] Que `install_ollama` descargue, instale en silencio y encienda Ollama (si `/VERYSILENT` no funciona con la versión actual del instalador de Ollama, ajustar los argumentos en `lib.rs`).
- [ ] Que no aparezcan ventanas negras de consola (`hide_window` con `CREATE_NO_WINDOW`).
- [ ] Que el selector de carpeta arme bien la ruta con `\`.
- [ ] Que el instalador NSIS salga en español.

### Linux (Arch/EndeavourOS, como la laptop)

```fish
# Rust con mise (sin sudo)
mise use -g rust@latest

# Dependencias de Tauri
sudo pacman -S --needed webkit2gtk-4.1 base-devel curl wget file openssl librsvg

# Node + pnpm (si no están)
mise use -g node@lts pnpm@latest

# Ollama con Vulkan: ligero (≈120 MB) y usa la NVIDIA sin bajar CUDA (≈6 GB)
sudo pacman -S ollama ollama-vulkan
sudo systemctl enable --now ollama
ollama pull qwen2.5:7b

# Proyecto
gh repo clone EvanDavidMS/taskai ~/proyectos/taskai
cd ~/proyectos/taskai
pnpm install
mise exec -- pnpm tauri dev
```

Para otras distros: requisitos de Tauri en <https://tauri.app/start/prerequisites/> y Ollama con `curl -fsSL https://ollama.com/install.sh | sh`.

**Instalar en el menú de apps (Linux):**

```bash
mise exec -- pnpm tauri build --no-bundle
install -Dm755 src-tauri/target/release/taskai ~/.local/bin/taskai
install -Dm644 src-tauri/icons/128x128.png ~/.local/share/icons/hicolor/128x128/apps/taskai.png
cat > ~/.local/share/applications/taskai.desktop <<EOF
[Desktop Entry]
Type=Application
Name=TaskAI
Comment=Apuntes que la IA ordena en vivo
Exec=$HOME/.local/bin/taskai
Icon=taskai
Terminal=false
Categories=Office;TextEditor;
StartupWMClass=taskai
EOF
```

### Las notas NO están en el repo

Son personales y viven en `Documentos/TaskAI` de cada compu. Si Evan quiere las de la laptop, que copie esa carpeta completa, incluida la oculta `.taskai/`.

## 3. Decisiones tomadas (no re-discutir sin motivo)

| Decisión | Por qué |
|---|---|
| **Solo Ollama** (IA local) para el público | Gratis, privado; no cuesta nada a Evan. |
| **No** conectar la cuenta de Claude Pro o ChatGPT Plus | Va contra la política de Anthropic y OpenAI para apps de terceros; hay riesgo de suspender cuentas. Evan aceptó: "vamos a hacerlo con ollama para el público". |
| A futuro, opcional: BYOK (API key propia) o un plan Pro de suscripción | Solo si el proyecto crece. |
| Debounce de 3 s en vez de "cada 15 s" | Gasta menos y se siente más rápido. |
| Fechas y horas calculadas en código | El 7B fallaba ("viernes 19", "a la 1" → 15:00). |
| Ejemplos few-shot en vez de muchas reglas | Con muchas reglas el 7B las ignoraba. |
| Ollama con Vulkan en Arch | `ollama-cuda` arrastra CUDA (≈6 GB). |
| Licencia MIT; repo **privado** por ahora | Evan lo pidió privado el 18 nov 2026 (antes era público). |

## 4. Configuración del usuario

`config.json` en la carpeta de configuración del SO (Windows: `%APPDATA%\TaskAI\config.json`; Linux: `~/.config/TaskAI/config.json`):

```json
{ "name": "Evan", "notes_dir": null, "onboarded": true }
```

- `notes_dir: null` → usa `Documentos/TaskAI`. Si el usuario eligió otra carpeta, va la ruta completa.
- El tema, el modelo y el modo enfoque viven en `localStorage` (`taskai.theme`, `taskai.model`, `taskai.focus`).

## 5. Gustos de Evan (UI)

- Referencias visuales: estilo oscuro tipo **Super Notes**, fondo casi negro tipo **Luminar** (docs), portada con paisaje o atardecer tipo **Haven**. Acento **naranja** `#ff6a3d` (claro: `#e4572e`).
- Se queja de: demasiadas columnas, barras saturadas, letra de código para escribir, texto cortado o pegado.
- Usa la app con la ventana en **mosaico angosto** (~690 px de ancho, Hyprland) y también a pantalla completa: siempre revisar ambos tamaños.

## 6. Cómo probar

**Prompts (sin abrir la app):** script de Python que extrae las constantes de `lib.rs` y llama a Ollama:

```python
import re, json, urllib.request
s = open("src-tauri/src/lib.rs").read()
sysp = re.search(r'SYSTEM_PROMPT: &str = r###"(.*?)"###;', s, re.S).group(1)
sysp = sysp.replace("{HOY}", "miércoles, 18 de noviembre de 2026").replace("{CALENDARIO}", "mañana es jueves, 19 de noviembre, ...")
g = lambda n: json.loads('"' + re.search(n + r': &str = "(.*?)";', s).group(1) + '"').replace("{MANANA}", "jueves, 19 de noviembre")
msgs = [{"role": "system", "content": sysp},
        {"role": "user", "content": g("EXAMPLE_IN")}, {"role": "assistant", "content": g("EXAMPLE_OUT")},
        {"role": "user", "content": g("EXAMPLE2_IN")}, {"role": "assistant", "content": g("EXAMPLE2_OUT")},
        {"role": "user", "content": "<nota ya anotada con [fecha] y [hora]>"}]
body = json.dumps({"model": "qwen2.5:7b", "stream": False, "messages": msgs,
                   "options": {"temperature": 0, "seed": 42, "top_k": 1, "num_ctx": 8192}}).encode()
print(json.load(urllib.request.urlopen(urllib.request.Request(
    "http://localhost:11434/api/chat", body, {"Content-Type": "application/json"})))["message"]["content"])
```

**Funciones de TS sin navegador:** extrae la función de `App.tsx` a un `.mts` y córrela con `node --experimental-strip-types archivo.mts`.

**UI:** ver "Cómo verificar la UI" en `CLAUDE.md`. Casos que conviene probar: ancho 1440 (claro y oscuro), angosto 700, nota fijada, modo enfoque.

## 7. Siguientes pasos sugeridos

1. **Probar en Windows** la lista de "Cosas por verificar" de la sección 2.
2. Editar nombre y carpeta de notas desde ⚙ Configuración (hoy solo se eligen en el asistente).
3. Agregar Linux (`.deb`/AppImage) al workflow de Actions.
4. **Ícono propio** (hoy es el de la plantilla de Tauri): `pnpm tauri icon ruta/al/icono.png`.
5. **Capturas en el README** (claro y oscuro).
6. **Streaming** de la respuesta: ver cómo se escribe la versión ordenada.
7. Atajos de teclado (nueva nota, buscar, ordenar, enfoque).
8. Formato de "Diario" con secciones propias (ej. "Cómo me sentí").
9. Probar `qwen2.5:14b` en la 3060 Ti: son 9 GB, así que no cabe completo en 8 GB de VRAM y será más lento; quizás valga la pena por calidad.

## 8. Límites conocidos

- El 7B a veces malinterpreta palabras muy mal escritas (leyó "covivi" como "comí").
- Una nota que mezcla temas puede caer en una carpeta discutible; el usuario la mueve y queda fija.
- `confirm()` nativo se usa para borrar notas y carpetas; se podría cambiar por un diálogo propio.
