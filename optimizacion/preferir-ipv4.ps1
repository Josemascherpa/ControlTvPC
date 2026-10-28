# Hace que Windows (y con él Edge) prefiera IPv4 cuando un sitio tiene las dos versiones, sin
# desactivar IPv6. Medido en esta red: por IPv4 las conexiones abren siempre en 20–100 ms; por IPv6 a
# veces tardan 1–7 s o se traban más de 15 s. Eso frenaba el arranque de los videos, los saltos de
# minuto y la carga de las imágenes del Cine (el servicio de la notebook ya usa IPv4 por su cuenta).
#
# Se corre UNA vez, como administrador (clic derecho → "Ejecutar con PowerShell" o desde una terminal
# de administrador). Para volver a como estaba: preferir-ipv4.ps1 -Deshacer
param([switch]$Deshacer)

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host 'Hay que correrlo como administrador.' -ForegroundColor Yellow
    exit 1
}

if ($Deshacer) {
    # Valor de fábrica de Windows para las direcciones IPv4 (precedencia 35).
    netsh interface ipv6 set prefixpolicy ::ffff:0:0/96 35 4 | Out-Null
    Write-Host 'Listo: Windows vuelve a preferir IPv6 (como venía de fábrica).'
} else {
    # Precedencia 60: más que IPv6 (::/0 tiene 40), así se elige IPv4 primero.
    netsh interface ipv6 set prefixpolicy ::ffff:0:0/96 60 4 | Out-Null
    Write-Host 'Listo: Windows ahora prefiere IPv4. Reiniciá la notebook (o al menos Edge) para que tome efecto.'
}
netsh interface ipv6 show prefixpolicies
