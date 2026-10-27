@echo off
rem Double-click to start SiliCoDraw on Windows. Keep the server window open while you work; close it to stop.
rem Uses Python if it is installed, otherwise the built-in PowerShell server (no installation needed).
if not exist "%~dp0serve.ps1" (
  echo.
  echo  SiliCoDraw cannot run from inside the ZIP file.
  echo  Right-click the downloaded ZIP file, choose "Extract All...", then open the extracted
  echo  folder and double-click "Start SiliCoDraw" there.
  echo.
  pause
  exit /b 1
)
cd /d "%~dp0"
where python >nul 2>nul && python -c "import sys; sys.exit(0 if sys.version_info >= (3, 7) else 1)" >nul 2>nul
if %errorlevel%==0 (
  start "SiliCoDraw server" cmd /c "python serve.py || pause"
) else (
  start "SiliCoDraw server" powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1"
  timeout /t 2 /nobreak >nul
  start "" http://localhost:8770/
)
