@echo off
setlocal
cd /d "%~dp0.."

if not exist node_modules (
  echo Dependencies not installed. Running npm install...
  call npm install
  if errorlevel 1 goto :err
)

if not exist dist\index.js (
  echo Building project...
  call npm run build
  if errorlevel 1 goto :err
)

echo Starting Telegram Keyword Monitor... Press Ctrl+C to stop.
node dist\index.js
goto :eof

:err
echo.
echo Failed to start. Review the messages above.
pause
exit /b 1
