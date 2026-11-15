@echo off
rem Double-click to start SiliCoDraw on Windows: the server starts in a minimized window ("SiliCoDraw server" in the taskbar)
rem and the editor opens as a tab in your browser once the server answers. To stop: File > Quit SiliCoDraw in the editor
rem (or close the server window). Uses Python if it is installed, otherwise the built-in PowerShell server (no installation needed).
rem "Add SiliCoDraw to the Start menu" puts a shortcut with the app icon in the Start menu.
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
set "PORT=8770"
if defined SILICODRAW_PORT set "PORT=%SILICODRAW_PORT%"
echo Starting SiliCoDraw...
where python >nul 2>nul && python -c "import sys; sys.exit(0 if sys.version_info >= (3, 7) else 1)" >nul 2>nul
rem POLL = the address the wait below asks: serve.py listens on 127.0.0.1 only (asking "localhost" tries ::1 first, which Windows
rem gives up on only after about 2 s), serve.ps1 on the name localhost only (127.0.0.1 gets 400 there). PSRV: only the PowerShell
rem server is blocked by IT policy (ConstrainedLanguage), so only then does the wait say so.
if %errorlevel%==0 (
  set "POLL=127.0.0.1"
  set "PSRV=0"
  start "SiliCoDraw server" /min cmd /c "python serve.py --port %PORT% --no-browser || pause"
) else (
  set "POLL=localhost"
  set "PSRV=1"
  start "SiliCoDraw server" /min powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1" -port %PORT%
)
rem a Start-menu shortcut made for a folder that is gone (this one was moved): it opens this folder from now on (not in the tests:
rem SILICODRAW_NO_BROWSER, set with SILICODRAW_PORT by tests\smoke.ps1)
if not defined SILICODRAW_NO_BROWSER if exist "%APPDATA%\Microsoft\Windows\Start Menu\Programs\SiliCoDraw.lnk" powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0shortcut.ps1" -Update >nul 2>nul
rem wait until the server answers (at most 30 s by the clock) instead of opening the browser on an error page
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference = 'SilentlyContinue'; if ('%PSRV%' -eq '1' -and $ExecutionContext.SessionState.LanguageMode -ne 'FullLanguage') { exit 3 }; $t0 = Get-Date; while (((Get-Date) - $t0).TotalSeconds -lt 30) { try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 -Uri 'http://%POLL%:%PORT%/api/storage?brief=1'; if ($r.Content -match 'isDefault') { exit 0 } else { exit 2 } } catch { if ($_.Exception.Response) { exit 2 } }; Start-Sleep -Milliseconds 300 }; exit 1"
set "WAITED=%errorlevel%"
if "%WAITED%"=="0" (
  if not defined SILICODRAW_NO_BROWSER start "" http://localhost:%PORT%/
  exit /b 0
)
echo.
if "%WAITED%"=="3" (
  echo  Your IT policy blocks the local SiliCoDraw server on this computer
  echo  ^(PowerShell runs in restricted mode, and Python is not installed^).
  echo  Use SiliCoDraw in your browser instead: https://silicodraw.com
) else if "%WAITED%"=="2" (
  echo  Another program uses port %PORT%, so SiliCoDraw cannot start there.
  echo  Close that program and start SiliCoDraw again.
) else (
  echo  SiliCoDraw did not answer within 30 seconds.
  echo  Click "SiliCoDraw server" in the taskbar to see why, then start SiliCoDraw again.
)
echo.
pause
exit /b 1