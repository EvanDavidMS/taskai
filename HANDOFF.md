# HANDOFF — continuar TaskAI

> Para la próxima sesión de Claude Code: lee esto completo y luego [`CLAUDE.md`](CLAUDE.md).
> Última actualización: **19 de noviembre de 2026 (noche)**, desde la **laptop de Evan (EndeavourOS/Arch + Hyprland/Quickshell, pantalla al 133 %)**. Antes se trabajaba en la PC de escritorio (**Windows 11, RTX 3060 12 GB, 16 GB RAM**).
> Versión publicada: **v1.5.0** · ⏳ **v1.5.1 compilada pero SIN publicar** (run de Actions `44664895947`, commit `e7d7dae`): falta firmar y crear el Release desde la laptop (`~/.tauri/taskai.key`) — mismos pasos que `publicar.ps1` desde "3) Windows" (descargar artefactos, `tauri signer sign`, `latest.json`, `gh release create v1.5.1 … --notes-file scripts/notas-1.5.1.md --latest`). (Windows + Linux, compilada en GitHub Actions) (se actualiza sola desde la 1.3.0+) · repo **público** · descarga: <https://github.com/EvanDavidMS/taskai/releases/latest>

> ⚠ **19 nov (noche): se reescribió el historial de `main` y de las etiquetas** para quitar la línea `Co-Authored-By: Claude` de todos los commits (Evan no quiere que el repo muestre a Claude como contribuidor). **En la compu de Windows, antes de trabajar:** `git fetch --all --tags --force` y `git reset --hard origin/main` (si hay cambios sin subir, guardarlos antes). Respaldo del historial viejo en la laptop: `~/respaldos/taskai-antes-de-reescribir-2026-11-19.bundle`.

## 1. Dónde vamos

TaskAI está publicado y un amigo de Evan ya lo instaló desde GitHub. Lo que hay hoy:

**Escribir y ordenar**
- Editor con **números de línea** (resalta la línea actual), sin recuadro de foco, tipografía **Inter** incluida en la app.
- **Título opcional** por nota (se guarda en `meta.json`): manda en la lista y se le pasa a `ai_classify` como pista ("Título: …").
- La IA ordena 3 s después de dejar de escribir y **se ve escribiendo en vivo** (streaming: `ai_structure` emite `ai-stream`).
- **Pegar imágenes** con `Ctrl + V` → `.taskai/img/<ms>.png`; en el texto queda `![imagen](img/<ms>.png)`. No se mandan a la IA; se ven como miniaturas.
- **Modo lectura** (`Ctrl + E`): solo la versión ordenada, centrada.
- Pendientes en la versión ordenada como **tarjeta de renglones**: todo el renglón palomea; la fecha va en una pastilla (roja si ya pasó, de color si es hoy).
- **Versión ordenada estilo "marcatexto"** (v1.4.5): las negritas de la IA se pintan como pastilla suave del color de acento (`strong.hl`); si la negrita **es** una fecha/hora (`WHEN_ONLY_RE` en `App.tsx`) va en azul (`strong.hl.when`). El resumen (`>`) es un párrafo de entrada sin caja (tenue, lo importante en oscuro); los `##` son etiquetas discretas en mayúsculas. Tokens `--hl-bg`, `--hl-when-bg`, `--hl-when-fg` en los dos temas.

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
# 2) Publicar: sube la versión en los 3 archivos, commit + push, lanza el workflow
#    "Compilar y firmar (Windows)" en Actions, espera, baja el instalador, crea AQUÍ su .sig
#    de actualizaciones con la llave local, latest.json y el Release:
.\scripts\publicar.ps1 -Version 1.4.1 -Notas scripts\notas-1.4.1.md
#    -Local       → compila en esta compu (como antes, sin SignPath)
#    -SinPublicar → compila en esta compu y genera latest.json, sin subir nada
```

- **Desde la 1.4.1 se compila en GitHub Actions** (`.github/workflows/compilar.yml`, solo `workflow_dispatch`; trabajos `windows` y `linux` en paralelo): requisito de SignPath. El workflow hace `tauri build --no-bundle` → `tauri bundle` (le escribe a `taskai.exe` el tipo "nsis"; por eso se arma una vez ANTES de firmar) → firma `taskai.exe` → `tauri bundle` otra vez (probado: el exe ya marcado no cambia, misma SHA-256) → firma el instalador. Sin el secreto `SIGNPATH_API_TOKEN` compila sin firmar. El `.sig` de las actualizaciones se calcula en la compu de Evan **después** de la firma de SignPath (si no, no coincidiría). El artefacto `TaskAI-windows` trae también el `taskai.exe` suelto, para reportar falsos positivos.

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
| Licencia **GPL-3.0-only** desde la 1.4.1 (hasta la 1.4.0 fue MIT); repo **público** desde el 19 nov 2026 | Que lo usen y modifiquen, pero nadie lo cierre y lo venda como propio; sigue siendo licencia OSI (requisito de SignPath). Nombre y logo reservados (nota en el README). |

## 5. Configuración del usuario

`%APPDATA%\TaskAI\config.json` (Linux: `~/.config/TaskAI/config.json`):

```json
{ "name": "Evan", "notes_dir": null, "onboarded": true, "start_ai_on_open": true, "stop_ai_on_exit": true }
```

- `notes_dir: null` → `Documentos\TaskAI`.
- En `localStorage`: `taskai.theme`, `taskai.accent`, `taskai.model`, `taskai.focus`, `taskai.read`, `taskai.remind` (`{on, lead}`), `taskai.notified`, `taskai.settingsTab`, `taskai.autoUpdate` (`"0"` = no buscar actualizaciones al abrir).

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

**⚠ URGENTE: Windows Defender borra TaskAI (falso positivo)**
- 19 nov: Defender detectó `taskai.exe` 1.3.0 y 1.4.0 como **`Trojan:Win32/Bearfoos.A!ml`** (heurística de machine learning) y lo eliminó (exe, accesos directos y registro). Las notas no se tocan.
- Evan debe: permitirlo en Historial de protección y **reportar falso positivo** en <https://www.microsoft.com/en-us/wdsi/filesubmission> (como "Software developer"; subir el `taskai.exe` suelto, que es lo que Defender detecta, no el setup).
- ✅ **Reporte 1 enviado (19 nov 2026, 13:29):** `taskai.exe` 1.4.0, Submission ID `4e25c3ca-13c9-4caf-937e-d938c4609256`, firmas 1.463.374.0, estado *Pending*. La respuesta llega al correo de Evan. **Al publicar la 1.4.1, mandar otro reporte con su `taskai.exe` nuevo.**
- **v1.4.2 publicada (19 nov):** arregla que los menús de la barra (Exportar, cambiar carpeta) quedaban debajo del panel de la nota. Causa: animaciones con fill `both` dejan al elemento en su propia capa (stacking context). Regla: en `App.css` usar siempre `backwards`; `.toolbar` lleva `z-index: 5`. El `taskai.exe` de la 1.4.2 queda en `src-tauri/target/release/bundle/actions/`.
- **v1.4.1 publicada (19 nov, 14:13)** desde Actions (sin firma de Windows todavía; `.sig` de actualizaciones OK, `latest.json` apunta a 1.4.1). El `taskai.exe` para el reporte 2 a Microsoft queda en `src-tauri/target/release/bundle/actions/taskai.exe` (también en el artefacto `TaskAI-windows` del run). (El aviso de Node 20 en Actions ya se arregló: ver el punto 13.)
- En código, quitar lo que parece malware: borrar `Startup\Ollama.lnk` (`remove_ollama_autostart`), `taskkill /F` y `tasklist`, y la instalación silenciosa de Ollama.
- **Plan acordado con Evan:** en vez del instalador de Ollama, usar su **versión portátil** (`ollama-windows-amd64.zip` de los Releases de Ollama; confirmar que existe y su tamaño). TaskAI la descarga a su propia carpeta (p. ej. `%LOCALAPPDATA%\TaskAI\ollama`) y corre `ollama serve` como **proceso hijo** (guardar el `Child` y apagarlo con `child.kill()`, sin `taskkill` a procesos ajenos). Así no hay ventana de Ollama que confunda, ni arranque con Windows, ni instalador silencioso; desinstalar = borrar esa carpeta + `~\.ollama`. Si el usuario ya tiene Ollama instalado, usar el suyo y no tocarlo.
- ✅ **Paso 1 hecho y publicado en la v1.4.1 (19 nov):** `install_ollama` baja `ollama-windows-{amd64|arm64}.zip` (1.5 GB, 2.2 GB descomprimido; CUDA 12/13 + Vulkan) a `%LOCALAPPDATA%\TaskAI\ollama` (descomprime en `.part` y renombra). `spawn_ollama` guarda el `Child` en `OLLAMA_CHILD`; `ollama_stop` solo mata ese hijo y, si el Ollama es ajeno (Windows), solo descarga los modelos y responde `"FREED"` (la app avisa "IA en pausa"). Si el usuario ya tiene el Ollama oficial, se usa ese (`windows_ollama_exe`). Se quitaron `taskkill`, `tasklist`, `/VERYSILENT` y lo de `Ollama.lnk` (también del desinstalador, que ahora borra la carpeta portátil y solo pregunta por `~\.ollama` si no hay Ollama oficial). Probado: descarga + descompresión con el código real y el portátil corriendo en el puerto 11500 encontró `qwen2.5:7b` y usó la RTX 3060 (CUDA, 56 tok/s). **Falta:** probar el asistente completo en una compu sin Ollama, el desinstalador, y publicar.
- **Paso 3 preparado en código (publicado en la v1.4.1):** workflow de Actions, configuraciones de artefacto en `.signpath/` (`taskai-exe`, `taskai-instalador`, con `product-name`/`product-version` que SignPath exige; los dos .exe ya traen ProductName "TaskAI" y la versión), secciones **"Política de firma de código (Code signing policy)"** y **"Privacidad"** en el README (y enlaces en las notas del Release), e interruptor para no buscar actualizaciones al abrir (SignPath pide que toda conexión esté documentada y se pueda apagar). **Falta (pendiente NO urgente, decisión de Evan el 19 nov):** solicitar en <https://signpath.org/apply> **cuando el repo tenga algo de reputación** (estrellas, amigos que lo usen y lo prueben; Evan los va a conseguir estos días). El formulario pide "Reputation" (enlaces/estadísticas de uso) y con 0 estrellas probablemente lo rechazan. Respuestas del formulario ya redactadas: Project Name `TaskAI`; Repository/Homepage = URL del repo; Download URL = `/releases`; Privacy Policy = `#privacidad` del README; Maintainer Type Individual; Build System GitHub Actions; Tagline/Description/Reputation en inglés (ver la conversación del 19 nov o redactar de nuevo, honestas). Requiere 2FA en GitHub y SignPath. Al solicitar, cambiar el bloque "Próximamente" del README por la línea de crédito exacta. Cuando aprueben, crear en SignPath el proyecto `taskai`, la política `release-signing` y las 2 configuraciones (pegar los XML de `.signpath/`; revisar que el comodín `TaskAI_*_x64-setup.exe` sea válido), y en GitHub el secreto `SIGNPATH_API_TOKEN` + la variable `SIGNPATH_ORGANIZATION_ID`.
- Después: firma de código gratis con **SignPath Foundation** (signpath.org). Requisitos: licencia OSI (GPL-3.0 ✅), repo público ✅, binarios compilados desde el repo en **GitHub Actions** (gratis en repos públicos; Evan **ya aceptó** usarlo para esto), página de "política de firma" con el crédito "Free code signing provided by SignPath.io, certificate by SignPath Foundation". El editor aparece como "SignPath Foundation". Hay que solicitarlo y esperar aprobación.
- **Orden acordado con Evan (y por qué las dos):** 1) Ollama portátil + quitar lo sospechoso, 2) Evan reporta el falso positivo a Microsoft, 3) SignPath + workflow de Actions que compile, firme y suba al Release. La firma **no sustituye** el código limpio: la detección `!ml` es por comportamiento y puede caer aun firmado; además el cambio de código quita la ventana de Ollama (eso ninguna firma lo arregla), deja de cerrar Ollamas ajenos, y SignPath revisa que lo que firma no se porte como malware.

**Pendiente (siguiente sesión)**
9. ~~Instaladores de **Linux**~~ ✅ v1.4.3 trabajo `linux` en `compilar.yml` (Ubuntu 22.04 a propósito, por la glibc vieja = corre en más distros): `.deb`, `.rpm` y AppImage (~80 MB; el que sirve para Arch/EndeavourOS, puede pedir `fuse2`). `publicar.ps1` firma los 3 y pone en `latest.json` `linux-x86_64-{appimage,deb,rpm}` + `linux-x86_64` (=AppImage): el actualizador de Tauri busca `{os}-{arch}-{tipo}` y luego `{os}-{arch}`; con deb/rpm pide la contraseña con pkexec. Probado en una rama de prueba (19 nov): los dos trabajos OK y las 3 firmas OK. **Falta:** que Evan pruebe el AppImage en su laptop. **macOS:** sin instalador (habría que agregar un trabajo `macos`; sin firma de Apple, macOS lo bloquea feo).

- **v1.4.4 (19 nov), arreglos de Linux probados en la laptop (Arch + Hyprland/Quickshell):**
  - *Sonidos:* el AppImage traía el núcleo de GStreamer pero **ningún plugin** → WebKit no decodificaba los `.mp3`. Arreglo: `bundle.linux.appimage.bundleMediaFramework: true` + en `compilar.yml` instalar `gstreamer1.0-{plugins-base,plugins-good,plugins-bad,libav,pulseaudio}` y `patchelf` (el plugin gstreamer de linuxdeploy lo exige). El AppImage pesa más.
  - *Ícono:* Quickshell (y otros) **no encuentran el ícono por nombre** (`taskai`) → sale roto en notificaciones y lanzador. Arreglo: rutas completas. `integrate_linux()` en `lib.rs` copia el PNG a `~/.local/share/icons/hicolor/256x256/apps/taskai.png`; el comando `notify_icon` se lo pasa a `sendNotification` (`reminders.ts`); si es AppImage (`$APPIMAGE`) también escribe `~/.local/share/applications/taskai.desktop` con `Exec` e `Icon` absolutos. `.deb`/`.rpm` usan la plantilla `src-tauri/linux/taskai.desktop` (`Icon=/usr/share/icons/hicolor/128x128/apps/taskai.png`). **Ojo:** el AppImage se arma desde el .deb y linuxdeploy exige el ícono por nombre → en `compilar.yml` el AppImage va en otro paso con `linux/appimage.desktop` (`Icon={{icon}}`).
  - *Compilar el AppImage en Arch:* `env NO_STRIP=true pnpm tauri build --bundles appimage` y tener `patchelf` (sin `NO_STRIP` linuxdeploy falla). El aviso de `gst-plugin-scanner` en Arch es inofensivo.
  - *Publicar desde Linux:* no hay `pwsh`; se hizo a mano lo mismo que `publicar.ps1` (llave en `~/.tauri/taskai.key`).
10. ~~Plantilla de **Diario**~~ ✅ v1.4.1 `create_note` en "Diario" escribe 4 preguntas (`DIARY_PROMPTS` en `lib.rs` **y** `src/templates.ts`: mantenerlas iguales). `strip_empty_prompts`/`stripEmptyPrompts` quitan las que quedaron sin contestar: así una plantilla vacía cuenta como nota vacía (se descarta), no se manda a la IA, no cuenta palabras y sale "Nota sin título". Prueba: `cargo test --lib`.
11. ~~**Microanimaciones**~~ ✅ v1.4.1 bloque al final de `App.css`: entrar a la nota, tablero con `key` por sección (vuelve a animar), tarjetas escalonadas (`--i`), punto de la palomita con rebote (`::after`) y tachado que aparece suave; todo se apaga con `prefers-reduced-motion`. Las capturas headless congelan las animaciones: para capturar, apagarlas con un estilo (`?still` en el preview).
12. ~~**Sonidos**~~ ✅ v1.4.3 `src/sounds.ts` (Web Audio, se precargan; volumen por sonido en `VOLUME`), archivos en `public/sounds/`: `tecla` (cada tecla en el editor y el título, tono un poco al azar; desde la 1.4.5 también con la tecla apretada), `papelera` (mandar a la papelera), `palomita` (solo al palomear, no al despalomear), `ordenada` (la IA terminó), `recordatorio`. Los originales de Evan están en Descargas (los dos con nombre: tecla y papelera; los 3 de Pixabay los repartí yo). Configuración → General → Sonidos: interruptor general + uno para las teclas + botones para probar. `localStorage` `taskai.sounds` = `{on, keys}`. Crédito de Pixabay en el README (no son GPL).
13. ~~Acciones de Actions en Node 20~~ ✅ checkout@v7, setup-node@v7, upload-artifact@v7, pnpm/action-setup@v6 (todas Node 24).

- **v1.4.5 (19 nov), pulido visual y de uso (probado en la laptop):**
  - *Barra de la nota a medio ancho:* el botón Ordenar se salía (la barra necesita ~830 px y el corte a solo-íconos era 720). Ahora entre 720 y 900 px el estado queda solo como puntito (`@container (max-width: 900px)`), y si aun así no cabe, el texto del estado se recorta con "…"; los botones nunca se encogen (`.tools > *`). Probado de 1280 a 740 px.
  - *Arrastrar notas:* en Linux con zoom fraccionario WebKitGTK pinta gigante la "foto" del arrastre. Ahora se esconde con una imagen transparente (`EMPTY_DRAG_IMAGE` + `setDragImage`) y se dibuja una pastilla propia (`.drag-chip`) que sigue al puntero con `dragover` en `document`. Evan lo probó: bien.
  - *Selección:* `body { user-select: none }` y solo se puede seleccionar en `textarea`, `input` y `.md` (Ctrl+A ya no pinta toda la interfaz). Ojo: la copia invisible de las líneas del editor (`.ln-text`) NO debe ser seleccionable.
  - *Sonido de teclas:* ahora suena con cada repetición al dejar la tecla apretada (antes se ignoraba `e.repeat`) y con cada letra borrada; Backspace/Supr no suenan si no queda nada que borrar. Tope de 15 ms entre sonidos. Silenciar: Configuración → General → Sonidos (ya existía).
  - *"Probar aviso"* también toca el sonido del recordatorio.
  - *AppImage:* `hide_window()` (lo usan todos los programas que lanza TaskAI) ahora quita `LD_LIBRARY_PATH`, `GST_*`, `GTK_*`, `GIO_MODULE_DIR`… si corre como AppImage; si no, programas del sistema cargan las glib viejas del AppImage y truenan (probado con `update-desktop-database`: `undefined symbol: g_string_free_and_steal`).
  - *IA (prompt):* tercer ejemplo resuelto (`EXAMPLE3_IN/OUT`: planes para hoy en la noche y mañana, con `{HOY}` = hoy sin año) + paso 6 al "pensar" (¿ya pasó o es plan?, ¿cuándo?, "después de X" = mismo día que X) + reglas: los planes nunca en pasado, cada cosa una sola vez, negritas de 1 a 3 palabras. Caso real de Evan (certificados de inglés y ciberseguridad, LoL en la madrugada): antes decía "Terminé el certificado de ciberseguridad", olvidaba el pendiente de hoy y repetía el de inglés; ahora sale bien. Probado con 4 notas (estudio, planes, trabajo y la de Evan), 2 corridas idénticas.
  - *Actualización automática en Linux:* probada de verdad: el AppImage 1.4.3 de Evan se actualizó solo a la 1.4.4.

- **v1.5.0 (19 nov), IA en dos pasos + prioridad en pendientes (probado en la laptop):**
  - *Banco de pruebas* `scripts/ia/`: `casos.json` (20 notas inventadas con lo que DEBE salir; HOY fijo = jueves 19 nov 2026; las `[..]` son las que pondría annotateDates), `evaluar.py` (método de un paso), `dos_pasos.py` (el de la app: lee `SYSTEM_PROMPT`, `EXAMPLE*`, `TASKS_*` de `lib.rs` y aplica `mergeTasks` real de `src/aiTasks.ts` con Node vía `merge.mts`). Uso: `python3 scripts/ia/dos_pasos.py` (todo, ~2 min) o `-c caso -v`. **Regla: medir antes y después de tocar la IA; solo se queda lo que sube la calificación.** Hay que tener Ollama encendido.
  - *Resultados (qwen2.5:7b):* un paso 11/18 → dos pasos 16/18; con prioridad y 2 casos más: **17/20**. En 6 notas "nuevas" (no usadas para ajustar): 4/6 → 5/6.
  - *Paso 2 = `ai_tasks` (Rust):* después de `ai_structure`, pide los pendientes como JSON con `format` (JSON schema): `tipo` (compromiso / plan_libre / deseo / ya_hecho), `dia` (enum: hoy + 7 días + "sin fecha", de `nextDays()`), `hora` (enum: solo las horas `[..]` que annotateDates encontró), `prioridad` (alta/normal) y `tipo_nota` (estudio/trabajo/personal). Recibe también la nota ordenada (le dice en qué día quedó cada cosa). 2 ejemplos resueltos con fechas de relleno `{HOY}`, `{MANANA}`, `{D4}`, `{D7}`…
  - *`mergeTasks` (`src/aiTasks.ts`):* cambia la sección "📌 Pendientes" del modelo por una armada por código: solo compromisos, sin repetir, sin #etiquetas, quita "Estudiar/Repasar para X" si ya está X, horas solo si están en el texto, convierte en viñeta las palomitas que el modelo metió en otras secciones, y en notas personales quita "💡 Para entender mejor". Si `ai_tasks` falla, se quedan los pendientes del modelo. Mientras escribe en vivo no se muestran sus pendientes (`PENDING_SPLIT`).
  - *Prioridad:* se guarda como `🔴`/`🟡` al inicio del pendiente (`- [ ] 🔴 Examen — **fecha**`); baja = sin marca. `src/tasks.ts`: `Priority`, `splitPriority`, `setTaskPriority`, `nextPriority` (sin → alta → media → sin), `prioRank`. Se ve como puntito (`.tprio`) en la nota y en Pendientes; clic = cambiar (no palomea). Pendientes ordena por prioridad dentro de cada grupo/día. `carryChecks` conserva la prioridad (y las palomitas) cuando la IA reordena. **La IA marcaba "alta" de más** (exámenes, citas) → `saidUrgent()` solo la acepta si en la MISMA oración del texto hay una palabra de urgencia (urgente, importante, sin falta, no se me puede olvidar…) y una palabra del pendiente.
  - *`annotateDates`:* "mñn"/"mñna" cuentan como "mañana".
  - *Probado y descartado:* anotar también "hoy [fecha]" (arregla "hoy revisar los correos" pero vuelve pendientes un diario en pasado).

- **v1.5.1 (19 nov), notas largas sin perder contexto:** Evan vio que en notas largas (resumen de un documental, ~300 palabras) la IA lo dejaba todo telegráfico ("**Concepto**: frase corta") y perdía conclusiones, causas y contrastes ("pero su modelo de negocio sigue igual", "el problema es un sistema…"), además de inventar el pendiente "Ver el documental".
  - *Reglas no sirvieron* (empeoró 17→15). Lo que sí: **`EXAMPLE4`** (apuntes largos de historia, la caída del Muro de Berlín: oraciones completas, causas, "pero…", conclusión, 💡) **solo si la nota tiene más de `LONG_NOTE_WORDS` (120) palabras**; en notas cortas movía otros resultados. Orden: 1, 2, [4], 3 (el de planes siempre al final). `evaluar.py` imita esa regla.
  - *Pendientes:* `TASKS_EX3` (apuntes de un documental → `pendientes: []`) y en `mergeTasks` `isTopic`: un pendiente sin fecha que es el mismo tema del título ("Fotosíntesis", "Ver …", "Apuntes sobre …") se descarta.
  - *Resultado:* nota real de Evan: de 7 datos clave perdidos a 2, sin pendiente inventado, con 💡. Banco: 16/21 (las cortas igual que antes).
  - *Ojo, ruido:* el banco varía ±1–2 notas entre corridas (Ollama reaprovecha el caché de la consulta anterior): la 1.5.0 publicada falló `planes_semana` en una corrida y la pasó en otra. Para decidir, comparar tendencias y correr dos veces lo dudoso.
  - *`--casos archivo.json`* en `evaluar.py`/`dos_pasos.py`: probar notas reales de Evan sin meterlas al repo (dejarlas en un archivo fuera de `scripts/`).

**Siguiente: seguir mejorando la IA** — lo que queda al probar la 1.5.1:
- Notas largas: todavía pierde algún porqué ("demanda **para recuperar sus datos**") y suaviza matices ("qué tanto fue cómplice" → "la duda de su participación"); sigue usando "**Etiqueta**: …" en vez de oraciones.
- Títulos de más de 6 palabras ("Tarea urgente y planes para el fin de semana").
- "hoy revisar los correos" a veces no sale como pendiente (o sale sin fecha).
- Lo que se vio en la 1.4.5 (sigue valiendo para el paso 1):
- Cambia nombres propios por genéricos ("Danny y Kuroo" → "amigos").
- "El parcial del martes" lo pone bajo la sección "Mañana" (el pendiente sí sale con la fecha bien).
- ~~Sigue cambiando "examen" por "Estudiar …" en Pendientes~~ ✅ resuelto con el paso 2 (1.5.0).
- Pone muchas negritas por renglón en notas de estudio y a veces frases completas.
- Es muy frágil: cada palabra que se cambia en el prompt mueve otros casos. Con 4 variantes probadas, arreglar "martes → Mañana" siempre descomponía la nota de Evan.
- Ideas pendientes: probar otros modelos con `dos_pasos.py -m <modelo>` (llama3.1:8b, gemma; la laptop tiene RTX 5060 de 8 GB → modelos de 7-8B; la PC de Windows 12 GB → cabría un 14B); agregar más casos a `casos.json` cada vez que Evan encuentre una nota mal ordenada (inventada, nunca su nota real: el repo es público).

## 9. Límites conocidos

- El 7B a veces malinterpreta palabras muy mal escritas (leyó "covivi" como "comí").
- Los recordatorios solo funcionan con TaskAI abierto.
- El instalador no tiene firma digital → Windows muestra "Windows protegió su PC" (es de paga).
- El workflow de Actions (`compilar.yml`) es manual. macOS no tiene instalador (habría que agregar un trabajo `macos` al workflow).
