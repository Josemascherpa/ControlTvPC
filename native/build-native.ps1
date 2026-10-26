# Compila el ayudante nativo (input-host.cs) a input-host.exe con el compilador de C# que trae
# Windows (.NET Framework 4). Se corre una vez al instalar o al cambiar el cÃ³digo; no instala nada.
$ErrorActionPreference = 'Stop'
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
if (-not (Test-Path $csc)) { Write-Warning 'No se encontrÃ³ el compilador de C#: se usarÃ¡ input-host.ps1 (compila al arrancar).'; exit 0 }
$src = Join-Path $PSScriptRoot 'input-host.cs'
$out = Join-Path $PSScriptRoot 'input-host.exe'
& $csc /nologo /optimize+ /target:winexe /platform:anycpu "/out:$out" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll $src
if ($LASTEXITCODE -ne 0) { throw 'No se pudo compilar input-host.cs' }
Write-Host "Ayudante nativo compilado: $out"
