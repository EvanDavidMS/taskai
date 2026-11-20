## ⬇ Cómo instalar

**Windows**
1. Descarga **`TaskAI_1.4.5_x64-setup.exe`** (aquí abajo, en *Assets*).
2. Ábrelo y dale **Siguiente → Instalar**. No pide administrador.
   - Si sale *"Windows protegió su PC"*: **Más información → Ejecutar de todas formas** (el programa todavía no tiene firma digital).
3. Abre TaskAI: el asistente descarga la IA (Ollama) y el modelo por ti.

**Linux**
- **Cualquier distro** (Arch, EndeavourOS, Manjaro…): **`TaskAI_1.4.5_amd64.AppImage`** → `chmod +x TaskAI_*.AppImage && ./TaskAI_*.AppImage` (en Arch, si no abre: `sudo pacman -S fuse2`).
- **Ubuntu, Debian, Mint:** **`TaskAI_1.4.5_amd64.deb`** → `sudo apt install ./TaskAI_1.4.5_amd64.deb`
- **Fedora, openSUSE:** **`TaskAI-1.4.5-1.x86_64.rpm`** → `sudo dnf install ./TaskAI-1.4.5-1.x86_64.rpm`
- La IA (Ollama) se instala aparte; el asistente te dice cómo en tu distro.

Si ya tienes la 1.3.0 o más nueva, TaskAI se actualiza solo. Tus notas y tu configuración se quedan.

> **¿Windows Defender borró TaskAI?** Es un falso positivo que ya reportamos a Microsoft. Ve a *Seguridad de Windows → Protección antivirus → Historial de protección*, busca TaskAI y elige **Permitir**; luego instala esta versión.

## ✨ Novedades de la 1.4.5

- **Versión ordenada más fácil de leer:** lo importante sale resaltado como con **marcatexto**, las fechas y horas en azul, el resumen como párrafo de entrada (sin caja) y más aire entre secciones.
- **La IA entiende mejor tus planes:** lo que vas a hacer ya no lo escribe como si ya lo hubieras hecho, no repite cosas en dos días y saca el pendiente de hoy en la noche con su hora.
- **Sonido al escribir:** si dejas una tecla apretada, suena con cada letra; al borrar, con cada letra borrada (y se calla cuando ya no hay nada que borrar). Se apaga en Configuración → General → Sonidos.
- **Arrastrar notas a una carpeta:** ahora sale una pastillita con el título que sigue al puntero (en Linux salía gigante).
- **Ya no se selecciona toda la ventana** con Ctrl + A: solo puedes seleccionar y copiar tus apuntes y la versión de la IA.
- **Ventana a medio ancho:** los botones de arriba de la nota ya no se salen.
- **Linux (AppImage):** los programas que abre TaskAI ya no fallan por las librerías del AppImage.

---

[Política de firma de código (Code signing policy)](https://github.com/EvanDavidMS/taskai#pol%C3%ADtica-de-firma-de-c%C3%B3digo-code-signing-policy) · [Privacidad](https://github.com/EvanDavidMS/taskai#privacidad) · Licencia GPL v3
