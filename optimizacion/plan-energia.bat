@echo off
rem Ejecuta plan-energia.ps1 como administrador (Windows pide permiso). Pasa los parámetros, ej. -Quitar.
powershell -NoProfile -Command "Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile -ExecutionPolicy Bypass -NoExit -File \"%~dp0plan-energia.ps1\" %*'"
