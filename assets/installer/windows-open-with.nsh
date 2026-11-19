; Offers Desktop in "Open with" for the files it can open on their own.
;
; electron-builder's fileAssociations would also replace each extension's
; default handler, so this writes OpenWithProgids only and leaves the user's
; default app alone.
!define FILE_MODE_PROGID "${APP_ID}.file"

!macro FileModeRegisterExtension EXT
  WriteRegStr SHELL_CONTEXT "Software\Classes\.${EXT}\OpenWithProgids" "${FILE_MODE_PROGID}" ""
!macroend

!macro FileModeUnregisterExtension EXT
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.${EXT}\OpenWithProgids" "${FILE_MODE_PROGID}"
!macroend

!macro customInstall
  WriteRegStr SHELL_CONTEXT "Software\Classes\${FILE_MODE_PROGID}" "" "${PRODUCT_NAME}"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${FILE_MODE_PROGID}\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${FILE_MODE_PROGID}\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
  !insertmacro FileModeRegisterExtension "md"
  !insertmacro FileModeRegisterExtension "markdown"
  !insertmacro FileModeRegisterExtension "csv"
  !insertmacro FileModeRegisterExtension "html"
  !insertmacro FileModeRegisterExtension "htm"
  System::Call 'shell32::SHChangeNotify(i, i, i, i) v (0x08000000, 0, 0, 0)'
!macroend

!macro customUnInstall
  !insertmacro FileModeUnregisterExtension "md"
  !insertmacro FileModeUnregisterExtension "markdown"
  !insertmacro FileModeUnregisterExtension "csv"
  !insertmacro FileModeUnregisterExtension "html"
  !insertmacro FileModeUnregisterExtension "htm"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\${FILE_MODE_PROGID}"
  System::Call 'shell32::SHChangeNotify(i, i, i, i) v (0x08000000, 0, 0, 0)'
!macroend
