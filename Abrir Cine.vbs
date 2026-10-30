' Abre ControlTv PC y el Cine en la tele, desde el Explorador (fuera del sandbox del agente).
' 1) Si el servicio no está, lo arranca. 2) Si Edge no abrió con el puerto 9333, lo abre.
' 3) Le pide al servicio que se enganche y ponga la tele al frente.
Option Explicit

Dim fso, sh, baseDir, profile, exe, args, i, http

Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
baseDir = fso.GetParentFolderName(WScript.ScriptFullName)

Function HttpUp(url)
  Dim req
  HttpUp = False
  On Error Resume Next
  Set req = CreateObject("MSXML2.XMLHTTP")
  req.Open "GET", url, False
  req.Send
  If Err.Number = 0 Then
    If req.Status = 200 Then HttpUp = True
  End If
  Err.Clear
  On Error GoTo 0
End Function

' 1) Servicio
If Not HttpUp("http://127.0.0.1:8001/api/v2/") Then
  sh.Run """" & baseDir & "\runtime\node\node.exe"" """ & baseDir & "\dist\src\main.js""", 0, False
  For i = 1 To 40
    WScript.Sleep 500
    If HttpUp("http://127.0.0.1:8001/api/v2/") Then Exit For
  Next
End If

' 2) Edge: si el servicio ya lo abrió con depuración, no se abre otro.
If Not HttpUp("http://127.0.0.1:9333/json/version") Then
  profile = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\ControlTvPC\edge-perfil-cine"
  exe = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
  If Not fso.FileExists(exe) Then exe = "C:\Program Files\Microsoft\Edge\Application\msedge.exe"
  args = "--remote-debugging-port=9333 --user-data-dir=""" & profile & """ --app=http://127.0.0.1:8001/ --start-fullscreen --no-first-run --no-default-browser-check --hide-crash-restore-bubble --disable-session-crashed-bubble --autoplay-policy=no-user-gesture-required --overscroll-history-navigation=0 --disable-renderer-backgrounding --ignore-gpu-blocklist --enable-gpu-rasterization --enable-zero-copy --disable-features=msEdgeSidebarV2,msHubApps,msUndersideButton,msEdgeShoppingUI"
  sh.Run """" & exe & """ " & args, 0, False
End If

' 3) Esperar a que Edge conteste por 9333 y enganchar el control (cursor, teclas, volumen)
For i = 1 To 30
  If HttpUp("http://127.0.0.1:9333/json/version") Then Exit For
  WScript.Sleep 500
Next
On Error Resume Next
Set http = CreateObject("MSXML2.XMLHTTP")
http.Open "POST", "http://127.0.0.1:8001/api/show", False
http.Send
