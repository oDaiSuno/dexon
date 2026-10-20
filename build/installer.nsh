!define MUI_DIRECTORYPAGE_TEXT_TOP "Choose an empty folder or an existing Dexon folder. / 请选择空文件夹或已有的 Dexon 安装文件夹。"

!ifdef BUILD_UNINSTALLER
  !ifndef APP_64
    !error "APP_64 is required to build the Dexon file list"
  !endif
  !tempfile DEXON_LIST
  !system 'node "${PROJECT_DIR}/scripts/nsis-file-list.mjs" "${APP_64}" "${PROJECT_DIR}/build/nsis/legacy-file-list.txt" "${DEXON_LIST}"' = 0
  !include /CHARSET=UTF8 "${DEXON_LIST}"
  !delfile "${DEXON_LIST}"

  !macro dexonStage F
    ${If} $R9 == 0
    ${AndIf} ${FileExists} "$INSTDIR\${F}"
    ${AndIfNot} ${FileExists} "$INSTDIR\${F}\*.*"
      ${GetParent} "$PLUGINSDIR\old-install\${F}" $R8
      CreateDirectory $R8
      ClearErrors
      Rename "$INSTDIR\${F}" "$PLUGINSDIR\old-install\${F}"
      ${If} ${Errors}
      ${OrIf} ${FileExists} "$INSTDIR\${F}"
        StrCpy $R9 "$INSTDIR\${F}"
      ${EndIf}
    ${EndIf}
  !macroend

  !macro dexonDelete F
    Delete "$INSTDIR\${F}"
  !macroend

  !macro dexonRemoveDir D
    RMDir "$INSTDIR\${D}"
  !macroend
!else
  !macro dexonSwapLegacyUninstaller ROOT
    ReadRegStr $R1 ${ROOT} "${UNINSTALL_REGISTRY_KEY}" DisplayVersion
    ReadRegStr $R2 ${ROOT} "${UNINSTALL_REGISTRY_KEY}" UninstallString
    Push $R2
    Call GetInQuotes
    Pop $R2
    ${If} $R2 != ""
    ${AndIf} ${FileExists} "$R2"
      ${If} $R1 == "0.1.0"
      ${OrIf} $R1 == "0.1.1"
        ClearErrors
        CopyFiles /SILENT "$PLUGINSDIR\dexon-safe-uninstaller.exe" "$R2"
        ${If} ${Errors}
          StrCpy $R3 "$R2"
        ${EndIf}
      ${EndIf}
    ${EndIf}
  !macroend

  !macro dexonFailOldUninstall
    ${IfNot} ${Errors}
    ${AndIf} $R0 != 0
      MessageBox MB_OK|MB_ICONEXCLAMATION "$(uninstallFailed): $R0" /SD IDOK
      DetailPrint `Uninstall was not successful. Uninstaller error code: $R0.`
      SetErrorLevel 2
      Quit
    ${EndIf}
  !macroend

  !macro customUnInstallCheck
    !insertmacro dexonFailOldUninstall
  !macroend

  !macro customUnInstallCheckCurrentUser
    !insertmacro dexonFailOldUninstall
  !macroend
!endif

!macro customHeader
  !ifndef BUILD_UNINSTALLER
    Function dexonIsSafeDir
      Exch $R0
      Push $R1
      ${DirState} "$R0" $R1
      ${If} $R1 == 1
      ${AndIfNot} ${FileExists} "$R0\${APP_EXECUTABLE_FILENAME}"
        StrCpy $R0 0
      ${ElseIf} $R1 == 1
      ${AndIfNot} ${FileExists} "$R0\${UNINSTALL_FILENAME}"
        StrCpy $R0 0
      ${Else}
        StrCpy $R0 1
      ${EndIf}
      Pop $R1
      Exch $R0
    FunctionEnd

    Function .onVerifyInstDir
      Push $R6
      Push $R7
      ${StrContains} $R6 "${APP_FILENAME}" $INSTDIR
      StrCpy $R7 $INSTDIR
      ${If} $R6 == ""
        StrCpy $R7 "$INSTDIR\${APP_FILENAME}"
      ${EndIf}
      Push $R7
      Call dexonIsSafeDir
      Pop $R6
      ${If} $R6 != 1
        Pop $R7
        Pop $R6
        Abort
      ${EndIf}
      Pop $R7
      Pop $R6
    FunctionEnd
  !endif
!macroend

!macro customInit
  InitPluginsDir
  File "/oname=$PLUGINSDIR\dexon-safe-uninstaller.exe" "${UNINSTALLER_OUT_FILE}"
  dexonSwap:
  StrCpy $R3 ""
  !insertmacro dexonSwapLegacyUninstaller HKCU
  ${If} ${UAC_IsAdmin}
    !insertmacro dexonSwapLegacyUninstaller HKLM
  ${EndIf}
  ${If} $R3 != ""
    MessageBox MB_RETRYCANCEL|MB_ICONSTOP "Cannot replace $R3. Installation stopped to protect your files. / 无法替换旧版卸载程序，为保护你的文件，安装已停止。" /SD IDCANCEL IDRETRY dexonSwap
    SetErrorLevel 2
    Quit
  ${EndIf}
  ${If} ${Silent}
    Push $INSTDIR
    Call dexonIsSafeDir
    Pop $0
    ${If} $0 != 1
      SetErrorLevel 2
      Quit
    ${EndIf}
  ${EndIf}
!macroend

!macro customRemoveFiles
  ${If} ${isUpdated}
    InitPluginsDir
    CreateDirectory "$PLUGINSDIR\old-install"
    StrCpy $R9 0
    !insertmacro dexonFiles dexonStage
    ${If} $R9 != 0
      DetailPrint "File is busy, aborting: $R9"
      Push ""
      Call un.restoreFiles
      Pop $R0
      Abort `Can't move "$R9" out of the way.`
    ${EndIf}
  ${Else}
    !insertmacro dexonFiles dexonDelete
  ${EndIf}
  Delete "$INSTDIR\${UNINSTALL_FILENAME}"
  !ifdef UNINSTALLER_ICON
    Delete "$INSTDIR\uninstallerIcon.ico"
  !endif
  !insertmacro dexonDirs dexonRemoveDir
  SetOutPath $TEMP
  RMDir $INSTDIR
!macroend
