; PuppyOne Desktop NSIS installer template (per-user install, no UAC required
; for silent OTA updates). Concrete release parameters are prepended as !define
; statements by tools/release/targets/windows.py:
;   PRODUCT_NAME, PRODUCT_ID, PRODUCT_VERSION, URL_SCHEME,
;   EXECUTABLE_NAME, STAGE_DIR, OUT_FILE

!include "MUI2.nsh"

Unicode True
Name "${PRODUCT_NAME} ${PRODUCT_VERSION}"
OutFile "${OUT_FILE}"
InstallDir "$LOCALAPPDATA\Programs\${PRODUCT_NAME}"
InstallDirRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_ID}" "InstallLocation"
RequestExecutionLevel user
SetCompressor /SOLID lzma

!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Section "Install"
  SetOutPath "$INSTDIR"
  File /r "${STAGE_DIR}\*.*"

  ; Create uninstaller
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  ; Start Menu & Desktop shortcuts
  CreateDirectory "$SMPROGRAMS\${PRODUCT_NAME}"
  CreateShortcut "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk" "$INSTDIR\${EXECUTABLE_NAME}"
  CreateShortcut "$DESKTOP\${PRODUCT_NAME}.lnk" "$INSTDIR\${EXECUTABLE_NAME}"

  ; Per-user URL protocol registration (HKCU\Software\Classes\<scheme>)
  WriteRegStr HKCU "Software\Classes\${URL_SCHEME}" "" "URL:${PRODUCT_NAME} Protocol"
  WriteRegStr HKCU "Software\Classes\${URL_SCHEME}" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\${URL_SCHEME}\DefaultIcon" "" "$INSTDIR\${EXECUTABLE_NAME},0"
  WriteRegStr HKCU "Software\Classes\${URL_SCHEME}\shell\open\command" "" '"$INSTDIR\${EXECUTABLE_NAME}" "%1"'

  ; Per-user OpenWithProgids document associations (non-intrusive)
  WriteRegStr HKCU "Software\Classes\${PRODUCT_ID}.Document" "" "${PRODUCT_NAME} Document"
  WriteRegStr HKCU "Software\Classes\${PRODUCT_ID}.Document\DefaultIcon" "" "$INSTDIR\${EXECUTABLE_NAME},0"
  WriteRegStr HKCU "Software\Classes\${PRODUCT_ID}.Document\shell\open\command" "" '"$INSTDIR\${EXECUTABLE_NAME}" "%1"'
  WriteRegStr HKCU "Software\Classes\.md\OpenWithProgids" "${PRODUCT_ID}.Document" ""
  WriteRegStr HKCU "Software\Classes\.markdown\OpenWithProgids" "${PRODUCT_ID}.Document" ""
  WriteRegStr HKCU "Software\Classes\.csv\OpenWithProgids" "${PRODUCT_ID}.Document" ""
  WriteRegStr HKCU "Software\Classes\.html\OpenWithProgids" "${PRODUCT_ID}.Document" ""
  WriteRegStr HKCU "Software\Classes\.htm\OpenWithProgids" "${PRODUCT_ID}.Document" ""

  ; Add/Remove Programs metadata
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_ID}" "DisplayName" "${PRODUCT_NAME}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_ID}" "DisplayVersion" "${PRODUCT_VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_ID}" "Publisher" "PuppyOne"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_ID}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_ID}" "DisplayIcon" "$INSTDIR\${EXECUTABLE_NAME},0"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_ID}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_ID}" "QuietUninstallString" '"$INSTDIR\Uninstall.exe" /S'
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_ID}" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_ID}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  Delete "$DESKTOP\${PRODUCT_NAME}.lnk"
  Delete "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk"
  RMDir "$SMPROGRAMS\${PRODUCT_NAME}"

  DeleteRegKey HKCU "Software\Classes\${URL_SCHEME}"
  DeleteRegKey HKCU "Software\Classes\${PRODUCT_ID}.Document"
  DeleteRegValue HKCU "Software\Classes\.md\OpenWithProgids" "${PRODUCT_ID}.Document"
  DeleteRegValue HKCU "Software\Classes\.markdown\OpenWithProgids" "${PRODUCT_ID}.Document"
  DeleteRegValue HKCU "Software\Classes\.csv\OpenWithProgids" "${PRODUCT_ID}.Document"
  DeleteRegValue HKCU "Software\Classes\.html\OpenWithProgids" "${PRODUCT_ID}.Document"
  DeleteRegValue HKCU "Software\Classes\.htm\OpenWithProgids" "${PRODUCT_ID}.Document"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_ID}"

  RMDir /r "$INSTDIR"
SectionEnd
