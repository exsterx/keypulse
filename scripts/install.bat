@echo off
setlocal
cd /d "%~dp0.."
echo ============================================================
echo  Telegram Keyword Monitor — dependency installation
echo ============================================================
echo.
echo Step 1/2: installing packages (no native build yet)...
call npm install --ignore-scripts --no-audit --no-fund
if errorlevel 1 (
  echo.
  echo npm install failed. Review the messages above.
  pause
  exit /b 1
)
echo.
echo Step 2/2: fetching the better-sqlite3 prebuilt binary...
call node scripts\fetch-native.cjs
if errorlevel 1 (
  echo.
  echo Failed to fetch the native binary. Review the messages above.
  pause
  exit /b 1
)
echo.
echo Dependencies installed successfully.
echo Next steps:
echo   1. Copy .env.example to .env and fill in TG_API_ID, TG_API_HASH, BOT_TOKEN, OWNER_TELEGRAM_ID.
echo   2. Run: npm run auth   (authorize your Telegram account)
echo   3. Run: scripts\start.bat
pause
endlocal
