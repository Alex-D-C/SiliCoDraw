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
# a PC whose IT policy restricts PowerShell (ConstrainedLanguage): serve.ps1 says so and stops (it waits 15 s for the reader, so it runs beside the other checks; looked at near the end)
$clmOut = Join-Path ([IO.Path]::GetTempPath()) "silicodraw-$nm-clm.txt"; $clmPort = 0
try { $q0 = New-Object Net.Sockets.TcpListener ([Net.IPAddress]::Loopback), 0; $q0.Start(); $clmPort = $q0.LocalEndpoint.Port; $q0.Stop() } catch {}
$clm = Start-Process powershell -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', "`"`$ExecutionContext.SessionState.LanguageMode = 'ConstrainedLanguage'; & '$($root.Replace("'", "''"))\serve.ps1' -port $clmPort`"" -PassThru -WindowStyle Hidden -RedirectStandardOutput $clmOut
try { $null = $clm.Handle } catch {}   # (kept, so its exit code can be read once it ended)
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
  # writes only from the editor's own origin (scheme, name and this port); a tool without Origin as before (the saves above); a foreign Host never
  $c = Code POST "http://localhost:$Port/$nm.json" $fig @{ Origin = "http://localhost:$Port"; 'Sec-Fetch-Site' = 'same-origin' }; if ($c -eq 204) { Ok 'accepts writes from the editor''s own page (same port)' } else { Bad "refused a write from its own page (HTTP $c)" }
  $c = Code POST "http://localhost:$Port/$nm-evil.json" $fig @{ Origin = "http://localhost:$($Port + 1)" }; if ($c -eq 403) { Ok 'refuses writes from another port of this computer' } else { Bad "accepted a write from another localhost port (HTTP $c)" }
  $c = Code POST "http://localhost:$Port/api/move?file=$nm.json&from=&to=trash" '' @{ Origin = 'http://127.0.0.1:1234' }; if ($c -eq 403) { Ok 'refuses moving a figure from another local page' } else { Bad "moved a figure for another local page (HTTP $c)" }
  $c = Code POST "http://localhost:$Port/$nm-evil.json" $fig @{ 'Sec-Fetch-Site' = 'same-site' }; if ($c -eq 403) { Ok 'refuses a browser write marked same-site (another port)' } else { Bad "accepted a same-site write (HTTP $c)" }
  $c = Code POST "http://localhost:$Port/api/quit" '' @{ Origin = "http://localhost:$($Port + 1)" }; $up2 = (Code GET "http://localhost:$Port/api/storage?brief=1") -eq 200; if ($c -eq 403 -and $up2) { Ok 'another local page cannot quit it' } else { Bad "quit from another local page (HTTP $c, still up: $up2)" }
  $c = Code GET "http://localhost:$Port/api/storage?brief=1" $null @{ Host = "evil.example:$Port" }; if ($c -ge 400) { Ok "refuses a foreign Host ($c)" } else { Bad "answered a foreign Host (HTTP $c)" }
  $c = Code PUT "http://localhost:$Port/$nm.json" $fig; if ($c -eq 405) { Ok 'PUT is refused (405)' } else { Bad "PUT answered $c" }
  if (Test-Path "$root\$nm-evil.json") { Bad 'a refused write left a file' }
  $c = Code POST "http://localhost:$Port/figure-editor.html" 'x'; if ($c -ne 204) { Ok "cannot overwrite the editor ($c)" } else { Bad 'editor file was writable' }
  # files of the figures folder are served sandboxed (an SVG with a script that came in with a .zip must not run as the editor's page); the editor itself is not: it has a policy of its own (only its own scripts)
  $svgOk = (Code POST "http://localhost:$Port/assets/$nm.svg" '<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>') -eq 204
  $hs = try { (Invoke-WebRequest "http://localhost:$Port/assets/$nm.svg" -UseBasicParsing -TimeoutSec 10).Headers } catch { $null }
  $hf = try { (Invoke-WebRequest "http://localhost:$Port/$nm.json" -UseBasicParsing -TimeoutSec 10).Headers } catch { $null }
  $he = try { (Invoke-WebRequest "http://localhost:$Port/" -UseBasicParsing -TimeoutSec 10).Headers } catch { $null }
  if ($svgOk -and $hs -and "$($hs['Content-Security-Policy'])" -match '^sandbox;' -and $hs['X-Content-Type-Options'] -eq 'nosniff' -and "$($hf['Content-Security-Policy'])" -match '^sandbox;' -and $he -and "$($he['Content-Security-Policy'])" -match "^default-src 'self'; script-src 'self' 'sha256-") { Ok 'files of the figures folder are served sandboxed (nosniff); the editor is not, it has its own policy (its scripts by hash)' } else { Bad "sandbox headers: svg '$($hs['Content-Security-Policy'])' figure '$($hf['Content-Security-Policy'])' editor '$($he['Content-Security-Policy'])'" }
  Remove-Item -LiteralPath "$root\assets\$nm.svg" -ErrorAction SilentlyContinue
  # what a page is never given though it lies in the program folder: names starting with a dot (.git, .silicodraw-folder), dev\ (but dev\web\), updates\
  $hid = Join-Path $root ".zz-smoke-$nm.txt"; [IO.File]::WriteAllText($hid, 'withheld')
  $ch = Code GET "http://localhost:$Port/.zz-smoke-$nm.txt"; Remove-Item -LiteralPath $hid -ErrorAction SilentlyContinue
  if ($ch -eq 404) { Ok 'a file under a name starting with a dot is withheld (404)' } else { Bad "a file under a name starting with a dot was served ($ch)" }
  # icon packs (icon-expansions\): the index and, for every pack, its names, license and attribution are served
  $ix = try { (Invoke-WebRequest "http://localhost:$Port/icon-expansions/index.json" -UseBasicParsing -TimeoutSec 10).Content | ConvertFrom-Json } catch { $null }
  if ($ix -and @($ix.packs).Count -ge 1) {
    $lost = @($ix.packs | Where-Object { $id = $_.id; @('pack.json', 'names.json', 'preview.json', 'LICENSE.txt', 'ATTRIBUTION.md') | Where-Object { (Code GET "http://localhost:$Port/icon-expansions/$id/$_") -ne 200 } } | ForEach-Object { $_.id })
    if ($lost.Count -eq 0) { Ok "icon packs served: $(@($ix.packs).Count), each with its license and attribution" } else { Bad "icon pack with a file missing: $($lost -join ', ')" }
  } else { Bad 'icon-expansions/index.json not served' }
  # the app icon (brand\): served with the content type each kind needs
  $want = [ordered]@{ 'icon.svg' = 'image/svg+xml'; 'icon-small.svg' = 'image/svg+xml'; 'lockup.svg' = 'image/svg+xml'; 'icon-180.png' = 'image/png'; 'social-preview.png' = 'image/png'; 'icon.ico' = 'image/x-icon'; 'SiliCoDraw.icns' = 'image/icns' }
  $wrong = @($want.Keys | Where-Object { $ct = try { (Invoke-WebRequest "http://localhost:$Port/brand/$_" -UseBasicParsing -TimeoutSec 10).Headers['Content-Type'] } catch { '' }; -not "$ct".StartsWith($want[$_]) })
  if ($wrong.Count -eq 0) { Ok "app icon served: $($want.Count) files of brand/ with their content types" } else { Bad "brand/ files missing or with a wrong content type: $($wrong -join ', ')" }
  # in a git checkout: the software JSON files are not ignored (*.json in .gitignore is for the user's figures), so they reach GitHub, the updater and CI
  if ((Test-Path (Join-Path $root '.git')) -and (Get-Command git -ErrorAction SilentlyContinue)) { $ign = @(git -C $root check-ignore notices/notices.json examples/pathway.json icon-expansions/index.json 2>$null); if ($ign.Count) { Bad "ignored by .gitignore, so never committed: $($ign -join ', ')" } else { Ok 'software JSON files are not ignored by git' } }
  # the notice board on Home (notices\): its list as JSON with tips and news, its pictures as SVG
  $nb = try { [Text.Encoding]::UTF8.GetString((Invoke-WebRequest "http://localhost:$Port/notices/notices.json" -UseBasicParsing -TimeoutSec 10).RawContentStream.ToArray()) | ConvertFrom-Json } catch { $null }
  $nct = try { (Invoke-WebRequest "http://localhost:$Port/notices/home.svg" -UseBasicParsing -TimeoutSec 10).Headers['Content-Type'] } catch { '' }
  if ($nb -and @($nb.tips).Count -gt 0 -and @($nb.news).Count -gt 0 -and "$nct".StartsWith('image/svg+xml')) { Ok "notice board served: notices/notices.json ($(@($nb.tips).Count) tips, $(@($nb.news).Count) news) and its pictures" } else { Bad 'notices/notices.json or its pictures not served' }
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
  New-Item -ItemType Directory -Force (Join-Path $app 'icon-expansions') | Out-Null; '{"packs":[]}' | Set-Content -LiteralPath (Join-Path $app 'icon-expansions\index.json'); Code POST "http://localhost:$P2/assets/icon-packs.json" '{}' | Out-Null
  $page = Code GET "http://localhost:$P2/icon-expansions/index.json"; if ($page -eq 200 -and (Test-Path -LiteralPath (Join-Path $cloud 'assets\icon-packs.json')) -and -not (Test-Path -LiteralPath (Join-Path $app 'assets\icon-packs.json'))) { Ok 'figures folder: icon packs come from the program folder, what was imported is kept with the figures' } else { Bad "figures folder: icon packs (HTTP $page)" }
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
  # File > Quit SiliCoDraw: POST api/quit from the editor's own page answers 204, then the server ends
  $c = Code POST "http://localhost:$P2/api/quit" '' @{ Origin = "http://localhost:$P2"; 'Sec-Fetch-Site' = 'same-origin' }
  for ($i = 0; $i -lt 40 -and -not $srv2.HasExited; $i++) { Start-Sleep -Milliseconds 250 }
  if ($c -eq 204 -and $srv2.HasExited -and (Code GET "http://localhost:$P2/api/storage?brief=1") -eq -1) { Ok 'quit: api/quit stops the server' } else { Bad "quit: HTTP $c, ended: $($srv2.HasExited)" }
} finally { $env:OneDrive = $oldOD; Stop-Copy; Remove-Item -LiteralPath $tmpD -Recurse -Force -ErrorAction SilentlyContinue }
# the launcher (Start SiliCoDraw.bat) on a port of its own, without opening a browser: it waits until the server answers and ends with 0; Quit then stops that server
$bat = Join-Path $root 'Start SiliCoDraw.bat'
if (Test-Path -LiteralPath $bat) {
  $q3 = New-Object Net.Sockets.TcpListener ([Net.IPAddress]::Loopback), 0; $q3.Start(); $P3 = $q3.LocalEndpoint.Port; $q3.Stop()
  $env:SILICODRAW_PORT = "$P3"; $env:SILICODRAW_NO_BROWSER = '1'
  try {
    $lp = Start-Process cmd.exe -ArgumentList '/c', "`"`"$bat`"`"" -PassThru -WindowStyle Hidden; try { $null = $lp.Handle } catch {}
    for ($i = 0; $i -lt 180 -and -not $lp.HasExited; $i++) { Start-Sleep -Milliseconds 250 }
    $up3 = (Code GET "http://localhost:$P3/api/storage?brief=1") -eq 200
    if ($lp.HasExited -and $lp.ExitCode -eq 0 -and $up3) { Ok 'launcher: waits until the server answers, then ends (0)' } else { Bad "launcher: ended $($lp.HasExited), code $(if ($lp.HasExited) { $lp.ExitCode }), server up: $up3" }
    $c = Code POST "http://localhost:$P3/api/quit" ''; $gone = $false; for ($i = 0; $i -lt 40 -and -not $gone; $i++) { Start-Sleep -Milliseconds 250; $gone = (Code GET "http://localhost:$P3/api/storage?brief=1") -eq -1 }
    if ($c -eq 204 -and $gone) { Ok 'launcher: its server stops with api/quit' } else { Bad "launcher: quit (HTTP $c, stopped: $gone)" }
  } finally {
    Remove-Item Env:SILICODRAW_PORT, Env:SILICODRAW_NO_BROWSER -ErrorAction SilentlyContinue
    try { Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe' OR Name = 'python.exe' OR Name = 'pwsh.exe'" | Where-Object { $_.CommandLine -match "(-|--)port $P3\b" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } } catch {}
  }
} else { Write-Host '  skip  launcher (no Start SiliCoDraw.bat in this folder)' }
# the restricted PowerShell started at the top
for ($i = 0; $i -lt 100 -and -not $clm.HasExited; $i++) { Start-Sleep -Milliseconds 250 }
$said = try { [IO.File]::ReadAllText($clmOut) } catch { '' }
if ($clm.HasExited -and $clm.ExitCode -eq 1 -and $said -match 'IT policy' -and $said -match 'silicodraw\.com') { Ok 'restricted PowerShell (IT policy): serve.ps1 says so and points to silicodraw.com' } else { Bad "restricted PowerShell: ended $($clm.HasExited), code $(if ($clm.HasExited) { $clm.ExitCode }), said: $said" }
if (-not $clm.HasExited) { Stop-Process -Id $clm.Id -Force -ErrorAction SilentlyContinue }
Remove-Item -LiteralPath $clmOut -Force -ErrorAction SilentlyContinue
if (-not $Offline -and -not (Test-Path (Join-Path $root 'update.ps1'))) { Write-Host '  skip  updater -Check (no update.ps1 in this folder)' }
elseif (-not $Offline) {
  $out = & powershell -NoProfile -ExecutionPolicy Bypass -File "$root\update.ps1" -Check -Yes -Force 2>&1 | Out-String
  if ($LASTEXITCODE -eq 0) { Ok 'updater -Check' } else { Bad "updater -Check: $out" }
}
if ($fail) { Write-Host 'Some checks FAILED.' } else { Write-Host 'All checks passed.' }
exit $fail
