# Smoke test for Windows (PowerShell 5.1 or 7), run by .github/workflows/test.yml on every push and by hand:
#   powershell -NoProfile -ExecutionPolicy Bypass -File tests\smoke.ps1
# Checks the built-in PowerShell server (page, save, history, file list, refusal of cross-site writes) and the
# updater's dry run. Exit code 0 = everything passed.
#   -Root <folder>  the SiliCoDraw folder (default: the nearest folder above this script with serve.ps1)
#   -Port <n>       (default: a free port)   -Offline: skip the updater check (needs github.com)
param([int]$Port = 0, [switch]$Offline, [string]$Root = '')
$root = $Root
if (-not $root) { $root = Split-Path $PSScriptRoot -Parent; while ($root -and -not (Test-Path (Join-Path $root 'serve.ps1'))) { $root = Split-Path $root -Parent } }
if (-not $root -or -not (Test-Path (Join-Path $root 'serve.ps1'))) { Write-Host '  FAIL  no SiliCoDraw folder (serve.ps1) found; pass -Root'; exit 1 }
if ($Port -le 0) { $t = New-Object Net.Sockets.TcpListener ([Net.IPAddress]::Loopback), 0; $t.Start(); $Port = $t.LocalEndpoint.Port; $t.Stop() }
$nm = 'zz-smoke-' + (Get-Random -Maximum 999999)   # a name of its own: a figure called zz-smoke in the folder is left alone
$fail = 0
function Ok($m) { Write-Host "  ok    $m" }
function Bad($m) { Write-Host "  FAIL  $m"; $script:fail = 1 }
function Code($method, $url, $body, $headers) {
  try { $r = Invoke-WebRequest -Uri $url -Method $method -Body $body -Headers $headers -UseBasicParsing -TimeoutSec 10; return [int]$r.StatusCode }
  catch { if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode } return -1 }
}
Write-Host "SiliCoDraw smoke test (Windows, PowerShell $($PSVersionTable.PSVersion)), folder: $root"
$srv = Start-Process powershell -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$root\serve.ps1`"", '-port', $Port, '-data', "`"$root`"" -PassThru -WindowStyle Hidden
try {
  $up = $false
  for ($i = 0; $i -lt 60 -and -not $up; $i++) { Start-Sleep -Milliseconds 250; $up = (Code GET "http://localhost:$Port/api/files") -eq 200 }
  if ($up) { Ok 'server started' } else { Bad 'server did not start' }
  $page = try { (Invoke-WebRequest "http://localhost:$Port/" -UseBasicParsing).Content } catch { '' }
  if ($page -match '<title>SiliCoDraw</title>') { Ok 'editor page served' } else { Bad 'editor page not served' }
  $fig = '{"version":4,"w":400,"h":300,"bg":"#ffffff","objects":[{"id":"t","type":"text","x":20,"y":40,"text":"smoke"}]}'
  $c = Code POST "http://localhost:$Port/$nm.json" $fig; if ($c -eq 204) { Ok 'save a figure' } else { Bad "save a figure (HTTP $c)" }
  $back = try { (Invoke-WebRequest "http://localhost:$Port/$nm.json" -UseBasicParsing).Content } catch { '' }
  if ($back -match '"smoke"') { Ok 'read it back' } else { Bad 'read it back' }
  $tg = try { (Invoke-WebRequest "http://localhost:$Port/$nm.json" -UseBasicParsing).Headers['ETag'] } catch { '' }
  $c = try { (Invoke-WebRequest "http://localhost:$Port/$nm.json" -UseBasicParsing -Headers @{ 'If-None-Match' = $tg }).StatusCode } catch { [int]$_.Exception.Response.StatusCode }
  if ($tg -and $c -eq 304) { Ok 'unchanged figure: 304' } else { Bad "unchanged figure with If-None-Match (HTTP $c)" }
  Code POST "http://localhost:$Port/$nm.json" $fig | Out-Null
  if (Get-ChildItem "$root\history\$nm" -Filter *.json -ErrorAction SilentlyContinue) { Ok 'history snapshot' } else { Bad 'no history snapshot' }
  $list = try { (Invoke-WebRequest "http://localhost:$Port/api/files" -UseBasicParsing).Content } catch { '' }
  if ($list -match "$nm.json") { Ok 'file list' } else { Bad 'file list' }
  $c = Code POST "http://localhost:$Port/$nm-evil.json" $fig @{ Origin = 'https://evil.example' }; if ($c -eq 403) { Ok 'refuses writes from other websites' } else { Bad "accepted a cross-site write (HTTP $c)" }
  $c = Code POST "http://localhost:$Port/figure-editor.html" 'x'; if ($c -ne 204) { Ok "cannot overwrite the editor ($c)" } else { Bad 'editor file was writable' }
} finally {
  if ($srv -and -not $srv.HasExited) { Stop-Process -Id $srv.Id -Force -ErrorAction SilentlyContinue }
  Remove-Item "$root\$nm.json", "$root\$nm-evil.json" -Force -ErrorAction SilentlyContinue
  Remove-Item "$root\history\$nm" -Recurse -Force -ErrorAction SilentlyContinue
}
# the figures folder: in a copy of the server of its own, so a folder you chose is left alone
$tmpD = Join-Path ([IO.Path]::GetTempPath()) "silicodraw-$nm"; $app = Join-Path $tmpD 'app'; $cloud = Join-Path $tmpD 'Sync folder\SiliCoDraw'
$srv2 = $null
function Start-Copy { $q = New-Object Net.Sockets.TcpListener ([Net.IPAddress]::Loopback), 0; $q.Start(); $script:P2 = $q.LocalEndpoint.Port; $q.Stop()
  $script:srv2 = Start-Process powershell -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$app\serve.ps1`"", '-port', $script:P2 -PassThru -WindowStyle Hidden
  $u = $false; for ($i = 0; $i -lt 60 -and -not $u; $i++) { Start-Sleep -Milliseconds 250; $u = (Code GET "http://localhost:$($script:P2)/api/storage?brief=1") -eq 200 }; return $u }
function Stop-Copy { if ($script:srv2 -and -not $script:srv2.HasExited) { Stop-Process -Id $script:srv2.Id -Force -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 300 } }
function Get-Json($p) { try { (Invoke-WebRequest "http://localhost:$($script:P2)/$p" -UseBasicParsing -TimeoutSec 10).Content | ConvertFrom-Json } catch { $null } }
try {
  New-Item -ItemType Directory -Force $app | Out-Null; Copy-Item (Join-Path $root 'serve.ps1') $app
  $fakeSync = Join-Path $tmpD 'OneDrive - Test'; New-Item -ItemType Directory -Force $fakeSync | Out-Null; $oldOD = $env:OneDrive; $env:OneDrive = $fakeSync   # a sync app's folder it must find
  if (Start-Copy) { Ok 'figures folder: a server of its own' } else { Bad 'figures folder: server did not start' }
  $fig2 = '{"version":4,"w":400,"h":300,"bg":"#ffffff","objects":[{"id":"t","type":"text","x":20,"y":40,"text":"folder"}]}'
  $s = Get-Json 'api/storage'; if ($s -and $s.isDefault -and $s.canChange) { Ok 'figures folder: this folder by default' } else { Bad 'figures folder: api/storage' }
  $o = @($s.options | Where-Object { $_.path -eq $fakeSync.TrimEnd('\') }); if ($o.Count -eq 1 -and $o[0].name -eq 'OneDrive') { Ok 'figures folder: a sync app''s folder is found, as a name and a path' } else { Bad "figures folder: the sync folders: $(ConvertTo-Json -InputObject $s.options -Depth 4 -Compress)" }
  Code POST "http://localhost:$P2/before.json" $fig2 | Out-Null; Code POST "http://localhost:$P2/before.json" $fig2 | Out-Null
  $c = Code GET "http://localhost:$P2/...json"; $d = Code POST "http://localhost:$P2/...json" $fig2; if ($d -ne 204) { Ok 'a name that is only dots is no figure' } else { Bad 'a name that is only dots was saved' }
  $c = Code POST "http://localhost:$P2/api/storage?dir=$([Uri]::EscapeDataString($cloud))&copy=1" '' @{ Origin = 'https://evil.example' }; if ($c -eq 403) { Ok 'figures folder: another website cannot change it' } else { Bad "figures folder: changed from another website (HTTP $c)" }
  $c = Code POST "http://localhost:$P2/api/storage?dir=relative\path" ''; if ($c -eq 400) { Ok 'figures folder: a partial path is refused' } else { Bad "figures folder: partial path (HTTP $c)" }
  $c = Code POST "http://localhost:$P2/api/storage?dir=$([Uri]::EscapeDataString($cloud))&copy=1" ''; if ($c -eq 200 -and (Test-Path -LiteralPath (Join-Path $cloud 'before.json'))) { Ok 'figures folder: set, and the figures copied' } else { Bad "figures folder: set and copy (HTTP $c)" }
  if (Test-Path -LiteralPath (Join-Path $app 'before.json')) { Ok 'figures folder: the old copy stays' } else { Bad 'figures folder: the old copy went' }
  Code POST "http://localhost:$P2/after.json" $fig2 | Out-Null
  if ((Test-Path -LiteralPath (Join-Path $cloud 'after.json')) -and -not (Test-Path -LiteralPath (Join-Path $app 'after.json'))) { Ok 'figures folder: saves go there' } else { Bad 'figures folder: saved in the wrong place' }
  $n = Get-Content -Raw -LiteralPath (Join-Path $cloud 'before.json'); Code POST "http://localhost:$P2/assets/a.json" '{}' | Out-Null; if (Test-Path -LiteralPath (Join-Path $cloud 'assets\a.json')) { Ok 'figures folder: its assets go there too' } else { Bad 'figures folder: assets in the wrong place' }
  $page = Code GET "http://localhost:$P2/serve.ps1"; if ($page -eq 200) { Ok 'figures folder: program files stay served from the program folder' } else { Bad "figures folder: program file (HTTP $page)" }
  Stop-Copy; if (Start-Copy) { $l = (Invoke-WebRequest "http://localhost:$P2/api/files" -UseBasicParsing).Content; if ($l -match 'after\.json') { Ok 'figures folder: remembered after a restart' } else { Bad 'figures folder: forgotten after a restart' } }
  $c = Code POST "http://localhost:$P2/api/storage?dir=$([Uri]::EscapeDataString($cloud))" '' @{ Origin = 'http://localhost:1234' }; if ($c -eq 403) { Ok 'figures folder: another page on this computer cannot change it' } else { Bad "figures folder: changed from another local page (HTTP $c)" }
  $c = Code GET "http://localhost:$P2/not-there.json"; if ($c -eq 404) { Ok 'figures folder: a figure not there: 404' } else { Bad "figures folder: not there (HTTP $c)" }
  Stop-Copy; Rename-Item -LiteralPath $cloud 'moved away'; if (Start-Copy) { $s = Get-Json 'api/storage'; if ($s.missing -and -not (Test-Path -LiteralPath $cloud)) { Ok 'figures folder: gone at the start: says so, and no empty folder appears' } else { Bad 'figures folder: gone: not reported' } }
  $c = Code GET "http://localhost:$P2/before.json"; $d = Code POST "http://localhost:$P2/before.json" $fig2; $e = Code POST "http://localhost:$P2/exports/a.png" 'x'; if ($c -eq 503 -and $d -eq 503 -and $e -eq 503 -and -not (Test-Path -LiteralPath $cloud)) { Ok 'figures folder: while gone: figures wait (503), nothing goes elsewhere' } else { Bad "figures folder: while gone: read $c, save $d, export $e" }
  if ((Get-Content -Raw -LiteralPath (Join-Path $app 'before.json')) -notmatch 'changed') { Ok 'figures folder: while gone: the old copies are not touched' } else { Bad 'figures folder: while gone: an old copy changed' }
  Rename-Item -LiteralPath (Join-Path (Split-Path $cloud -Parent) 'moved away') (Split-Path $cloud -Leaf); $c = Code GET "http://localhost:$P2/before.json"; if ($c -eq 200) { Ok 'figures folder: back by itself, no restart' } else { Bad "figures folder: not back (HTTP $c)" }
  Remove-Item -LiteralPath (Join-Path $cloud 'trash') -Recurse -Force -ErrorAction SilentlyContinue; [IO.File]::WriteAllText((Join-Path $cloud 'my figure (conflicted copy).json'), '{"objects":[]}')
  $other = Join-Path $tmpD 'Other [2026]'; $a = try { (Invoke-WebRequest "http://localhost:$P2/api/storage?dir=$([Uri]::EscapeDataString($other))&copy=1" -Method POST -UseBasicParsing).Content | ConvertFrom-Json } catch { $null }
  if ($a -and @($a.skipped) -contains 'my figure (conflicted copy).json') { Ok 'figures folder: a file with no figure''s name is reported as left behind' } else { Bad 'figures folder: left behind without a word' }
  $l = (Invoke-WebRequest "http://localhost:$P2/api/files" -UseBasicParsing).Content; if ($l -match 'before\.json') { Ok 'figures folder: a path with [ ] works' } else { Bad 'figures folder: a path with [ ] looks empty' }
  $quoted = [string][char]34 + $cloud + [char]34; $c = Code POST "http://localhost:$P2/api/storage?dir=$([Uri]::EscapeDataString($quoted))" ''; if ($c -eq 200) { Ok 'figures folder: a path pasted in quotes works' } else { Bad "figures folder: a path in quotes (HTTP $c)" }
  $c = Code POST "http://localhost:$P2/api/storage?dir=" ''; $s = Get-Json 'api/storage'; if ($c -eq 200 -and $s.isDefault -and -not (Test-Path -LiteralPath (Join-Path $app '.silicodraw-folder'))) { Ok 'figures folder: back to the program folder' } else { Bad "figures folder: back (HTTP $c)" }
} finally { $env:OneDrive = $oldOD; Stop-Copy; Remove-Item -LiteralPath $tmpD -Recurse -Force -ErrorAction SilentlyContinue }
if (-not $Offline -and -not (Test-Path (Join-Path $root 'update.ps1'))) { Write-Host '  skip  updater -Check (no update.ps1 in this folder)' }
elseif (-not $Offline) {
  $out = & powershell -NoProfile -ExecutionPolicy Bypass -File "$root\update.ps1" -Check -Yes -Force 2>&1 | Out-String
  if ($LASTEXITCODE -eq 0) { Ok 'updater -Check' } else { Bad "updater -Check: $out" }
}
if ($fail) { Write-Host 'Some checks FAILED.' } else { Write-Host 'All checks passed.' }
exit $fail
