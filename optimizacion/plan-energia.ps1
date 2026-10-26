#Requires -RunAsAdministrator
<#
  Planes de energía para ControlTv. Crea DOS planes, y la app ControlTv cambia sola entre ellos:

    "ControlTv Máximo"  mientras la notebook se usa: procesador siempre al tope, turbo agresivo,
                        placa de video y WiFi sin ahorro (menos demora del mouse del celular).
    "ControlTv Ahorro"  cuando queda sin uso un rato (o con la imagen apagada): procesador limitado
                        y sin turbo, placa de video y WiFi ahorrando. Casi no consume ni calienta.

  En los dos: enchufada nunca se suspende ni hiberna (la tele siempre lista) y cerrar la tapa no hace
  nada. Con batería quedan valores ahorradores normales.

  No toca tu plan "MAXIMO rendimiento" ni ningún otro.

  Uso:            doble clic en plan-energia.bat   (pide permiso de administrador)
  Volver atrás:   plan-energia.bat -Quitar         (activa "Equilibrado" y borra los dos planes)
#>
param([switch]$Quitar)

# powercfg es un programa externo: sus errores se ven en $LASTEXITCODE, no como excepciones.
$ErrorActionPreference = 'Continue'

# GUIDs fijos: la app ControlTv los busca por estos números.
$MaxPlan = 'c07c7c07-a11a-4b0b-9c0c-0000c7a7e001'
$SavePlan = 'c07c7c07-a11a-4b0b-9c0c-0000c7a7e002'

function Test-Plan([string]$Guid) { return (powercfg /list | Out-String) -match $Guid }

function Remove-Plan([string]$Guid) {
    if (Test-Plan $Guid) { powercfg /delete $Guid | Out-Null }
}

if ($Quitar) {
    powercfg /setactive SCHEME_BALANCED
    Remove-Plan $MaxPlan
    Remove-Plan $SavePlan
    Write-Host 'Listo: se activó "Equilibrado" y se borraron los planes de ControlTv.'
    return
}

function Set-PowerValue([string]$Plan, [string]$Sub, [string]$Setting, [int]$Ac, [int]$Dc, [string]$What) {
    powercfg /setacvalueindex $Plan $Sub $Setting $Ac 2>$null | Out-Null
    $okAc = $LASTEXITCODE -eq 0
    powercfg /setdcvalueindex $Plan $Sub $Setting $Dc 2>$null | Out-Null
    if ($okAc -and $LASTEXITCODE -eq 0) { Write-Host ("    OK  {0}" -f $What) }
    else { Write-Host ("    --  {0} (esta notebook no lo tiene)" -f $What) -ForegroundColor DarkGray }
}

# Crea (o rehace desde cero) un plan copiando "Equilibrado".
function New-Plan([string]$Guid, [string]$Name, [string]$Description) {
    powercfg /setactive SCHEME_BALANCED
    Remove-Plan $Guid
    powercfg /duplicatescheme SCHEME_BALANCED $Guid | Out-Null
    powercfg /changename $Guid $Name $Description
    Write-Host ''
    Write-Host $Name -ForegroundColor Cyan
}

# Lo que comparten los dos planes: siempre lista, nunca se duerme enchufada.
function Set-AlwaysOn([string]$Plan) {
    Set-PowerValue $Plan SUB_SLEEP   STANDBYIDLE      0 1800 'Enchufada nunca se suspende'
    Set-PowerValue $Plan SUB_SLEEP   HIBERNATEIDLE    0 7200 'Enchufada nunca hiberna'
    Set-PowerValue $Plan SUB_BUTTONS LIDACTION        0    1 'Cerrar la tapa enchufada: no hace nada'
    Set-PowerValue $Plan SUB_VIDEO   VIDEOIDLE     1800  600 'Imagen: ControlTv la mantiene prendida mientras se usa'
    Set-PowerValue $Plan SUB_PROCESSOR SYSCOOLPOL     1    0 'Refrigeración activa'
}

$GRAPHICS = '44f3beca-a7c0-460e-9df2-bb8b99e0cba6', '3619c3f2-afb2-4afc-b0e9-e7fef372de36'
$WIFI = '19cbb8fa-5279-450e-9fac-8a3d5fedd0c1', '12bbebe6-58d6-4636-95bb-3217ef867c1a'
$PCIE = '501a4d13-42af-4429-9fd1-a8218c268e20', 'ee12f906-d277-404b-b6da-e5fa1a576df5'

# ---------- Máximo: mientras se usa ----------
New-Plan $MaxPlan 'ControlTv Máximo' 'Todo al máximo mientras se usa la tele (ControlTv)'
Set-PowerValue $MaxPlan SUB_PROCESSOR PROCTHROTTLEMIN 100   5 'Procesador siempre al tope enchufada'
Set-PowerValue $MaxPlan SUB_PROCESSOR PROCTHROTTLEMAX 100 100 'Máximo 100%'
Set-PowerValue $MaxPlan SUB_PROCESSOR PERFBOOSTMODE     2   1 'Turbo agresivo'
Set-PowerValue $MaxPlan $GRAPHICS[0] $GRAPHICS[1]       2   1 'Gráficos Intel: rendimiento máximo'
Set-PowerValue $MaxPlan $WIFI[0] $WIFI[1]               0   1 'WiFi sin ahorro (menos demora del celular)'
Set-PowerValue $MaxPlan $PCIE[0] $PCIE[1]               0   2 'PCIe sin ahorro'
Set-PowerValue $MaxPlan SUB_DISK DISKIDLE               0  600 'Disco nunca se apaga enchufada'
Set-AlwaysOn $MaxPlan

# ---------- Ahorro: sin uso ----------
New-Plan $SavePlan 'ControlTv Ahorro' 'Mínimo consumo cuando la tele no se usa (ControlTv)'
Set-PowerValue $SavePlan SUB_PROCESSOR PROCTHROTTLEMIN   5   5 'Procesador baja al mínimo (5%)'
Set-PowerValue $SavePlan SUB_PROCESSOR PROCTHROTTLEMAX  50  50 'Tope 50% (no calienta)'
Set-PowerValue $SavePlan SUB_PROCESSOR PERFBOOSTMODE     0   0 'Sin turbo'
Set-PowerValue $SavePlan $GRAPHICS[0] $GRAPHICS[1]       0   0 'Gráficos Intel: máximo ahorro'
Set-PowerValue $SavePlan $WIFI[0] $WIFI[1]               1   2 'WiFi con ahorro bajo (sigue escuchando al celular)'
Set-PowerValue $SavePlan $PCIE[0] $PCIE[1]               2   2 'PCIe con ahorro'
Set-PowerValue $SavePlan SUB_DISK DISKIDLE             300  300 'Disco se apaga a los 5 min'
Set-AlwaysOn $SavePlan

powercfg /setactive $MaxPlan
Write-Host ''
Write-Host 'Listo: planes creados y "ControlTv Máximo" activo. ControlTv cambia solo entre los dos.' -ForegroundColor Green
