; TaskAI: pasos extra del desinstalador de Windows (Tauri los inserta en su instalador NSIS).
; Al desinstalar de verdad (no al actualizar de versión) pregunta si también quitar la IA y las notas,
; para que no quede nada regado. Las dos preguntas tienen "No" por defecto.

!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
  ${AndIf} $PassiveMode <> 1
  ${AndIfNot} ${Silent}
    SetShellVarContext current

    ; Casilla "borrar datos de la app": también la configuración de TaskAI (nombre, carpeta, preferencias)
    ${If} $DeleteAppDataCheckboxState = 1
      RmDir /r "$APPDATA\TaskAI"
    ${EndIf}

    ; ----- La IA: Ollama y los modelos descargados -----
    IfFileExists "$LOCALAPPDATA\Programs\Ollama\ollama.exe" 0 taskai_sin_ollama
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2|MB_TOPMOST \
      "¿Quieres quitar también la IA de tu computadora?$\n$\nSe desinstalará Ollama y se borrarán los modelos descargados (pueden ocupar varios GB).$\n$\nElige «No» si usas Ollama con otros programas." \
      IDNO taskai_sin_ollama
      nsExec::Exec 'taskkill /F /IM "ollama app.exe"'
      Pop $0
      nsExec::Exec 'taskkill /F /IM "ollama.exe"'
      Pop $0
      ; Su propio desinstalador (Inno Setup) quita el programa y su registro en "Aplicaciones"
      IfFileExists "$LOCALAPPDATA\Programs\Ollama\unins000.exe" 0 taskai_restos
        ExecWait '"$LOCALAPPDATA\Programs\Ollama\unins000.exe" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART'
        ; El desinstalador de Inno se relanza desde una copia temporal: esperamos (máx. 20 s) a que termine
        StrCpy $R9 0
        taskai_espera:
          IfFileExists "$LOCALAPPDATA\Programs\Ollama\ollama.exe" 0 taskai_restos
          IntOp $R9 $R9 + 1
          IntCmp $R9 40 taskai_restos
          Sleep 500
          Goto taskai_espera
      taskai_restos:
      ; Modelos (~\.ollama), registros y lo que haya quedado
      RmDir /r "$PROFILE\.ollama"
      RmDir /r "$LOCALAPPDATA\Ollama"
      RmDir /r "$LOCALAPPDATA\Programs\Ollama"
      Delete "$SMSTARTUP\Ollama.lnk"
    taskai_sin_ollama:

    ; ----- Las notas (solo la carpeta de siempre: Documentos\TaskAI) -----
    IfFileExists "$DOCUMENTS\TaskAI\*.*" 0 taskai_fin
    MessageBox MB_YESNO|MB_ICONEXCLAMATION|MB_DEFBUTTON2|MB_TOPMOST \
      "¿Borrar también todas tus notas?$\n$\n$DOCUMENTS\TaskAI$\n$\nSe perderán para siempre. Si no estás seguro, elige «No»: se quedan en tu carpeta de Documentos y las puedes abrir con cualquier editor." \
      IDNO taskai_fin
      RmDir /r "$DOCUMENTS\TaskAI"
    taskai_fin:
  ${EndIf}
!macroend
