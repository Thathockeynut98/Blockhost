@echo off
setlocal
cd /d "%~dp0"
echo Starting or updating BlockHost...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-BlockHost.ps1" -VerifyConsole %*
if errorlevel 1 (
  echo.
  echo BlockHost startup failed. Check the error above.
)
echo.
pause
