@echo off
rem Double-click to start the Figure Editor on Windows. Keep the server window open while you work; close it to stop.
rem Uses Python if it is installed, otherwise the built-in PowerShell server (no installation needed).
cd /d "%~dp0"
where python >nul 2>nul && python -c "import sys; sys.exit(0 if sys.version_info[0]==3 else 1)" >nul 2>nul
if %errorlevel%==0 (
  start "SiliCoDraw server" python serve.py
) else (
  start "SiliCoDraw server" powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1"
  timeout /t 2 /nobreak >nul
  start "" http://localhost:8770/
)
