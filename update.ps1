# Update SiliCoDraw to the latest version from GitHub (Windows twin of update.py, used when Python is not installed).
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File update.ps1           # update (asks first)
#   ... update.ps1 -Check                                                    # only show what would change
#   ... update.ps1 -Yes                                                      # do not ask (for scripts and AI assistants)
#   ... update.ps1 -Pause                                                    # wait for Enter at the end (the .bat launcher)
#
# What it does, in this order, and only after you confirm:
#   1. downloads the current main branch of https://github.com/Alex-D-C/SiliCoDraw as a ZIP and checks it,
#   2. puts a copy of your figures (*.json here, assets\, archive\) in updates\figures-backup-<date>.zip,
#   3. writes every changed software file to a staging folder first, then keeps the old version of each in
#      updates\backup-<date>\ and swaps the new files in; if anything goes wrong (or you press Ctrl+C) the
#      files already swapped are put back, so the folder is never left half-updated.
# What it never touches: your figures, history\, exports\, assets\, archive\, trash\, updates\, .git\.
# The newest 5 software backups are kept; figure backups are never removed.
param(
  [switch]$Check,
  [switch]$Yes,
  [switch]$Pause,
  [switch]$Force,
  [string]$Repo = 'Alex-D-C/SiliCoDraw',
  [string]$Branch = 'main'
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # the progress bar makes Invoke-WebRequest many times slower in Windows PowerShell
$root = $PSScriptRoot
$upd = Join-Path $root 'updates'
$journalPath = Join-Path $upd 'in-progress.json'
$protectedDirs = @('history', 'exports', 'assets', 'archive', 'trash', 'updates', '.git')
$keepBackups = 5
$issues = "https://github.com/$Repo/issues"
$notice = @"

  PLEASE READ: this updater is new and has not been tested by its author yet.
  If something goes wrong, files in this folder could be damaged.
  Before you continue:
    1. Save your work and close SiliCoDraw (the browser tab and the server window).
    2. Copy your figures (the .json files in this folder, and the assets folder)
       to a separate place, such as another folder or a USB stick.
  The updater also puts a copy of your figures in the "updates" folder first.
  Afterwards, please tell us whether it worked:
    $issues
"@
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Stop-Update([string]$msg) { throw "STOP:$msg" }   # an expected problem: shown as it is
function Test-Interactive { try { return [Environment]::UserInteractive -and -not [Console]::IsInputRedirected } catch { return $false } }
function Ask([string]$prompt) { try { return [string](Read-Host $prompt) } catch { return '' } }
function Test-Protected([string]$rel) {   # $rel uses / separators; case-insensitive like the Windows file system
  $low = $rel.ToLower()
  if ($protectedDirs -contains $low.Split('/')[0]) { return $true }
  return ($low -notmatch '/' -and $low.EndsWith('.json'))   # a figure in the root folder
}
function Get-SafeParts([string]$rel) {   # the path parts of a ZIP entry, or $null if it could write outside this folder
  if (-not $rel -or $rel.Contains('\') -or $rel.Contains(':') -or $rel.StartsWith('/')) { return $null }
  $parts = $rel.Split('/')
  foreach ($p in $parts) { if ($p -eq '' -or $p -eq '.' -or $p -eq '..') { return $null } }
  return ,$parts
}
function Join-Parts([string]$base, $parts) { $p = $base; foreach ($x in $parts) { $p = Join-Path $p $x }; return $p }
function Save-Journal($j) { $t = "$journalPath.tmp"; [IO.File]::WriteAllText($t, ($j | ConvertTo-Json -Depth 4)); Move-Item -LiteralPath $t -Destination $journalPath -Force }
function Restore-Journal($j) {   # undo a partly applied update: put back every replaced file, remove new ones
  $bdir = Join-Path $upd $j.backup
  foreach ($rel in @($j.applied)) {
    if (-not $rel) { continue }
    $parts = $rel.Split('/'); $dst = Join-Parts $root $parts; $bak = Join-Parts $bdir $parts
    try {
      if (Test-Path -LiteralPath $bak -PathType Leaf) { Copy-Item -LiteralPath $bak -Destination $dst -Force }
      elseif (@($j.new) -contains $rel -and (Test-Path -LiteralPath $dst -PathType Leaf)) { Remove-Item -LiteralPath $dst -Force }
    } catch { Write-Host "  could not restore ${rel}: $($_.Exception.Message)" }
  }
}
function Move-WithRetry([string]$src, [string]$dst) {   # antivirus or a sync tool may hold a file for a moment
  for ($i = 0; $i -lt 6; $i++) {
    try {
      if ([IO.File]::Exists($dst)) { [IO.File]::Replace($src, $dst, [NullString]::Value) } else { [IO.File]::Move($src, $dst) }
      return
    } catch { if ($i -eq 5) { throw }; Start-Sleep -Milliseconds 500 }
  }
}
function Get-Download([string]$url, [string]$out) {
  if ($url -and (Test-Path -LiteralPath $url)) { Copy-Item -LiteralPath $url -Destination $out; return }   # a local file (tests)
  $first = $null
  try { Invoke-WebRequest -Uri $url -OutFile $out -UseBasicParsing -Headers @{ 'User-Agent' = 'SiliCoDraw-updater' } -TimeoutSec 180; return }
  catch { $first = $_.Exception.Message }
  $curl = Get-Command curl.exe -ErrorAction SilentlyContinue   # ships with Windows 10 1803 and later
  if ($curl) {
    try { & $curl.Source -fsSL --retry 2 --max-time 180 -A 'SiliCoDraw-updater' -o $out $url 2>$null } catch {}   # stderr must not end the script: the friendly message follows
    if ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath $out)) { return }
    $first = "$first; curl exit $LASTEXITCODE"
  }
  Stop-Update "Could not download the latest version: $first`nCheck your internet connection and try again.`nNothing was changed."
}
function Get-ZipComment([string]$path) {   # GitHub puts the commit id in the ZIP comment; .NET Framework does not expose it
  try {
    $b = [IO.File]::ReadAllBytes($path)
    for ($i = $b.Length - 22; $i -ge [Math]::Max(0, $b.Length - 65557); $i--) {
      if ($b[$i] -eq 0x50 -and $b[$i + 1] -eq 0x4b -and $b[$i + 2] -eq 0x05 -and $b[$i + 3] -eq 0x06) {
        $n = $b[$i + 20] + 256 * $b[$i + 21]
        if ($n -gt 0 -and $i + 22 + $n -le $b.Length) { return ([Text.Encoding]::ASCII.GetString($b, $i + 22, $n)).Trim() }
        return ''
      }
    }
  } catch {}
  return ''
}
function Get-InstalledCommit {
  try { foreach ($l in [IO.File]::ReadAllLines((Join-Path $upd 'installed.txt'))) { if ($l.StartsWith('source:')) { return ($l -split 'commit', 2)[1].Trim().Split(' ')[0] } } } catch {}
  return 'unknown'
}
function Get-OsName { "Windows $([Environment]::OSVersion.Version) ($env:PROCESSOR_ARCHITECTURE)" }
function Get-Sanitized([string]$s) {
  foreach ($x in @(@($root, '<folder>'), @($HOME, '~'), @($env:USERNAME, '<user>'))) { if ($x[0] -and $x[0].Length -gt 2) { $s = $s.Replace($x[0], $x[1]) } }
  return $s
}
function Get-ReportUrl($st) {
  $res = if ($st.result) { $st.result } else { 'failed' }
  $title = "Update report: $res (Windows, update.ps1)"
  $lines = @("Result: $res", "OS: $(Get-OsName)", "Method: update.ps1$(if ($Pause) { ' (double-click launcher)' })",
             "PowerShell: $($PSVersionTable.PSVersion)", "Files: $($st.changed) updated, $($st.new) new", "Version: $($st.old) -> $($st.commit)")
  if ($st.error) { $e = Get-Sanitized $st.error; $lines += 'Error: ' + $e.Substring(0, [Math]::Min(300, $e.Length)) }
  $lines += @('', 'What happened (optional):', '')
  return "$issues/new?title=$([uri]::EscapeDataString($title))&body=$([uri]::EscapeDataString($lines -join "`n"))"
}

$st = @{ result = $null; changed = 0; new = 0; old = 'unknown'; commit = 'unknown'; error = $null }
$code = 0; $tmp = $null; $journal = $null; $done = $false; $sdir = $null
try {
  try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch {}
  Write-Host 'SiliCoDraw updater'
  Write-Host "  folder: $root"
  Write-Host "  source: https://github.com/$Repo ($Branch)"
  if ((Test-Path -LiteralPath (Join-Path $root '.git')) -and -not $Force) { Stop-Update 'This folder is a git clone: update it with "git pull" instead (or run again with -Force).' }
  if (-not $Check) {
    Write-Host $notice
    if (-not $Yes) {
      if (-not (Test-Interactive)) { $st.result = 'not started'; Stop-Update 'Not running in a window you can type in, so nothing was changed. Run again with -Yes to update without asking.' }
      $a = (Ask '  Type Y and press Enter to continue (just Enter cancels)').Trim().ToLower()
      if ($a -ne 'y' -and $a -ne 'yes') { $st.result = 'cancelled'; Write-Host 'Cancelled. Nothing was changed.'; throw 'DONE' }
    }
    try {   # can we write here at all? (read-only folder, still inside the ZIP, OneDrive files on demand)
      New-Item -ItemType Directory -Force -Path $upd | Out-Null
      [IO.File]::WriteAllText((Join-Path $upd '.write-test'), 'ok'); Remove-Item -LiteralPath (Join-Path $upd '.write-test') -Force
    } catch { Stop-Update "This folder cannot be written ($($_.Exception.Message)).`nMove the SiliCoDraw folder to your Documents folder (not inside the ZIP, not a read-only drive) and try again.`nNothing was changed." }
    if (Test-Path -LiteralPath $journalPath) {   # a previous run stopped in the middle of swapping files (power cut, crash)
      try {
        $j = Get-Content -LiteralPath $journalPath -Raw | ConvertFrom-Json
        Write-Host "A previous update was interrupted. Restoring the previous version from updates\$($j.backup) ..."
        Restore-Journal $j; Remove-Item -LiteralPath $journalPath -Force; Write-Host "Restored. Now updating again.`n"
      } catch {}
    }
  }
  $st.old = Get-InstalledCommit
  Write-Host 'Downloading...'
  $tmp = Join-Path ([IO.Path]::GetTempPath()) ('silicodraw-update-' + [IO.Path]::GetRandomFileName())
  New-Item -ItemType Directory -Force -Path $tmp | Out-Null
  $zipPath = Join-Path $tmp 'src.zip'
  $url = if ($env:SILICODRAW_ZIP_URL) { $env:SILICODRAW_ZIP_URL } else { "https://github.com/$Repo/archive/refs/heads/$Branch.zip" }   # the variable is for tests
  Get-Download $url $zipPath
  try { $z = [IO.Compression.ZipFile]::OpenRead($zipPath) } catch { Stop-Update 'The download is not a valid ZIP file. Try again later. Nothing was changed.' }
  try {
    $c = Get-ZipComment $zipPath
    $st.commit = if ($c) { $c.Substring(0, [Math]::Min(10, $c.Length)) } else { 'unknown' }
    $entries = @($z.Entries | Where-Object { -not $_.FullName.EndsWith('/') })
    if (-not $entries.Count) { Stop-Update 'The download was empty. Nothing was changed.' }
    $top = $entries[0].FullName.Split('/')[0]   # GitHub puts everything in <repo>-<branch>/
    $ed = $entries | Where-Object { $_.FullName -eq "$top/figure-editor.html" } | Select-Object -First 1
    if (-not $ed -or $ed.Length -lt 100000) { Stop-Update 'The download does not contain the editor; it may be incomplete. Try again later. Nothing was changed.' }
    $plan = New-Object System.Collections.ArrayList; $skipped = 0
    foreach ($e in $entries) {
      if (-not $e.FullName.StartsWith("$top/")) { continue }
      $rel = $e.FullName.Substring($top.Length + 1)
      $parts = Get-SafeParts $rel
      if ($null -eq $parts) { continue }
      try { if ((($e.ExternalAttributes -shr 16) -band 0xF000) -eq 0xA000) { continue } } catch {}   # a symlink
      if (Test-Protected $rel) { $skipped++; continue }
      $ms = New-Object IO.MemoryStream
      try { $s = $e.Open(); $s.CopyTo($ms); $s.Close() } catch { Stop-Update "The download is damaged ($rel). Try again later. Nothing was changed." }
      $body = $ms.ToArray()
      $dst = Join-Parts $root $parts
      $existed = Test-Path -LiteralPath $dst -PathType Leaf
      if ($existed) {
        $cur = [IO.File]::ReadAllBytes($dst)
        if ($cur.Length -eq $body.Length -and [Convert]::ToBase64String($cur) -eq [Convert]::ToBase64String($body)) { continue }
      }
      [void]$plan.Add(@{ rel = $rel; parts = $parts; body = $body; existed = $existed })
    }
  } finally { $z.Dispose() }
  $changed = @($plan | Where-Object { $_.existed } | ForEach-Object { $_.rel })
  $new = @($plan | Where-Object { -not $_.existed } | ForEach-Object { $_.rel })
  $st.changed = $changed.Count; $st.new = $new.Count
  if ($Check) {
    $st.result = 'checked'
    if (-not $plan.Count) { Write-Host 'SiliCoDraw is up to date.' }
    else {
      Write-Host "$($plan.Count) file(s) would be updated:"
      foreach ($r in $changed) { Write-Host "  updated  $r" }
      foreach ($r in $new) { Write-Host "  new      $r" }
    }
    throw 'DONE'
  }
  if (-not $plan.Count) { $st.result = 'already up to date'; Write-Host 'SiliCoDraw is already up to date. Nothing was changed.'; throw 'DONE' }

  $stamp = Get-Date -Format 'yyyy-MM-dd_HH-mm-ss'
  # 1) a copy of the figures
  $fb = Join-Path $upd "figures-backup-$stamp.zip"; $n = 0
  $fz = [IO.Compression.ZipFile]::Open($fb, 'Create')
  try {
    foreach ($f in Get-ChildItem -LiteralPath $root -File -Filter '*.json') { [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($fz, $f.FullName, $f.Name); $n++ }
    foreach ($d in @('assets', 'archive')) {
      $base = Join-Path $root $d
      if (Test-Path -LiteralPath $base) { foreach ($f in Get-ChildItem -LiteralPath $base -File -Recurse -Force) { [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($fz, $f.FullName, $f.FullName.Substring($root.Length + 1).Replace('\', '/')); $n++ } }
    }
  } finally { $fz.Dispose() }
  Write-Host "A copy of your figures ($n files) is in updates\figures-backup-$stamp.zip"
  # 2) stage every new file and keep the current version of each one to be replaced
  $sdir = Join-Path $upd "staging-$stamp"; $bname = "backup-$stamp"; $bdir = Join-Path $upd $bname
  foreach ($p in $plan) {
    $s = Join-Parts $sdir $p.parts; New-Item -ItemType Directory -Force -Path (Split-Path $s -Parent) | Out-Null; [IO.File]::WriteAllBytes($s, $p.body)
    if ($p.existed) { $b = Join-Parts $bdir $p.parts; New-Item -ItemType Directory -Force -Path (Split-Path $b -Parent) | Out-Null; Copy-Item -LiteralPath (Join-Parts $root $p.parts) -Destination $b -Force }
  }
  # 3) swap them in, remembering each one (the finally block below puts everything back if this does not finish)
  $journal = [ordered]@{ backup = $bname; new = $new; applied = @() }
  Save-Journal $journal
  foreach ($p in $plan) {
    $dst = Join-Parts $root $p.parts
    New-Item -ItemType Directory -Force -Path (Split-Path $dst -Parent) | Out-Null
    $journal.applied += $p.rel; Save-Journal $journal
    Move-WithRetry (Join-Parts $sdir $p.parts) $dst
  }
  Remove-Item -LiteralPath $journalPath -Force; $journal = $null
  Remove-Item -LiteralPath $sdir -Recurse -Force -ErrorAction SilentlyContinue
  [IO.File]::WriteAllText((Join-Path $upd 'installed.txt'), "updated: $(Get-Date -Format 'yyyy-MM-dd HH:mm')`r`nsource: https://github.com/$Repo commit $($st.commit)`r`n")
  $st.result = 'success'
  Write-Host "Updated $($changed.Count) file(s), added $($new.Count):"
  foreach ($r in $changed) { Write-Host "  updated  $r" }
  foreach ($r in $new) { Write-Host "  new      $r" }
  if ($changed.Count) { Write-Host "The previous versions are kept in updates\$bname\" }
  Write-Host 'Your figures, history, exports and assets were not touched.'
  Write-Host 'If SiliCoDraw is open: close the server window, start it again and reload the browser page.'
  if ($skipped) { Write-Host "($skipped file(s) in the download were skipped because they would overwrite your data.)" }
  try {   # keep the newest software backups (by date written, not by name); never the one just made
    Get-ChildItem -LiteralPath $upd -Directory -Filter 'backup-*' | Where-Object { $_.Name -ne $bname } | Sort-Object LastWriteTime -Descending |
      Select-Object -Skip ($keepBackups - 1) | ForEach-Object { Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction SilentlyContinue }
  } catch {}
  $done = $true
} catch {
  $m = $_.Exception.Message
  if ($m -eq 'DONE') { $done = $true }
  elseif ($m.StartsWith('STOP:')) { Write-Host "`n$($m.Substring(5))"; if (-not $st.result) { $st.result = 'failed' }; if (-not $st.error) { $st.error = ($m.Substring(5) -split "`n")[0] }; $code = 1 }
  else { Write-Host "`nUpdate failed: $m"; $st.result = 'failed'; $st.error = $m; $code = 1 }
} finally {
  if ($journal) {   # the swap did not finish (an error, or Ctrl+C): put the previous files back
    Write-Host "`nThe update stopped part-way. Putting the previous files back..."
    Restore-Journal $journal
    Remove-Item -LiteralPath $journalPath -Force -ErrorAction SilentlyContinue
    if ($sdir) { Remove-Item -LiteralPath $sdir -Recurse -Force -ErrorAction SilentlyContinue }
    Write-Host 'The previous version was restored; your figures were not touched.'
    $st.result = 'failed, previous version restored'; if (-not $st.error) { $st.error = 'interrupted' }; $code = 1
  }
  elseif (-not $done -and $sdir) { Remove-Item -LiteralPath $sdir -Recurse -Force -ErrorAction SilentlyContinue }   # stopped while staging: nothing was swapped
  if ($tmp -and (Test-Path -LiteralPath $tmp)) { Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue }
}
$asked = $false
if (@('cancelled', 'checked', 'not started', 'already up to date') -notcontains $st.result -and $st.result) {
  $report = Get-ReportUrl $st
  Write-Host "`nPlease tell us how the update went, even if it worked (needs a free GitHub account):"
  Write-Host "  $report"
  if (Test-Interactive) {
    $asked = $true
    if ((Ask 'Type O and press Enter to open this page in your browser, or just press Enter to close').Trim().ToLower() -eq 'o') { Start-Process $report }
  }
}
if ($Pause -and -not $asked -and (Test-Interactive)) { Ask "`nPress Enter to close" | Out-Null }
exit $code
