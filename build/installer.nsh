!macro customHeader
  !ifndef BUILD_UNINSTALLER
    Var Option_DesktopShortcut
    Var Option_AutoStartOnBoot
    Var Checkbox_DesktopShortcut_HWND
    Var Checkbox_AutoStart_HWND

    Function optionsPageCreate
      !insertmacro MUI_HEADER_TEXT "安裝選項" "選擇捷徑與開機自動啟動設定"
      
      nsDialogs::Create 1018
      Pop $0
      ${If} $0 == error
        Abort
      ${EndIf}

      ${NSD_CreateLabel} 0 0 100% 24u "請選擇安裝程式在安裝 NVIDIA NIM Gateway 時要執行的附加設定："
      Pop $0

      ${NSD_CreateCheckbox} 10u 28u 90% 14u "建立桌面捷徑 (&D)"
      Pop $Checkbox_DesktopShortcut_HWND
      ${If} $Option_DesktopShortcut == "1"
        ${NSD_Check} $Checkbox_DesktopShortcut_HWND
      ${Else}
        ${NSD_Uncheck} $Checkbox_DesktopShortcut_HWND
      ${EndIf}

      ${NSD_CreateCheckbox} 10u 48u 90% 14u "開機時自動啟動 (背景常駐系統匣) (&S)"
      Pop $Checkbox_AutoStart_HWND
      ${If} $Option_AutoStartOnBoot == "1"
        ${NSD_Check} $Checkbox_AutoStart_HWND
      ${Else}
        ${NSD_Uncheck} $Checkbox_AutoStart_HWND
      ${EndIf}

      nsDialogs::Show
    FunctionEnd

    Function optionsPageLeave
      ${NSD_GetState} $Checkbox_DesktopShortcut_HWND $0
      ${If} $0 == ${BST_CHECKED}
        StrCpy $Option_DesktopShortcut "1"
      ${Else}
        StrCpy $Option_DesktopShortcut "0"
      ${EndIf}

      ${NSD_GetState} $Checkbox_AutoStart_HWND $0
      ${If} $0 == ${BST_CHECKED}
        StrCpy $Option_AutoStartOnBoot "1"
      ${Else}
        StrCpy $Option_AutoStartOnBoot "0"
      ${EndIf}
    FunctionEnd
  !endif
!macroend

!macro customInit
  # 預設勾選桌面捷徑與開機自啟動
  StrCpy $Option_DesktopShortcut "1"
  StrCpy $Option_AutoStartOnBoot "1"

  # 安裝前自動關閉目前正在運行的應用程式，避免檔案鎖定造成安裝錯誤
  nsProcess::_KillProcess /NOUNLOAD "${APP_EXECUTABLE_FILENAME}"
  Pop $0
  nsProcess::_KillProcess /NOUNLOAD "NvidiaGateway.exe"
  Pop $0
  nsProcess::_KillProcess /NOUNLOAD "nvidia-gateway-app.exe"
  Pop $0
  nsProcess::_Unload

  ExecWait 'taskkill /F /IM "${APP_EXECUTABLE_FILENAME}" /T'
  ExecWait 'taskkill /F /IM NvidiaGateway.exe /T'
  ExecWait 'taskkill /F /IM nvidia-gateway-app.exe /T'
  Sleep 500
!macroend

!macro customUnInit
  # 反安裝前自動關閉目前正在運行的應用程式
  nsProcess::_KillProcess /NOUNLOAD "${APP_EXECUTABLE_FILENAME}"
  Pop $0
  nsProcess::_KillProcess /NOUNLOAD "NvidiaGateway.exe"
  Pop $0
  nsProcess::_KillProcess /NOUNLOAD "nvidia-gateway-app.exe"
  Pop $0
  nsProcess::_Unload

  ExecWait 'taskkill /F /IM "${APP_EXECUTABLE_FILENAME}" /T'
  ExecWait 'taskkill /F /IM NvidiaGateway.exe /T'
  ExecWait 'taskkill /F /IM nvidia-gateway-app.exe /T'
  Sleep 500
!macroend

!ifndef BUILD_UNINSTALLER
  !macro customPageAfterChangeDir
    Page custom optionsPageCreate optionsPageLeave
  !macroend
!endif

!macro customInstall
  # 處理桌面捷徑設定
  ${If} $Option_DesktopShortcut == "1"
    CreateShortCut "$DESKTOP\${SHORTCUT_NAME}.lnk" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
    ClearErrors
    WinShell::SetLnkAUMI "$DESKTOP\${SHORTCUT_NAME}.lnk" "${APP_ID}"
  ${Else}
    Delete "$DESKTOP\${SHORTCUT_NAME}.lnk"
    Delete "$DESKTOP\${PRODUCT_FILENAME}.lnk"
    Delete "$DESKTOP\NVIDIA NIM Gateway.lnk"
  ${EndIf}
  System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'

  # 處理開機自動啟動 (登入註冊表) 設定
  ${If} $Option_AutoStartOnBoot == "1"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${APP_ID}" '"$appExe" --hidden'
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCT_FILENAME}" '"$appExe" --hidden'
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "nvidia-gateway-app" '"$appExe" --hidden'
  ${Else}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${APP_ID}"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCT_FILENAME}"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "nvidia-gateway-app"
  ${EndIf}
!macroend

!macro customUnInstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${APP_ID}"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCT_FILENAME}"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "nvidia-gateway-app"
  Delete "$DESKTOP\${SHORTCUT_NAME}.lnk"
  Delete "$DESKTOP\${PRODUCT_FILENAME}.lnk"
  Delete "$DESKTOP\NVIDIA NIM Gateway.lnk"
!macroend
