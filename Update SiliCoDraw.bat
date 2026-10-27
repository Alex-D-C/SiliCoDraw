@echo off
rem Double-click to update SiliCoDraw to the latest version from GitHub.
rem It asks before changing anything, makes a copy of your figures first, and never touches your figures,
rem history, exports or assets. The file runs as a copy from the temp folder so that the update can replace it.
if "%~1"=="" (
  if not exist "%~dp0update.ps1" (
    echo.
    echo  This file cannot run from inside the ZIP file.
    echo  Right-click the downloaded ZIP file, choose "Extract All...", then open the extracted
    echo  SiliCoDraw folder and double-click "Update SiliCoDraw" there.
    echo.
    pause
    exit /b 1
  )
  set "SDTMP=%TEMP%\silicodraw-update-%RANDOM%%RANDOM%.bat"
  call copy /y "%~f0" "%%SDTMP%%" >nul
  call "%%SDTMP%%" "%~dp0"
  call del "%%SDTMP%%" >nul 2>nul
  exit /b
)
cd /d "%~1"
where python >nul 2>nul && python -c "import sys; sys.exit(0 if sys.version_info >= (3, 6) else 1)" >nul 2>nul
if %errorlevel%==0 (
  python "%~1update.py" --pause
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~1update.ps1" -Pause
)
