@echo off
rem Double-click to update SiliCoDraw to the latest version from GitHub.
rem Your figures, history, exports and assets are never touched; nothing is deleted.
rem The file runs as a copy from the temp folder so that this file itself can be replaced by the update.
if "%~1"=="" (
  copy /y "%~f0" "%TEMP%\silicodraw-update.bat" >nul
  "%TEMP%\silicodraw-update.bat" "%~dp0"
  exit /b
)
cd /d "%~1"
where python >nul 2>nul && python -c "import sys; sys.exit(0 if sys.version_info[0]==3 else 1)" >nul 2>nul
if %errorlevel%==0 (
  python "%~1update.py" --pause
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~1update.ps1" -Pause
)
