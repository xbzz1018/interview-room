@echo off
rem Current personal build: dist\desktop-interview-room\win-unpacked
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-personal.ps1"
if errorlevel 1 pause
