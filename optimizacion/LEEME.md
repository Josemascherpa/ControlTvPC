# Optimizar la notebook para ControlTv

Dos pasos, en este orden. Los dos cambian configuraciones de Windows, por eso los corrés vos
(piden permiso de administrador).

## 1. Limpiar y optimizar Windows con winutil

[ChrisTitusTech/winutil](https://github.com/ChrisTitusTech/winutil) es el optimizador más usado
(~65.000 estrellas en GitHub, se actualiza todas las semanas). Tiene ventanas, presets probados,
crea un punto de restauración antes de tocar nada y permite deshacer.

1. Clic derecho en el botón Inicio → **Windows PowerShell (Administrador)**.
2. Pegá esto y apretá Enter:
   ```
   irm https://christitus.com/win | iex
   ```
3. Andá a la pestaña **Tweaks** y tocá el preset **Standard**. Tilda 12 cosas, todas seguras:
   crear punto de restauración; desactivar telemetría, historial de actividad, rastreo de ubicación,
   "consumer features" (apps que Windows instala solo), Delivery Optimization, WPBT y el descubrimiento
   automático de carpetas del Explorador; pasar servicios a "Manual" (arrancan sólo si hacen falta);
   borrar temporales, limpiar el disco y sumar "Finalizar tarea" al clic derecho de la barra.
4. Opcional y recomendado para la tele (sección *Advanced Tweaks*):
   - **Visual Effects - Set to Best Performance**: saca animaciones de Windows que no se ven.
   - **Background Apps - Disable**: apps de la tienda que corren escondidas.
5. Tocá **Run Tweaks** y esperá a que termine. Reiniciá la notebook.

### ⚠️ NO tildes esto (rompe ControlTv)

| Opción de winutil | Por qué no |
|---|---|
| **Microsoft Edge - Remove** | ControlTv usa Edge: sin Edge no hay tele. |
| **Microsoft Edge - Debloat** | Cambia políticas de Edge que pueden bloquear lo que usa la tele. |
| **Ultimate Performance Profile** | Es para PCs de escritorio (dice "NOT FOR LAPTOPS"); usamos el plan del paso 2. |
| Cualquier cosa de **Windows Defender** o **Updates** | Dejá el antivirus y las actualizaciones de seguridad como están. |

Si algo no te gusta: en winutil, cada tweak tiene "Undo"; o restaurá el punto de restauración.

## 2. Planes de energía: máximo en uso, ahorro sin uso (automático)

ControlTv cambia solo el plan de energía:

- **Se está usando** (llega algo del celular, alguien toca teclado o mouse, o **hay un video o música
  reproduciéndose**) → plan de **máximo** rendimiento.
- **Pasan 10 minutos sin uso**, o se apaga la imagen → plan de **ahorro**.
- **Apenas se vuelve a usar** → máximo otra vez, al instante.

Planes que usa (el primero que exista de cada par):

| Modo | 1° opción | 2° opción (ya estaban en la notebook) |
|---|---|---|
| Máximo | "ControlTv Máximo" | "MAXIMO rendimiento" |
| Ahorro | "ControlTv Ahorro" | "SERVIDOR bajo consumo" |

Hoy ya funciona con tus planes "MAXIMO rendimiento" / "SERVIDOR bajo consumo". Si querés planes
afinados para la tele, doble clic en **`plan-energia.bat`** (pide permiso de administrador). Crea:

| | ControlTv Máximo | ControlTv Ahorro |
|---|---|---|
| Procesador | siempre al tope, turbo agresivo | mínimo 5%, tope 50%, sin turbo |
| Placa de video Intel | rendimiento máximo | máximo ahorro |
| WiFi | sin ahorro (menos demora del mouse del celular) | ahorro bajo (sigue escuchando al celular) |
| Suspender / hibernar enchufada | nunca | nunca |
| Cerrar la tapa enchufada | no hace nada | no hace nada |

No toca tus planes. Para borrar los de ControlTv: `plan-energia.bat -Quitar`.

Ajustes, en `%LOCALAPPDATA%\ControlTvPC\config.json`:

- `"idleMinutes": 10`: minutos sin uso hasta pasar a ahorro.
- `"autoPowerPlans": false`: apaga el cambio automático.

## Mínimo del procesador en tu plan "MAXIMO rendimiento" (recomendado)

Tu plan "MAXIMO rendimiento" tiene el procesador **siempre al 100 %**. En una notebook de 2014 eso
la mantiene caliente todo el tiempo; si se recalienta, Windows le baja la velocidad sola y anda
**peor**. Con el mínimo en 10 % el turbo sigue subiendo al instante cuando hace falta (el tope y el
turbo agresivo quedan igual). Para hacerlo, en una terminal:

```bat
powercfg /setacvalueindex 1a1a1a1a-0000-4000-8000-00000000aa01 SUB_PROCESSOR PROCTHROTTLEMIN 10
powercfg /setactive 1a1a1a1a-0000-4000-8000-00000000aa01
```

Para volver a como estaba: el mismo comando con `100` en lugar de `10`.
