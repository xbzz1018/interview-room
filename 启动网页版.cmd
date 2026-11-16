@echo off
setlocal
cd /d "%~dp0"
where node.exe >nul 2>nul
if errorlevel 1 (
  echo Node.js 24.15 or newer is required. Please install it and try again.
  if not "%INTERVIEW_NO_PAUSE%"=="1" pause
  exit /b 1
)
chcp 65001 >nul
node.exe scripts/launch.mjs
if errorlevel 1 (
  echo Startup failed. Read the error above. Try: npm run launch
  if not "%INTERVIEW_NO_PAUSE%"=="1" pause
  exit /b 1
)
endlocal
