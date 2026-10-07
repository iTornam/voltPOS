; VoltPOS Windows Installer Customization
; Adds custom install page and uninstaller info

!macro customInstall
  ; Create data directory
  CreateDirectory "$APPDATA\VoltPOS\data"
  
  ; Write uninstall registry info
  WriteRegStr HKCU "Software\VoltPOS" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\VoltPOS" "DataDir" "$APPDATA\VoltPOS\data"
  WriteRegStr HKCU "Software\VoltPOS" "Version" "3.0.0"
!macroend

!macro customUnInstall
  ; Remove registry entries
  DeleteRegKey HKCU "Software\VoltPOS"
  
  ; Ask about data
  MessageBox MB_YESNO "Do you want to keep your VoltPOS data (sales records, products, customers)?$\n$\nClick YES to keep your data.$\nClick NO to delete everything." IDYES keep_data
  RMDir /r "$APPDATA\VoltPOS\data"
  keep_data:
!macroend
