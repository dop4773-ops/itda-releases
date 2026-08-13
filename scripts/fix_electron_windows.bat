@echo off
setlocal enabledelayedexpansion

rem ============================================================
rem Electron manual extraction repair script
rem (workaround for a confirmed bug in Node.js 24.16.0+ / 26.1.0+)
rem   https://github.com/electron/electron/issues/51619
rem
rem Usage: run from the project root
rem   scripts\fix_electron_windows.bat
rem ============================================================

echo.
echo === Electron manual repair: start ===
echo.

if not exist "node_modules\electron" (
  echo [ERROR] node_modules\electron not found. Run npm install first.
  exit /b 1
)

set "CACHEDIR=%LOCALAPPDATA%\electron\Cache"
set "ZIPFILE="

if not exist "%CACHEDIR%" (
  echo [ERROR] Electron cache folder not found: %CACHEDIR%
  echo Run npm start once first so the download is attempted, then run this again.
  exit /b 1
)

for /f "delims=" %%f in ('dir /s /b "%CACHEDIR%\electron-v*-win32-x64.zip" 2^>nul') do (
  set "ZIPFILE=%%f"
)

if "!ZIPFILE!"=="" (
  echo [ERROR] Could not find electron-v*-win32-x64.zip in the cache.
  echo Run npm start once first so the download is attempted, then run this again.
  exit /b 1
)

echo Found cached file: !ZIPFILE!
echo.

echo [1/2] Extracting into dist folder...
if not exist "node_modules\electron\dist" mkdir "node_modules\electron\dist"
tar -xf "!ZIPFILE!" -C "node_modules\electron\dist"
if errorlevel 1 (
  echo [ERROR] Extraction failed. Make sure you are on Windows 10 1803+ ^(tar must be built in^).
  exit /b 1
)

echo [2/2] Writing path.txt... (node_modules\electron\path.txt, NOT inside the dist folder)
<nul set /p ="electron.exe">"node_modules\electron\path.txt"

echo.
if exist "node_modules\electron\dist\electron.exe" (
  echo === Done. Try npm start now. ===
) else (
  echo [WARNING] electron.exe was not found in the dist folder. Please re-check the extraction step above.
)
echo.
