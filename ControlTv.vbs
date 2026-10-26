' Abre ControlTv PC sin mostrar ninguna ventana negra de consola.
' Lo usan el acceso directo del escritorio y el inicio automático de Windows.
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = dir
sh.Run """" & dir & "\runtime\node\node.exe"" """ & dir & "\dist\main.js""", 0, False
