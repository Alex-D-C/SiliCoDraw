# SiliCoDraw shortcuts on Windows: a "SiliCoDraw" entry in this user's Start menu (and, if wanted, on the Desktop) with the app
# icon (brand\icon.ico), opening "Start SiliCoDraw.bat" in this folder. Only this Windows user; no administrator rights.
# Usually started by double-clicking "Add SiliCoDraw to the Start menu.bat".
#   shortcut.ps1              add or update the Start-menu entry; the first time it asks about the Desktop
#   shortcut.ps1 -Desktop     also on the Desktop (no question)
#   shortcut.ps1 -Yes         no questions (Start menu only, unless -Desktop)
#   shortcut.ps1 -Remove      remove the SiliCoDraw shortcuts again (only those that open a "Start SiliCoDraw.bat")
#   shortcut.ps1 -Update      quietly repair shortcuts that exist: one whose folder is gone (moved or replaced) is pointed at this
#                             folder, and it gets the current icon; nothing is created (the launcher and the updaters run this)
param([switch]$Desktop, [switch]$Yes, [switch]$Remove, [switch]$Update)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$bat = Join-Path $root 'Start SiliCoDraw.bat'
$ico = Join-Path $root 'brand\icon.ico'
$places = [ordered]@{
  'Start menu' = Join-Path ([Environment]::GetFolderPath('Programs')) 'SiliCoDraw.lnk'   # %APPDATA%\Microsoft\Windows\Start Menu\Programs
  'Desktop'    = Join-Path ([Environment]::GetFolderPath('Desktop')) 'SiliCoDraw.lnk'
}
if ($ExecutionContext.SessionState.LanguageMode -ne 'FullLanguage') {
  Write-Host 'Your IT policy does not allow this script to make shortcuts (PowerShell runs in restricted mode).'
  Write-Host 'It blocks the local server too; use SiliCoDraw in the browser instead: https://silicodraw.com'
  exit 1
}
$shell = New-Object -ComObject WScript.Shell

function Test-Ours($lnk) {   # a shortcut this script made (or the user made the same way): it opens a "Start SiliCoDraw.bat"
  if (-not (Test-Path -LiteralPath $lnk)) { return $false }
  try { return ([IO.Path]::GetFileName($shell.CreateShortcut($lnk).TargetPath) -eq 'Start SiliCoDraw.bat') } catch { return $false }
}
function Write-Link($lnk) {
  $s = $shell.CreateShortcut($lnk)
  $s.TargetPath = $bat
  $s.WorkingDirectory = $root
  if (Test-Path -LiteralPath $ico) { $s.IconLocation = "$ico,0" }
  $s.Description = 'Start SiliCoDraw (opens the editor in your browser)'
  $s.WindowStyle = 1   # the launcher's own window: it shows only while the server starts, and says so when something is wrong
  $s.Save()
}

if (-not (Test-Path -LiteralPath $bat)) { Write-Host "Start SiliCoDraw.bat is missing in $root"; exit 1 }

if ($Remove) {
  $n = 0
  foreach ($k in $places.Keys) {
    $lnk = $places[$k]
    if (Test-Ours $lnk) { Remove-Item -LiteralPath $lnk -Force; Write-Host "Removed the SiliCoDraw shortcut from the $k."; $n++ }
  }
  if (-not $n) { Write-Host 'There was no SiliCoDraw shortcut to remove.' }
  exit 0
}

if ($Update) {
  if ($root.StartsWith([IO.Path]::GetTempPath().TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)) { exit 0 }   # a copy in the temporary folder (a test, an unzipped preview) never takes over the shortcut
  foreach ($k in $places.Keys) {
    $lnk = $places[$k]
    if (-not (Test-Ours $lnk)) { continue }
    $t = $shell.CreateShortcut($lnk)
    $here = $t.TargetPath -eq $bat
    if ($here -or -not (Test-Path -LiteralPath $t.TargetPath)) {   # another copy of SiliCoDraw that still exists keeps its shortcut
      $iconNow = if (Test-Path -LiteralPath $ico) { "$ico,0" } else { $t.IconLocation }
      if (-not $here -or $t.IconLocation -ne $iconNow -or $t.WorkingDirectory -ne $root) { Write-Link $lnk; Write-Host "The SiliCoDraw shortcut in the $k now opens $root" }
    }
  }
  exit 0
}

$had = Test-Ours $places['Start menu']
New-Item -ItemType Directory -Force (Split-Path $places['Start menu'] -Parent) | Out-Null
Write-Link $places['Start menu']
Write-Host $(if ($had) { 'Updated SiliCoDraw in your Start menu.' } else { 'Added SiliCoDraw to your Start menu: press the Windows key, type SiliCoDraw, press Enter.' })
$wantDesk = [bool]$Desktop
if (-not $wantDesk -and (Test-Ours $places['Desktop'])) { $wantDesk = $true }   # keep (and update) one made before
elseif (-not $wantDesk -and -not $had -and -not $Yes) {
  $a = ''; try { $a = [string](Read-Host 'Also put a SiliCoDraw shortcut on the Desktop? Type Y and press Enter, or just press Enter for no') } catch {}
  $wantDesk = $a.Trim().ToLower().StartsWith('y')
}
if ($wantDesk) { Write-Link $places['Desktop']; Write-Host 'The SiliCoDraw shortcut is on your Desktop.' }
Write-Host ''
Write-Host 'The editor still opens as a tab in your browser. To stop SiliCoDraw: File > Quit SiliCoDraw in the editor.'
Write-Host 'If you move this folder, start SiliCoDraw once from the new place (double-click "Start SiliCoDraw"): the shortcut follows.'
if ($had -and -not $Yes) {
  $a = ''; try { $a = [string](Read-Host 'To remove the shortcuts instead, type R and press Enter; just Enter closes this window') } catch {}
  if ($a.Trim().ToLower() -eq 'r') { & $PSCommandPath -Remove }
} elseif (-not $Yes) { try { [void](Read-Host 'Press Enter to close this window') } catch {} }
