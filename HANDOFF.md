# HANDOFF — continuar TaskAI

> Para la próxima sesión de Claude Code: lee esto completo y luego [`CLAUDE.md`](CLAUDE.md).
> Última actualización: **19 de noviembre de 2026**, desde la PC de escritorio de Evan (**Windows 11, RTX 3060 12 GB, 16 GB RAM**).
> Versión publicada: **v1.4.0** (se actualiza sola desde la 1.3.0+) · repo **público** · descarga: <https://github.com/EvanDavidMS/taskai/releases/latest>

## 1. Dónde vamos

TaskAI está publicado y un amigo de Evan ya lo instaló desde GitHub. Lo que hay hoy:

**Escribir y ordenar**
- Editor con **números de línea** (resalta la línea actual), sin recuadro de foco, tipografía **Inter** incluida en la app.
- **Título opcional** por nota (se guarda en `meta.json`): manda en la lista y se le pasa a `ai_classify` como pista ("Título: …").
- La IA ordena 3 s después de dejar de escribir y **se ve escribiendo en vivo** (streaming: `ai_structure` emite `ai-stream`).
- **Pegar imágenes** con `Ctrl + V` → `.taskai/img/<ms>.png`; en el texto queda `![imagen](img/<ms>.png)`. No se mandan a la IA; se ven como miniaturas.
- **Modo lectura** (`Ctrl + E`): solo la versión ordenada, centrada.
- Pendientes en la versión ordenada como **tarjeta de renglones**: todo el renglón palomea; la fecha va en una pastilla (roja si ya pasó, de color si es hoy).

**Organizar**
- **Menú lateral**: logo, botón "Nueva nota", Todas las notas, **Pendientes**, carpetas (ícono de línea + color propio), #etiquetas, **Papelera**, y abajo IA (⏻), tema y Configuración.
- **Tablero de tarjetas** al inicio (búsqueda, orden Recientes/A–Z); la nota abre a pantalla completa con "← Notas".
- **Vista Pendientes**: junta las palomitas `- [ ] texto — **viernes, 20 de noviembre, 2:00 AM**` de todas las notas, agrupadas en Atrasados / Hoy / Mañana / Esta semana / Más adelante / Sin fecha (`src/tasks.ts`).
- **Papelera** de 30 días (`.taskai/papelera/`), con Restaurar, Borrar para siempre y Vaciar. Borrar pide confirmación y deja "Deshacer".
- Las notas **vacías** (sin texto ni título) se descartan solas al salir de ellas y al abrir la app. "Nueva nota" no crea notas en blanco de más.
- La IA acomoda cada nota en su carpeta (con "Deshacer"); si el usuario la mueve, ya no la toca.

**Recordatorios e IA**
- **Recordatorios** del sistema (plugin notification): N min antes de cada pendiente con hora y un resumen diario desde las 8:00 AM. Solo con la app abierta.
- **Encender/apagar Ollama** desde TaskAI (⏻ en el menú). Por defecto se **enciende al abrir** y se **apaga al cerrar** (libera ~5 GB de VRAM). Se enciende con `ollama.exe serve` invisible (la `ollama app.exe` abre su propia ventana).
- `keep_alive: 30m` y el **mismo `num_ctx` (8192)** en ordenar y clasificar: si cambia, Ollama recarga el modelo.
- **Borrar modelos** desde Configuración → IA (muestra cuánto ocupa cada uno).

**Configuración** (página propia, ya no ventana flotante)
- General (nombre, carpeta de notas), Apariencia (tema + **11 colores principales**), Inteligencia artificial (encendido, modelos, instalar Ollama), Recordatorios, Atajos de teclado.

**App e instalador**
- **Logo** de Evan (píldora con estrella de 4 puntas) redibujado en SVG (`Logo` en `src/icons.tsx`), se invierte en modo oscuro. **Ícono** de la app: cuadrado blanco redondeado con estrella negra (`src-tauri/app-icon-square.png`; el original es `app-icon.png`).
- **Una sola ventana** (plugin single-instance): si ya está abierta, se trae al frente.
- Instalador NSIS en español, por usuario (sin admin). **Desinstalador** (`src-tauri/windows/hooks.nsh`): al desinstalar de verdad (no al actualizar) pregunta si quitar Ollama + modelos y si borrar las notas (ambas en «No» por defecto).
- El asistente de bienvenida instala Ollama solo en Windows; al terminar **cierra la ventana de Ollama** que abre su instalador y **quita su arranque con Windows** (`Startup\Ollama.lnk`).

**Atajos:** `Ctrl+N` nueva · `Ctrl+K` buscar · `Ctrl+Enter` ordenar · `Ctrl+E` lectura · `Esc` volver · `Ctrl+,` configuración · `Supr` papelera.

## 2. Estado de esta compu (Windows)

Ya está todo instalado: Git, GitHub CLI, Node 22, pnpm 9, Rust 1.98, **Build Tools de Visual Studio 2022** (C++), **Ollama 0.40** y el modelo `qwen2.5:7b`.

```powershell
cd C:\Users\PC\Proyectos\taskai
pnpm install
pnpm tauri dev      # modo desarrollo (Vite recarga solo; si cambias Rust, recompila y reinicia la app)
```

Ojo: en esta compu la **app de bandeja de Ollama arranca con Windows** (`Startup\Ollama.lnk`, la puso su instalador antes de TaskAI). Evan puede quitarla desde Administrador de tareas → Aplicaciones de arranque.

### Publicar una versión nueva (con actualización automática)

Desde la v1.3.0 las apps instaladas se actualizan solas: al abrir, consultan
`https://github.com/EvanDavidMS/taskai/releases/latest/download/latest.json` y solo aceptan instaladores **firmados**.

```powershell
# 1) Escribir las notas en español: "## ⬇ Cómo instalar" + "## ✨ Novedades de la X" (el aviso de la app muestra los puntos de Novedades)
# 2) Publicar (sube la versión en los 3 archivos, compila firmado, crea latest.json, commit, push y Release):
.\scripts\publicar.ps1 -Version 1.4.0 -Notas scripts\notas-1.4.0.md
#    -SinPublicar → solo compila y genera latest.json
```

- **Llave privada:** `C:\Users\PC\.tauri\taskai.key` (sin contraseña). **Nunca** va al repo. Si se pierde, las apps instaladas ya no aceptan actualizaciones → Evan debe respaldarla. La pública está en `tauri.conf.json` → `plugins.updater.pubkey`.
- **Probado de punta a punta (19 nov):** una 1.2.9 de prueba (con `--config` apuntando a un `latest.json` servido en `http://127.0.0.1:8765` y `dangerousInsecureTransportProtocol`) detectó la 1.3.0, la descargó, se instaló sola (modo pasivo, sin las preguntas del desinstalador) y se reabrió.
- Quien tenga ≤ 1.2.2 tiene que instalar la 1.3.0 a mano una vez.

**Para ver el asistente de bienvenida otra vez:** borrar `%APPDATA%\TaskAI\config.json` (las notas no se tocan).

### Linux (Arch/EndeavourOS, la laptop)

```fish
mise use -g rust@latest node@lts pnpm@latest
sudo pacman -S --needed webkit2gtk-4.1 base-devel curl wget file openssl librsvg
sudo pacman -S ollama ollama-vulkan; sudo systemctl enable --now ollama; ollama pull qwen2.5:7b
gh repo clone EvanDavidMS/taskai ~/proyectos/taskai; cd ~/proyectos/taskai
pnpm install; mise exec -- pnpm tauri dev
```

En Linux, si Ollama corre como servicio de systemd, TaskAI **no puede apagarlo** sin sudo (`ollama_stop` lo avisa). Instalar en el menú: `pnpm tauri build --no-bundle` y copiar el binario a `~/.local/bin/taskai` con un `.desktop`.

### Las notas NO están en el repo

Viven en `Documentos\TaskAI` (o la carpeta elegida). Para llevarlas a otra compu: copiar la carpeta completa, incluida la oculta `.taskai/`.

## 3. Qué está probado y qué no

**Probado en esta compu**
- [x] Compila (TypeScript y Rust), instalador NSIS se genera e instala (menú Inicio + "Aplicaciones", sin admin).
- [x] Ordenar en vivo, título opcional → carpeta correcta ("Programacion" → Trabajo), pegar imágenes (Evan).
- [x] Lectura de fechas de pendientes con notas reales (incluye cambio de año y 12:00 AM).
- [x] Encender/apagar Ollama con ⏻, apagar al cerrar TaskAI, encender al abrir sin ventanas (Evan).
- [x] Una sola instancia (2 lanzamientos → 1 proceso).
- [x] Release público descargable sin sesión.
- [x] El asistente instaló Ollama y el modelo en la compu de un amigo (v1.2.0), pero se le abrió la ventana de Ollama → corregido en v1.2.2.

**Falta confirmar**
- [ ] v1.2.2: que el asistente **cierre** la ventana de Ollama tras instalarlo (pedirle al amigo que pruebe desde cero).
- [ ] Desinstalador: las preguntas de Ollama/notas (nadie lo ha corrido; en la compu de Evan borraría su Ollama).
- [ ] Botón de borrar modelos (Evan solo tiene `qwen2.5:7b`).
- [ ] Que los avisos digan "TaskAI" y no "Windows PowerShell" en la versión **instalada** (en modo dev siempre dicen PowerShell).
- [ ] Recordatorios reales a la hora de un pendiente.

## 4. Decisiones tomadas (no re-discutir sin motivo)

| Decisión | Por qué |
|---|---|
| **Solo Ollama** (IA local) para el público | Gratis, privado; no cuesta nada a Evan. |
| **No** conectar la cuenta de Claude Pro o ChatGPT Plus | Va contra la política de Anthropic y OpenAI para apps de terceros. Evan aceptó: "vamos a hacerlo con ollama para el público". |
| A futuro, opcional: BYOK (API key propia) | Solo si el proyecto crece. |
| Fechas y horas calculadas en código; ejemplos few-shot en vez de muchas reglas | El 7B fallaba haciendo cuentas e ignoraba reglas largas. |
| Ollama se instala desde el **asistente**, no dentro del `.exe` | El asistente muestra progreso de los GB del modelo y el `.exe` queda de 2.9 MB. |
| TaskAI controla Ollama (`ollama serve` invisible) en vez de su app de bandeja | La app de bandeja abre una ventana (login, terminal) que confundía a la gente. |
| Borrar = papelera 30 días; notas vacías se descartan sin papelera | Evita perder cosas y evita basura de "Nota sin título". |
| Desinstalador pregunta por Ollama y notas con «No» por defecto | Alguien puede usar Ollama con otros programas; las notas son del usuario. |
| No probar `qwen2.5:14b` | Evan lo descartó. |
| Licencia MIT; repo **público** desde el 19 nov 2026 | Para que otros lo descarguen desde Releases. |

## 5. Configuración del usuario

`%APPDATA%\TaskAI\config.json` (Linux: `~/.config/TaskAI/config.json`):

```json
{ "name": "Evan", "notes_dir": null, "onboarded": true, "start_ai_on_open": true, "stop_ai_on_exit": true }
```

- `notes_dir: null` → `Documentos\TaskAI`.
- En `localStorage`: `taskai.theme`, `taskai.accent`, `taskai.model`, `taskai.focus`, `taskai.read`, `taskai.remind` (`{on, lead}`), `taskai.notified`, `taskai.settingsTab`.

## 6. Gustos de Evan (UI)

- Le gustó la dirección de las referencias tipo dashboard (tarjetas redondeadas, sombras suaves, etiquetas pastel, íconos de línea, botones píldora). Antes: oscuro tipo Super Notes, fondo casi negro.
- Usa el color **morado** y modo oscuro casi siempre.
- Le molesta: demasiadas columnas, barras saturadas, letra de código para escribir, texto cortado, ventanas que confunden (como la de Ollama), notas basura.
- Revisa todo con capturas: después de un cambio de UI, verificar en claro y oscuro, ancho completo y angosto (~700 px).

## 7. Cómo probar

- **Prompts sin la app:** script de Python que lee `SYSTEM_PROMPT`, `EXAMPLE_IN/OUT`, `EXAMPLE2_IN/OUT` de `lib.rs` y llama a `/api/chat` con `temperature 0, seed 42, top_k 1, num_ctx 8192`. Correr 2 veces para ver que el resultado es idéntico.
- **Funciones TS sin navegador:** `node --experimental-strip-types --no-warnings archivo.mts` (en Windows, importar con `file:///C:/...`).
- **UI con datos falsos:** crear temporalmente `__preview.html` + `src/__preview.tsx` con `mockIPC` (`@tauri-apps/api/mocks`; responder `get_config`, `list_notes`, `list_folders`, `all_structured`, `ai_models`, `list_trash`, `system_info`), `npx vite --port 1432` y capturar con Edge headless:
  ```powershell
  & "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --headless=new --hide-scrollbars --window-size=1300,860 --virtual-time-budget=5000 --screenshot=salida.png "http://localhost:1432/__preview.html?theme=dark"
  ```
  Para llegar a una sección, el preview puede picar un botón por su texto (`?click=Configuración`). **Borrar los archivos de preview al terminar.**
- **App real sin robar el foco:** capturar la ventana de TaskAI con `PrintWindow` (user32) desde PowerShell, no con `CopyFromScreen` (captura lo que esté encima).
- **Cuidado al probar procesos:** no cerrar a la fuerza "todos los taskai"; puede estar abierta la versión instalada de Evan.

## 8. Siguientes pasos sugeridos

Primero, lo de la sección 3 ("Falta confirmar"). Después, en orden de impacto:

**Ahora que hay gente usándolo**
1. ~~Actualizaciones automáticas~~ ✅ v1.3.0
2. Minimizar a la bandeja + iniciar con Windows → **Evan no lo quiere**.
3. Actions automático al publicar → **Evan no lo quiere** (se publica con `scripts\publicar.ps1`).

**Hecho en v1.4.0 (19 nov)**
4. ~~Buscar en todo el texto~~ ✅ (`search_notes` en Rust, sin acentos, fragmento resaltado).
5. ~~Exportar~~ ✅ PDF (`window.print` + `@media print`, `@page { margin: 0 }` para que no salgan fecha/título/localhost del navegador; margen interno con `box-decoration-break: clone`), `.md` (`export_file` + diálogo guardar), copiar texto/Markdown (`src/exporter.ts`).
6. ~~Pendientes~~ ✅ agregar a mano (`add_task` → nota fijada "Pendientes sueltos"), cambiar/quitar fecha desde la pastilla (fija la nota), vista **Semana** (7 / 4 / 1 columnas según ancho).
7. ~~Favoritas y arrastrar~~ ✅ `favorite` en meta.json + `set_favorite`; arrastrar tarjeta a carpeta del menú (`dragDropEnabled: false` en tauri.conf, si no, el webview bloquea el drag HTML5). **Falta que Evan pruebe el arrastre en la app real.**
8. ~~Capturas y GIF~~ ✅ `docs/capturas/` (notas de ejemplo de "Ana", nunca las de Evan). Se generaron con `__preview` + Edge headless (`--force-device-scale-factor=1.5`) y el GIF con ffmpeg (concat + palettegen).

**Pendiente (siguiente sesión)**
9. Instaladores de **Linux** (`.deb`/AppImage, compilar en la laptop EndeavourOS) y **macOS** (solo en una Mac o con Actions; Evan no quiere Actions → preguntarle).
10. Plantilla propia para **Diario** (ej. "Cómo me sentí", "Lo mejor del día").
11. **Microanimaciones suaves** en toda la interfaz (transiciones al abrir nota, palomear, cambiar de sección, tarjetas).
12. **Sonidos**: Evan ya tiene los archivos de audio, solo hay que meterlos (p. ej. al palomear un pendiente, al terminar de ordenar, recordatorio). Pedirle los archivos y dónde los quiere; agregar opción para silenciarlos en Configuración.

## 9. Límites conocidos

- El 7B a veces malinterpreta palabras muy mal escritas (leyó "covivi" como "comí").
- Los recordatorios solo funcionan con TaskAI abierto.
- El instalador no tiene firma digital → Windows muestra "Windows protegió su PC" (es de paga).
- El workflow de Actions (`instalador-windows.yml`) sigue siendo manual y solo Windows.
