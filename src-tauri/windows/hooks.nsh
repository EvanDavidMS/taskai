; TaskAI: pasos extra del desinstalador de Windows (Tauri los inserta en su instalador NSIS).
; Al desinstalar de verdad (no al actualizar de versión) borra el Ollama portátil de TaskAI y pregunta
; si también quitar los modelos y las notas, para que no quede nada regado. Las preguntas tienen "No"
; por defecto. Un Ollama que el usuario instaló por su cuenta NO se toca.

!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
  ${AndIf} $PassiveMode <> 1
  ${AndIfNot} ${Silent}
    SetShellVarContext current

    ; Casilla "borrar datos de la app": también la configuración de TaskAI (nombre, carpeta, preferencias)
    ${If} $DeleteAppDataCheckboxState = 1
      RmDir /r "$APPDATA\TaskAI"
    ${EndIf}

    ; ----- La IA -----
    ; El Ollama portátil que descargó TaskAI es parte de la app: se borra siempre
    RmDir /r "$LOCALAPPDATA\TaskAI\ollama"
    RmDir "$LOCALAPPDATA\TaskAI" ; solo si quedó vacía

    ; Los modelos descargados (~\.ollama). Si el usuario tiene su propio Ollama, son de él: no preguntamos.
    IfFileExists "$PROFILE\.ollama\models\*.*" 0 taskai_sin_modelos
    IfFileExists "$LOCALAPPDATA\Programs\Ollama\ollama.exe" taskai_sin_modelos 0
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2|MB_TOPMOST \
      "¿Borrar también los modelos de IA descargados?$\n$\n$PROFILE\.ollama$\n$\nPueden ocupar varios GB. Elige «No» si los usas con otros programas." \
      IDNO taskai_sin_modelos
      RmDir /r "$PROFILE\.ollama"
    taskai_sin_modelos:

    ; ----- Las notas (solo la carpeta de siempre: Documentos\TaskAI) -----
    IfFileExists "$DOCUMENTS\TaskAI\*.*" 0 taskai_fin
    MessageBox MB_YESNO|MB_ICONEXCLAMATION|MB_DEFBUTTON2|MB_TOPMOST \
      "¿Borrar también todas tus notas?$\n$\n$DOCUMENTS\TaskAI$\n$\nSe perderán para siempre. Si no estás seguro, elige «No»: se quedan en tu carpeta de Documentos y las puedes abrir con cualquier editor." \
      IDNO taskai_fin
      RmDir /r "$DOCUMENTS\TaskAI"
    taskai_fin:
  ${EndIf}
!macroend
