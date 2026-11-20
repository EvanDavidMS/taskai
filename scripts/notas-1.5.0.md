## ⬇ Cómo instalar

**Windows**
1. Descarga **`TaskAI_1.5.0_x64-setup.exe`** (aquí abajo, en *Assets*).
2. Ábrelo y dale **Siguiente → Instalar**. No pide administrador.
   - Si sale *"Windows protegió su PC"*: **Más información → Ejecutar de todas formas** (el programa todavía no tiene firma digital).
3. Abre TaskAI: el asistente descarga la IA (Ollama) y el modelo por ti.

**Linux**
- **Cualquier distro** (Arch, EndeavourOS, Manjaro…): **`TaskAI_1.5.0_amd64.AppImage`** → `chmod +x TaskAI_*.AppImage && ./TaskAI_*.AppImage` (en Arch, si no abre: `sudo pacman -S fuse2`).
- **Ubuntu, Debian, Mint:** **`TaskAI_1.5.0_amd64.deb`** → `sudo apt install ./TaskAI_1.5.0_amd64.deb`
- **Fedora, openSUSE:** **`TaskAI-1.5.0-1.x86_64.rpm`** → `sudo dnf install ./TaskAI-1.5.0-1.x86_64.rpm`
- La IA (Ollama) se instala aparte; el asistente te dice cómo en tu distro.

Si ya tienes la 1.3.0 o más nueva, TaskAI se actualiza solo. Tus notas y tu configuración se quedan.

> **¿Windows Defender borró TaskAI?** Es un falso positivo que ya reportamos a Microsoft. Ve a *Seguridad de Windows → Protección antivirus → Historial de protección*, busca TaskAI y elige **Permitir**; luego instala esta versión.

## ✨ Novedades de la 1.5.0

- **Pendientes mucho más atinados:** la IA ahora saca los pendientes en un paso aparte y TaskAI revisa lo que devuelve. Ya no convierte deseos ("ojalá", "quiero ahorrar") ni planes por gusto (comer, jugar) en pendientes, no inventa "estudiar para…", no repite tareas, no copia #etiquetas y solo usa horas que tú escribiste.
- **Prioridad en los pendientes:** un puntito 🔴 (alta) o 🟡 (media) junto a cada pendiente. Haz clic en él para cambiarla. En Pendientes, lo urgente sale primero. Si escribes "urgente", "importante" o "sin falta", la IA lo marca solita.
- **Notas personales más limpias:** ya no aparece "💡 Para entender mejor" en tu diario o tus planes.
- **"mñn" también cuenta como mañana** al calcular fechas.

---

[Política de firma de código (Code signing policy)](https://github.com/EvanDavidMS/taskai#pol%C3%ADtica-de-firma-de-c%C3%B3digo-code-signing-policy) · [Privacidad](https://github.com/EvanDavidMS/taskai#privacidad) · Licencia GPL v3
