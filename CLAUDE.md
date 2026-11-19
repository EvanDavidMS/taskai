# TaskAI — guía para Claude

App de escritorio de apuntes: el usuario escribe rápido y desordenado a la izquierda, y una IA **local** (Ollama) muestra a la derecha la versión ordenada, en vivo, **sin tocar nunca el texto original**. También acomoda cada nota en una carpeta.

> **Primero lee [`HANDOFF.md`](HANDOFF.md)**: qué instalar, el estado actual, las decisiones tomadas y los siguientes pasos.

## Con quién trabajas

- **Evan**, estudiante (Tecmilenio, ciberseguridad/desarrollo). Habla **español de México**: responde siempre en español, claro y sin jerga innecesaria.
- **Nada que cueste dinero.** Nada de APIs de paga ni servicios con tarjeta. La IA es Ollama local y gratis.
- En Linux usa **fish**: los comandos que le des para pegar deben funcionar en fish (sin `VAR=valor cmd`; usa `env VAR=valor cmd` o `bash -c '...'`).
- Su compu principal ahora es **Windows** (PowerShell). La laptop es EndeavourOS con fish.
- Le gusta ver avances visuales: después de un cambio de UI, compila, instala y verifica con capturas (ver "Cómo verificar la UI").

## Stack

- **Tauri 2** + **Rust** (backend) + **React 19 / TypeScript / Vite** (interfaz).
- Rust se instala con `mise` en Linux (`mise exec -- cargo …`) o `rustup` en Windows.
- Gestor de paquetes JS: **pnpm**.
- IA: **Ollama** en `http://localhost:11434`; modelo por defecto `qwen2.5:7b`.

## Archivos clave

| Archivo | Qué hace |
|---|---|
| `src-tauri/src/lib.rs` | Todo el backend: notas y carpetas en disco, metadatos, Ollama (ordenar, clasificar, descargar modelos), detección de SO |
| `src/App.tsx` | Interfaz principal + lógica de IA del lado del cliente (fechas, horas, palomitas) |
| `src/Onboarding.tsx` | Asistente de bienvenida (primera vez): nombre, tema, carpeta, instalar Ollama, elegir modelo |
| `src/Settings.tsx` | Página de Configuración (General, Apariencia, IA, Recordatorios, Atajos) |
| `src/tasks.ts` · `src/TasksView.tsx` | Vista Pendientes: lee las palomitas `- [ ] texto — **fecha, hora**` de todas las notas |
| `src/reminders.ts` | Avisos del sistema (plugin notification) para pendientes con hora + resumen diario |
| `src/TrashView.tsx` | Papelera (restaurar / borrar para siempre) |
| `src/icons.tsx` | Íconos de línea, logo (SVG) y color/ícono de cada carpeta |
| `src/accents.ts` | Colores principales elegibles |
| `src/App.css` | Estilos. **Todos los colores son tokens** en `:root` (oscuro) y `:root[data-theme="light"]` (claro) |
| `src/main.tsx` | Aplica el tema antes del primer pintado (evita el destello) |

## Datos del usuario (en disco, NO en el repo)

```
Documentos/TaskAI/            (dirs::document_dir: ~/Documentos en Linux español, Documents en Windows)
├── Notas rápidas/  Diario/  Escuela/  Trabajo/  Hobbys/  <carpetas propias>/
│   └── nota-<ms>.md          ← texto crudo del usuario (la IA nunca lo modifica)
└── .taskai/
    ├── nota-<ms>.md          ← versión ordenada por la IA (con palomitas [x])
    ├── img/<ms>.png          ← imágenes pegadas con Ctrl + V (en el texto: `![imagen](img/<ms>.png)`)
    ├── papelera/             ← notas borradas (30 días): <id>.md, <id>.ordenada.md e indice.json
    └── meta.json             ← { id: { locked, pinned, title } }
```

- `title`: título opcional que escribió el usuario. Manda sobre el título de la IA y se le pasa a `ai_classify` como pista ("Título: …").
- Las imágenes **no** se mandan a la IA (`stripImages`); se ven como miniaturas bajo el editor y la versión ordenada. Al borrar una nota se borran sus imágenes.

- `locked`: el usuario movió la nota a mano → la IA ya no la cambia de carpeta.
- `pinned`: versión ordenada fijada → la IA ya no la reescribe sola (solo con "Revisar").
- Las notas sueltas en la raíz se migran solas a "Notas rápidas" al iniciar.
- Borrar manda a la papelera (`delete_note`); las notas **vacías** (sin texto ni título) se descartan solas al salir de ellas y al abrir la app.

## Cómo funciona la IA (importante: los modelos de 7B son malos con cuentas)

1. **Las fechas y horas las calcula el código, no el modelo.** `annotateDates()` en `App.tsx` pega el valor real al texto que se manda: `mañana` → `mañana [jueves, 19 de noviembre]`, `a la 1` → `a la 1 [1:00 PM]`. "En la mañana" o "esta mañana" no se tocan; "a las 9" sin pista no se adivina.
2. `ai_structure` (Rust) usa `/api/chat` con un **system prompt de formato fijo** + **2 ejemplos resueltos** (few-shot) + `temperature 0, seed 42, top_k 1` → la misma nota da el mismo resultado.
3. Limpieza en el cliente: `stripNotes()` quita los `[...]` que el modelo copie y `normalizeTimes()` deja todas las horas como `1:00 PM`.
4. `carryChecks()` conserva las palomitas `[x]` cuando la IA reordena.
5. `ai_classify` (Rust) elige la carpeta con **JSON schema** (`format` con `enum` de las carpetas existentes) → no puede inventar carpetas.

**Regla de oro:** con modelos chicos, **ejemplos > reglas**. Si algo sale mal, primero agrega o ajusta un ejemplo resuelto; agregar muchas reglas lo confunde.

## Comandos

```bash
pnpm install
pnpm tauri dev                       # modo desarrollo (recarga en vivo)
npx tsc --noEmit                     # revisar tipos
pnpm tauri build --no-bundle         # binario optimizado en src-tauri/target/release/
pnpm tauri build                     # instaladores (.msi/.exe en Windows; .deb/.rpm/AppImage en Linux)
```

Configuración del usuario: `config.json` en `dirs::config_dir()/TaskAI/` (Windows: `%APPDATA%\TaskAI`). Borrarlo hace que vuelva a salir el asistente.

Linux, instalar en el menú de apps: copiar el binario a `~/.local/bin/taskai` (el `.desktop` ya apunta ahí; ver HANDOFF).

## Cómo probar los prompts sin abrir la app

Hay scripts de Python que leen las constantes de `lib.rs` (`SYSTEM_PROMPT`, `EXAMPLE_IN/OUT`, `EXAMPLE2_IN/OUT`, `folder_hint`) y llaman a Ollama directo. Prueba **siempre** con varias notas y corre 2 veces para confirmar que el resultado es idéntico. Ver HANDOFF → "Cómo probar".

## Cómo verificar la UI

Crea temporalmente `__preview.html` + `src/__preview.tsx` que usen `mockIPC` de `@tauri-apps/api/mocks` con notas falsas, corre `pnpm vite --port 1432` y toma capturas con un navegador headless (`zen-browser --headless --screenshot` o Chrome). **Bórralos al terminar** y no los subas.

## Reglas del proyecto

- Nunca modificar el texto crudo del usuario. La IA solo escribe en `.taskai/`.
- La versión pública usa **solo Ollama**. **No** implementar login con la suscripción de Claude Pro o ChatGPT Plus: va contra la política de Anthropic y OpenAI (las apps de terceros deben usar API key).
- Rutas e ids siempre pasan por `safe_id` / `safe_folder` (evitan escaparse de la carpeta con `../`).
- El Markdown de la IA se sanitiza con DOMPurify antes de pintarlo.
- Commits en español, descriptivos.
