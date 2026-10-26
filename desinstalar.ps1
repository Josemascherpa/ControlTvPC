# Saca el inicio automático y el acceso directo, y cierra ControlTv. No borra esta carpeta.
Remove-Item (Join-Path ([Environment]::GetFolderPath('Startup')) 'ControlTv.lnk') -ErrorAction SilentlyContinue
Remove-Item (Join-Path ([Environment]::GetFolderPath('Desktop')) 'ControlTv.lnk') -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process | Where-Object {
    ($_.Name -eq 'node.exe' -and $_.ExecutablePath -like "$PSScriptRoot*") -or
    ($_.Name -eq 'msedge.exe' -and $_.CommandLine -like '*ControlTvPC*')
} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Write-Host 'ControlTv quedo desinstalado del inicio automatico.'
