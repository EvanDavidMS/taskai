## ⬇ Cómo instalar

**Windows**
1. Descarga **`TaskAI_1.4.4_x64-setup.exe`** (aquí abajo, en *Assets*).
2. Ábrelo y dale **Siguiente → Instalar**. No pide administrador.
   - Si sale *"Windows protegió su PC"*: **Más información → Ejecutar de todas formas** (el programa todavía no tiene firma digital).
3. Abre TaskAI: el asistente descarga la IA (Ollama) y el modelo por ti.

**Linux**
- **Cualquier distro** (Arch, EndeavourOS, Manjaro…): **`TaskAI_1.4.4_amd64.AppImage`** → `chmod +x TaskAI_*.AppImage && ./TaskAI_*.AppImage` (en Arch, si no abre: `sudo pacman -S fuse2`).
- **Ubuntu, Debian, Mint:** **`TaskAI_1.4.4_amd64.deb`** → `sudo apt install ./TaskAI_1.4.4_amd64.deb`
- **Fedora, openSUSE:** **`TaskAI-1.4.4-1.x86_64.rpm`** → `sudo dnf install ./TaskAI-1.4.4-1.x86_64.rpm`
- La IA (Ollama) se instala aparte; el asistente te dice cómo en tu distro.

Si ya tienes la 1.3.0 o más nueva, TaskAI se actualiza solo. Tus notas y tu configuración se quedan.

> **¿Windows Defender borró TaskAI?** Es un falso positivo que ya reportamos a Microsoft. Ve a *Seguridad de Windows → Protección antivirus → Historial de protección*, busca TaskAI y elige **Permitir**; luego instala esta versión.

## ✨ Novedades de la 1.4.4

- **Linux: ya suenan los sonidos** en el AppImage (le faltaban los componentes de audio).
- **Linux: el logo de TaskAI** ya sale en las notificaciones, en el menú de apps y en la barra.
- **"Probar aviso"** (Configuración → Recordatorios) ahora también toca el sonido del recordatorio.
- **Ventana a medio ancho:** el botón **Ordenar** ya no se sale de la barra de la nota.

---

[Política de firma de código (Code signing policy)](https://github.com/EvanDavidMS/taskai#pol%C3%ADtica-de-firma-de-c%C3%B3digo-code-signing-policy) · [Privacidad](https://github.com/EvanDavidMS/taskai#privacidad) · Licencia GPL v3
