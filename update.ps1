# Update SiliCoDraw to the latest version from GitHub (Windows twin of update.py, used when Python is not installed).
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File update.ps1           # update
#   ... update.ps1 -Check                                                    # only show what would change
#
# Downloads the current main branch of https://github.com/Alex-D-C/SiliCoDraw as a ZIP, unpacks it in a
# temporary folder and copies every software file that changed into this folder (editor, servers,
# launchers, docs, examples, this script). Replaced files are kept in updates\backup-<date>\ (newest 3).
# Never touched: your figures (*.json in this folder), history\, exports\, assets\, archive\, trash\, updates\.
# Nothing is ever deleted.
param(
  [switch]$Check,
  [switch]$Pause,
  [string]$Repo = 'Alex-D-C/SiliCoDraw',
  [string]$Branch = 'main'
)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$protectedDirs = @('history', 'exports', 'assets', 'archive', 'trash', 'updates', '.git')
$keepBackups = 3
$tmp = $null; $c = $null; $code = 0

function Test-Protected([string]$rel) {   # $rel uses / separators
  $top = $rel.Split('/')[0]
  if ($protectedDirs -contains $top) { return $true }
  if ($rel -notmatch '/' -and $rel -like '*.json') { return $true }   # a figure in the root folder
  return $false
}

try {
  try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch {}
  Write-Host "SiliCoDraw updater"
  Write-Host "  folder: $root"
  Write-Host "  source: https://github.com/$Repo ($Branch)"
  try {
    $c = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/commits/$Branch" -Headers @{ 'User-Agent' = 'SiliCoDraw-updater' } -TimeoutSec 20
    $msg = ($c.commit.message -split "`n")[0]
    Write-Host "  latest: $($c.commit.committer.date.Substring(0, 10))  $msg  [$($c.sha.Substring(0, 10))]"
  } catch { $c = $null }
  Write-Host "Downloading..."
  $tmp = Join-Path ([IO.Path]::GetTempPath()) ('silicodraw-update-' + [IO.Path]::GetRandomFileName())
  New-Item -ItemType Directory -Force $tmp | Out-Null
  $zip = Join-Path $tmp 'src.zip'
  try {
    Invoke-WebRequest -Uri "https://github.com/$Repo/archive/refs/heads/$Branch.zip" -OutFile $zip -UseBasicParsing -Headers @{ 'User-Agent' = 'SiliCoDraw-updater' }
  } catch {
    Write-Host "Could not download the latest version: $($_.Exception.Message)"
    Write-Host "Check your internet connection and try again. Nothing was changed."
    $code = 1; throw 'stop'
  }
  $x = Join-Path $tmp 'x'
  Expand-Archive -Path $zip -DestinationPath $x -Force
  $top = Get-ChildItem $x -Directory | Select-Object -First 1     # GitHub puts everything in <repo>-<branch>\
  if (-not $top) { Write-Host "The download was empty; nothing was changed."; $code = 1; throw 'stop' }
  $stamp = Get-Date -Format 'yyyy-MM-dd_HH-mm-ss'
  $udir = Join-Path $root 'updates'
  $bdir = Join-Path $udir "backup-$stamp"
  $changed = @(); $new = @(); $skipped = 0
  foreach ($f in Get-ChildItem $top.FullName -File -Recurse) {
    $rel = $f.FullName.Substring($top.FullName.Length + 1).Replace('\', '/')
    if (Test-Protected $rel) { $skipped++; continue }
    $dst = Join-Path $root ($rel.Replace('/', '\'))
    if (Test-Path $dst) {
      if ((Get-FileHash $f.FullName -Algorithm SHA256).Hash -eq (Get-FileHash $dst -Algorithm SHA256).Hash) { continue }
      $changed += $rel
      if (-not $Check) {
        $bak = Join-Path $bdir ($rel.Replace('/', '\'))
        New-Item -ItemType Directory -Force (Split-Path $bak -Parent) | Out-Null
        Copy-Item $dst $bak -Force
      }
    } else { $new += $rel }
    if (-not $Check) {
      New-Item -ItemType Directory -Force (Split-Path $dst -Parent) | Out-Null
      Copy-Item $f.FullName $dst -Force
    }
  }
  $total = $changed.Count + $new.Count
  if ($Check) {
    if ($total -eq 0) { Write-Host "SiliCoDraw is up to date." }
    else {
      Write-Host "$total file(s) would be updated:"
      foreach ($r in $changed) { Write-Host "  updated  $r" }
      foreach ($r in $new) { Write-Host "  new      $r" }
    }
  } elseif ($total -eq 0) {
    Write-Host "SiliCoDraw is already up to date. Nothing was changed."
  } else {
    Write-Host "Updated $($changed.Count) file(s), added $($new.Count):"
    foreach ($r in $changed) { Write-Host "  updated  $r" }
    foreach ($r in $new) { Write-Host "  new      $r" }
    if ($changed.Count) { Write-Host "The previous versions are kept in updates\backup-$stamp\" }
    New-Item -ItemType Directory -Force $udir | Out-Null
    Get-ChildItem $udir -Directory -Filter 'backup-*' | Sort-Object Name -Descending | Select-Object -Skip $keepBackups | Remove-Item -Recurse -Force
    $info = "updated: $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
    if ($c) { $info += "`r`nsource: https://github.com/$Repo commit $($c.sha.Substring(0, 10)) ($($c.commit.committer.date.Substring(0, 10)))" }
    [IO.File]::WriteAllText((Join-Path $udir 'installed.txt'), $info + "`r`n")
    Write-Host "Your figures, history, exports and assets were not touched."
    Write-Host "If SiliCoDraw is open: close the server window, start it again and reload the browser page."
  }
  if ($skipped) { Write-Host "($skipped file(s) in the download were skipped because they would overwrite your data.)" }
} catch {
  if ($_.Exception.Message -ne 'stop') { Write-Host "Update failed: $($_.Exception.Message)"; $code = 1 }
} finally {
  if ($tmp -and (Test-Path $tmp)) { Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue }
}
if ($Pause) { Read-Host 'Press Enter to close' | Out-Null }
exit $code
