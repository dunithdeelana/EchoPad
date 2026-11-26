; Echopad installer — compiled by scripts/build-installer.mjs
; Required defines (passed with /D): VERSION, SOURCE_DIR, OUT_FILE, ROOT

Unicode true
ManifestDPIAware true
SetCompressor /SOLID lzma
SetCompressorDictSize 64

!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "LogicLib.nsh"

!define APP_NAME      "Echopad"
!define APP_EXE       "Echopad.exe"
!define PUBLISHER     "Echopad"
!define APP_ID        "com.echopad.app"
!define UNINST_EXE    "Uninstall Echopad.exe"
!define UNINST_KEY    "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}"
!define RUN_KEY       "Software\Microsoft\Windows\CurrentVersion\Run"

Name "${APP_NAME}"
OutFile "${OUT_FILE}"
InstallDir "$LOCALAPPDATA\Programs\${APP_NAME}"
InstallDirRegKey HKCU "${UNINST_KEY}" "InstallLocation"
RequestExecutionLevel user
BrandingText "${APP_NAME} ${VERSION}"
ShowInstDetails nevershow
ShowUninstDetails nevershow

VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName"     "${APP_NAME}"
VIAddVersionKey "CompanyName"     "${PUBLISHER}"
VIAddVersionKey "FileDescription" "${APP_NAME} Setup"
VIAddVersionKey "FileVersion"     "${VERSION}"
VIAddVersionKey "ProductVersion"  "${VERSION}"
VIAddVersionKey "LegalCopyright"  "Copyright (c) 2026 ${PUBLISHER}"

; ---------------------------------------------------------------- UI
!define MUI_ICON   "${ROOT}\build\icon.ico"
!define MUI_UNICON "${ROOT}\build\icon.ico"
!define MUI_WELCOMEFINISHPAGE_BITMAP   "${ROOT}\installer\sidebar.bmp"
!define MUI_UNWELCOMEFINISHPAGE_BITMAP "${ROOT}\installer\sidebar.bmp"
!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_RIGHT
!define MUI_HEADERIMAGE_BITMAP   "${ROOT}\installer\header.bmp"
!define MUI_HEADERIMAGE_UNBITMAP "${ROOT}\installer\header.bmp"
!define MUI_ABORTWARNING

!define MUI_WELCOMEPAGE_TITLE "Welcome to ${APP_NAME}"
!define MUI_WELCOMEPAGE_TEXT "This will install ${APP_NAME} ${VERSION} on your computer.$\r$\n$\r$\n${APP_NAME} is a soundboard that plays your sounds straight into Discord and other voice chat apps using global keyboard shortcuts.$\r$\n$\r$\nNo administrator rights are needed. Click Next to continue."

!define MUI_FINISHPAGE_TITLE "${APP_NAME} is ready"
!define MUI_FINISHPAGE_TEXT "${APP_NAME} has been installed.$\r$\n$\r$\nTo play sounds into Discord you also need the free VB-CABLE virtual audio driver. ${APP_NAME} will walk you through it on first launch."
!define MUI_FINISHPAGE_RUN "$INSTDIR\${APP_EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "Launch ${APP_NAME}"
!define MUI_FINISHPAGE_SHOWREADME ""
!define MUI_FINISHPAGE_SHOWREADME_TEXT "Create a desktop shortcut"
!define MUI_FINISHPAGE_SHOWREADME_FUNCTION CreateDesktopShortcut
!define MUI_FINISHPAGE_LINK "Download VB-CABLE (vb-audio.com)"
!define MUI_FINISHPAGE_LINK_LOCATION "https://vb-audio.com/Cable/"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "${ROOT}\LICENSE.txt"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

; ---------------------------------------------------------------- helpers
!macro CloseRunningApp
  ; Ask nicely first, then make sure it's gone so files can be replaced.
  nsExec::Exec 'taskkill /IM "${APP_EXE}"'
  Pop $0
  Sleep 800
  nsExec::Exec 'taskkill /F /T /IM "${APP_EXE}"'
  Pop $0
  Sleep 300
!macroend

Function CreateDesktopShortcut
  CreateShortcut "$DESKTOP\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\${APP_EXE}" 0
FunctionEnd

; ---------------------------------------------------------------- install
Section "Install" SecMain
  SetShellVarContext current
  !insertmacro CloseRunningApp

  SetOutPath "$INSTDIR"
  ; Remove files from a previous version (only the app's own files).
  !include "${ROOT}\installer\uninstall-files.nsh"

  File /r "${SOURCE_DIR}\*.*"

  WriteUninstaller "$INSTDIR\${UNINST_EXE}"

  CreateShortcut "$SMPROGRAMS\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\${APP_EXE}" 0

  WriteRegStr   HKCU "${UNINST_KEY}" "DisplayName"          "${APP_NAME}"
  WriteRegStr   HKCU "${UNINST_KEY}" "DisplayVersion"       "${VERSION}"
  WriteRegStr   HKCU "${UNINST_KEY}" "Publisher"            "${PUBLISHER}"
  WriteRegStr   HKCU "${UNINST_KEY}" "DisplayIcon"          "$INSTDIR\${APP_EXE},0"
  WriteRegStr   HKCU "${UNINST_KEY}" "InstallLocation"      "$INSTDIR"
  WriteRegStr   HKCU "${UNINST_KEY}" "UninstallString"      '"$INSTDIR\${UNINST_EXE}"'
  WriteRegStr   HKCU "${UNINST_KEY}" "QuietUninstallString" '"$INSTDIR\${UNINST_EXE}" /S'
  WriteRegStr   HKCU "${UNINST_KEY}" "URLInfoAbout"         "https://vb-audio.com/Cable/"
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKCU "${UNINST_KEY}" "EstimatedSize" "$0"
SectionEnd

; ---------------------------------------------------------------- uninstall
Section "Uninstall"
  SetShellVarContext current
  ; Give the user's real microphone back to Windows before removing Echopad.
  IfFileExists "$INSTDIR\${APP_EXE}" 0 +3
    ExecWait '"$INSTDIR\${APP_EXE}" --restore-audio'
    Sleep 2500
  !insertmacro CloseRunningApp

  Delete "$SMPROGRAMS\${APP_NAME}.lnk"
  Delete "$DESKTOP\${APP_NAME}.lnk"

  !include "${ROOT}\installer\uninstall-files.nsh"
  Delete "$INSTDIR\${UNINST_EXE}"
  RMDir "$INSTDIR"

  DeleteRegKey HKCU "${UNINST_KEY}"
  DeleteRegValue HKCU "${RUN_KEY}" "${APP_ID}"
  DeleteRegValue HKCU "${RUN_KEY}" "${APP_NAME}"

  IfSilent done
  MessageBox MB_YESNO|MB_ICONQUESTION "Do you also want to delete your sound library and settings?$\r$\n$\r$\n($APPDATA\${APP_NAME})" /SD IDNO IDNO done
    RMDir /r "$APPDATA\${APP_NAME}"
  done:
SectionEnd
