# Respaldo del ayudante nativo: compila input-host.cs al vuelo y lo corre. Lo normal es usar
# input-host.exe (compilado una sola vez por build-native.ps1): arranca al instante y no depende de
# PowerShell. Ver input-host.cs para las Ã³rdenes que entiende.
Add-Type -ReferencedAssemblies System.Windows.Forms, System.Drawing -Path (Join-Path $PSScriptRoot 'input-host.cs')
[InputHost]::Run()
