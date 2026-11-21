@echo off
rem Double-click to start Lgbids on Windows. Keep this window open while you use the app.
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed, or Windows cannot find it.
  echo Install the LTS version from https://nodejs.org and then double-click this file again.
  echo.
  pause
  exit /b 1
)
node scripts\launch.mjs %*
if errorlevel 1 (
  echo.
  echo Lgbids stopped because of a problem. The messages above say what went wrong.
  pause
  exit /b 1
)
