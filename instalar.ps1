# Instala ControlTv PC en esta notebook:
#   1. Baja Node.js portátil (queda adentro de esta carpeta, no se instala en Windows).
#   2. Instala las librerías.
#   3. Crea el acceso directo del escritorio y hace que arranque solo al prender la notebook.
# Uso: clic derecho > "Ejecutar con PowerShell", o:  powershell -ExecutionPolicy Bypass -File instalar.ps1

$ErrorActionPreference = 'Stop'
$dir = $PSScriptRoot
$nodeVersion = 'v22.12.0'
$node = Join-Path $dir 'runtime\node\node.exe'

if (-not (Test-Path $node)) {
    Write-Host 'Bajando Node.js...'
    $zip = Join-Path $env:TEMP "node-$nodeVersion.zip"
    Invoke-WebRequest "https://nodejs.org/dist/$nodeVersion/node-$nodeVersion-win-x64.zip" -OutFile $zip
    Expand-Archive $zip (Join-Path $dir 'runtime') -Force
    Rename-Item (Join-Path $dir "runtime\node-$nodeVersion-win-x64") 'node'
    Remove-Item $zip
}

Write-Host 'Instalando librerias...'
Push-Location $dir
& (Join-Path $dir 'runtime\node\npm.cmd') install --no-audit --no-fund
Write-Host 'Compilando (TypeScript)...'
& (Join-Path $dir 'runtime\node\npm.cmd') run build
Pop-Location

$shell = New-Object -ComObject WScript.Shell
function New-Shortcut($path) {
    $s = $shell.CreateShortcut($path)
    $s.TargetPath = "$env:WINDIR\System32\wscript.exe"
    $s.Arguments = "`"$(Join-Path $dir 'ControlTv.vbs')`""
    $s.WorkingDirectory = $dir
    $s.IconLocation = (Join-Path $dir 'assets\icon.ico')
    $s.Description = 'ControlTv: la tele manejada desde el celular'
    $s.Save()
}
New-Shortcut (Join-Path ([Environment]::GetFolderPath('Startup')) 'ControlTv.lnk')
New-Shortcut (Join-Path ([Environment]::GetFolderPath('Desktop')) 'ControlTv.lnk')

Write-Host ''
Write-Host 'Listo. ControlTv se abre solo al prender la notebook.'
Write-Host 'Si Windows pregunta por el Firewall, elegi "Permitir acceso" (tilda tambien redes publicas).'
