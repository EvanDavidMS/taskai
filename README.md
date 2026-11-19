<div align="center">

# ✦ TaskAI

**Escribe como piensas. La IA lo ordena.**

Apuntes donde tú escribes rápido y desordenado a la izquierda, y una IA **local** te muestra la versión ordenada a la derecha, en vivo, sin tocar ni una letra de lo que escribiste.

![Rust](https://img.shields.io/badge/Rust-000?logo=rust&logoColor=white)
![Tauri](https://img.shields.io/badge/Tauri_2-24C8DB?logo=tauri&logoColor=white)
![React](https://img.shields.io/badge/React-20232A?logo=react&logoColor=61DAFB)
![Ollama](https://img.shields.io/badge/IA_local-Ollama-ff6a3d)
![Licencia MIT](https://img.shields.io/badge/licencia-MIT-green)

</div>

---

## ¿Qué hace?

```
┌─────────────────────────────┬─────────────────────────────┐
│  TUS APUNTES                │  ✦ VERSIÓN ORDENADA         │
│                             │                             │
│  clase redes hoy            │  # Redes: TCP vs UDP        │
│  el profe dijo q tcp es     │  ## Protocolos              │
│  confiable y udp no, udp    │  - **TCP**: confiable       │
│  pa videollamadas           │  - **UDP**: rápido, usado   │
│  ah y examen el viernes     │    en videollamadas         │
│                             │  ## 📌 Pendientes           │
│                             │  - [ ] Examen el viernes    │
└─────────────────────────────┴─────────────────────────────┘
```

- ✍️ **No destructivo**: tu texto original nunca se modifica. La versión ordenada vive aparte.
- ⚡ **En vivo**: la IA ordena cuando dejas de escribir unos segundos. La misma nota da siempre el mismo resultado.
- 📁 **Se acomoda sola**: la IA manda cada nota a su carpeta (Diario, Escuela, Trabajo, Hobbys, Notas rápidas o las tuyas). Si tú la mueves, respeta tu decisión.
- 📌 **Pendientes con fecha y hora reales**: "examen el viernes" o "a la 1" se convierten en fechas y horas concretas. Los palomeas ahí mismo y no se pierden al reordenar.
- 📌 **Fija una versión** para que la IA ya no la cambie sola, y revísala cuando quieras.
- 🔒 **100% privado y gratis**: la IA corre en tu propia computadora con [Ollama](https://ollama.com). Tus apuntes nunca salen de tu máquina.
- 📁 **Tus archivos son tuyos**: las notas son `.md` normales (compatibles con Obsidian) en `Documentos/TaskAI`.
- ☀️ Modo claro, oscuro o del sistema · modo enfoque · se adapta a cualquier tamaño de ventana.

## Instalación

### 1. Instala la IA (gratis)

1. Descarga Ollama: <https://ollama.com/download>
2. Baja un modelo:

```bash
ollama pull qwen2.5:7b    # recomendado (≈4.7 GB, ideal con GPU)
ollama pull qwen2.5:3b    # ligero, para computadoras modestas
```

### 2. Corre TaskAI

> Pronto habrá instaladores para Windows y Linux en [Releases](../../releases).

Desde el código fuente necesitas [Rust](https://rustup.rs), [Node.js](https://nodejs.org) y [pnpm](https://pnpm.io), además de los [requisitos de Tauri](https://tauri.app/start/prerequisites/) para tu sistema.

```bash
gh repo clone EvanDavidMS/taskai   # repo privado
cd taskai
pnpm install
pnpm tauri dev      # modo desarrollo
pnpm tauri build    # genera el instalador
```

## Cómo está hecho

| Parte | Tecnología |
|---|---|
| Backend | **Rust** + Tauri 2: archivos, conexión con Ollama |
| Interfaz | React + TypeScript + Vite |
| IA | Ollama (`/api/generate`), modelos locales |
| Markdown | `marked` + `DOMPurify` (sanitizado contra XSS) |

```
src/            → interfaz (React)
src-tauri/src/  → backend (Rust): notas, IA
```

## Ideas a futuro

- [ ] Instaladores automáticos con GitHub Actions (Windows `.exe`/`.msi`, Linux `.deb`/AppImage)
- [x] Marcar pendientes desde la vista ordenada
- [x] Modo claro
- [ ] Atajos de teclado e ícono propio
- [ ] Respuesta en streaming (ver cómo se escribe la versión ordenada)

## Licencia

[MIT](LICENSE) © Evan
