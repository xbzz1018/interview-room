@echo off
setlocal
cd /d "%~dp0"
if exist "%~dp0release\Interview Room-win32-x64\Interview Room.exe" (
  if defined INTERVIEW_DATA_DIR (
    start "" "%~dp0release\Interview Room-win32-x64\Interview Room.exe" "--data-dir=%INTERVIEW_DATA_DIR%" %*
  ) else (
    start "" "%~dp0release\Interview Room-win32-x64\Interview Room.exe" "--data-dir=%~dp0data" %*
  )
  exit /b 0
)
where node.exe >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 24.15 or newer, or use a built desktop package.
  if not "%INTERVIEW_NO_PAUSE%"=="1" pause
  exit /b 1
)
chcp 65001 >nul
node.exe scripts/launch-desktop.mjs %*
if errorlevel 1 (
  echo Desktop startup failed. Read the error above.
  if not "%INTERVIEW_NO_PAUSE%"=="1" pause
  exit /b 1
)
endlocal
