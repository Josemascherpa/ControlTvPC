<#
  Compila la app de la tele (APK) y deja el archivo en la raíz del repo.

  Uso:
    powershell -ExecutionPolicy Bypass -File android/compilar-apk.ps1
    powershell -ExecutionPolicy Bypass -File android/compilar-apk.ps1 -Debug
    npm run apk

  Hace todo lo necesario: compila el Cine (si hace falta), busca el JDK y el SDK de Android,
  compila con Gradle y copia el APK al lado del README.
#>
param(
    [switch]$Debug
)

$ErrorActionPreference = 'Stop'
$android = $PSScriptRoot
$root = Split-Path -Parent $android

function Paso($texto) { Write-Host "`n== $texto ==" -ForegroundColor Cyan }

# --- Node y el Cine ---
Paso 'Comprobando Node.js'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'No está Node.js. Instalalo desde https://nodejs.org (versión 20 o más nueva).'
}
Write-Host "node $(node --version)"

if (-not (Test-Path (Join-Path $root 'node_modules'))) {
    Paso 'Instalando dependencias (npm ci)'
    Push-Location $root
    try { & npm ci --no-audit --no-fund; if ($LASTEXITCODE -ne 0) { throw 'npm ci falló' } } finally { Pop-Location }
}

Paso 'Compilando el Cine'
Push-Location $root
try {
    & npm run build:typescript
    if ($LASTEXITCODE -ne 0) { throw 'La compilación del Cine falló' }
} finally { Pop-Location }

# --- JDK ---
Paso 'Buscando el JDK'
$candidatos = @()
if ($env:JAVA_HOME) { $candidatos += $env:JAVA_HOME }
$candidatos += 'D:\Android Studio\jbr'
$candidatos += 'C:\Program Files\Android\Android Studio\jbr'
$jdk = $candidatos | Where-Object { $_ -and (Test-Path (Join-Path $_ 'bin\java.exe')) } | Select-Object -First 1
if (-not $jdk -and (Get-Command java -ErrorAction SilentlyContinue)) {
    $jdk = Split-Path -Parent (Split-Path -Parent (Get-Command java).Source)
}
if (-not $jdk) {
    throw 'No encontré un JDK (17 o más nuevo). Instalá Android Studio o poné JAVA_HOME.'
}
$env:JAVA_HOME = $jdk
Write-Host "JDK: $jdk"

# --- SDK de Android ---
Paso 'Buscando el SDK de Android'
$sdk = $env:ANDROID_HOME
if (-not $sdk) { $sdk = $env:ANDROID_SDK_ROOT }
if (-not $sdk) {
    $porDefecto = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
    if (Test-Path $porDefecto) { $sdk = $porDefecto }
}
if (-not $sdk -or -not (Test-Path $sdk)) {
    throw 'No encontré el SDK de Android. Instalá Android Studio o poné ANDROID_HOME.'
}
$localProperties = Join-Path $android 'local.properties'
if (-not (Test-Path $localProperties)) {
    "sdk.dir=$($sdk.Replace([char]92, [char]47).Replace(':', '\:'))" | Set-Content -Path $localProperties -Encoding ASCII
}
Write-Host "SDK: $sdk"

# --- Gradle ---
$tarea = if ($Debug) { ':app:assembleDebug' } else { ':app:assembleRelease' }
Paso "Compilando el APK ($tarea)"
Push-Location $android
try {
    & (Join-Path $android 'gradlew.bat') $tarea --console=plain --no-daemon
    if ($LASTEXITCODE -ne 0) { throw 'Gradle falló' }
} finally { Pop-Location }

# --- Copiar el APK al lado del README ---
$variante = if ($Debug) { 'debug' } else { 'release' }
$origen = Join-Path $android "app\build\outputs\apk\$variante\app-$variante.apk"
if (-not (Test-Path $origen)) { throw "No encontré el APK en $origen" }

$gradle = Get-Content (Join-Path $android 'app\build.gradle.kts') -Raw
$version = if ($gradle -match 'versionName\s*=\s*"([^"]+)"') { $Matches[1] } else { '1.0' }
$nombre = if ($Debug) { "CineTV-$version-debug.apk" } else { "CineTV-$version.apk" }
$destino = Join-Path $root $nombre
Copy-Item $origen $destino -Force

$tamano = [math]::Round((Get-Item $destino).Length / 1MB, 1)
Write-Host "`nListo: $destino ($tamano MB)" -ForegroundColor Green
Write-Host 'Se instala en la tele con: adb install -r "' -NoNewline
Write-Host $destino -NoNewline
Write-Host '"'
