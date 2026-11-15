@echo off
rem Double-click to add SiliCoDraw to your Start menu (and, if you like, the Desktop) with its icon: for this Windows user
rem only, no administrator rights needed. Double-click it again to update the shortcut or to remove it.
rem From a command prompt: "Add SiliCoDraw to the Start menu.bat" /desktop (also on the Desktop) or /remove.
if not exist "%~dp0shortcut.ps1" (
  echo.
  echo  SiliCoDraw cannot run from inside the ZIP file.
  echo  Right-click the downloaded ZIP file, choose "Extract All...", move the extracted folder where you want
  echo  to keep it, then double-click "Add SiliCoDraw to the Start menu" there.
  echo.
  pause
  exit /b 1
)
set "SCARG="
if /i "%~1"=="/remove" set "SCARG=-Remove"
if /i "%~1"=="/desktop" set "SCARG=-Desktop"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0shortcut.ps1" %SCARG%
if errorlevel 1 pause
if /i "%~1"=="/remove" pause