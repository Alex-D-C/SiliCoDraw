# Browser test suite for Windows (PowerShell 5.1 or 7): runs tests/run.html (tests/editor-tests.js inside the editor) in a
# headless Edge, Chrome or Firefox against a server of its own on a free port, prints the results, exit code 0 = all passed.
#   powershell -NoProfile -ExecutionPolicy Bypass -File tests\browser.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File tests\browser.ps1 -Browser firefox
# Options:
#   -Only icons,examples       only the tests whose names start with these (icons, types, type <name>, examples, undo/redo, connectors, ...)
#   -Editor dev/web/editor.html  another editor page in the folder (default: figure-editor.html)
#   -Browser edge | chrome | firefox | <path to msedge.exe, chrome.exe or firefox.exe>   (or set SILICODRAW_BROWSER);
#                              default: Edge, then Chrome, then Firefox
#   -Root <folder>             the SiliCoDraw folder to test (default: the nearest folder above this script with serve.ps1)
#   -Show                      a visible browser window instead of headless;  -Timeout <seconds> (default 1800)
param([string]$Root = '', [int]$Port = 0, [string]$Browser = $env:SILICODRAW_BROWSER, [string]$Editor = '', [string]$Only = '', [int]$Timeout = 1800, [switch]$Show)
try { [Console]::OutputEncoding = New-Object Text.UTF8Encoding $false } catch {}
if (-not $Root) { $d = Split-Path $PSScriptRoot -Parent; while ($d -and -not (Test-Path (Join-Path $d 'serve.ps1'))) { $d = Split-Path $d -Parent }; $Root = $d }
if (-not $Root -or -not (Test-Path (Join-Path $Root 'serve.ps1'))) { Write-Host 'FAIL  no SiliCoDraw folder (serve.ps1) found; pass -Root'; exit 1 }
$Root = (Resolve-Path $Root).Path.TrimEnd('\')
$here = (Resolve-Path $PSScriptRoot).Path
if (-not $here.StartsWith($Root + '\', [StringComparison]::OrdinalIgnoreCase)) {   # Windows paths: any letter case
  Write-Host "FAIL  this script must live inside $Root"; exit 1 }
$runPath = $here.Substring($Root.Length + 1).Replace('\', '/') + '/run.html'

# the browser: a path, or a name (edge / chrome / firefox) that picks the first one of that kind found
$edge = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe")
# newer Edge builds keep msedge.exe in EdgeCore\<version>\ (the Application folder may hold only a version folder)
foreach ($pf in @(${env:ProgramFiles(x86)}, $env:ProgramFiles)) { if ($pf) { $edge += @(Get-ChildItem -Path (Join-Path $pf 'Microsoft\EdgeCore\*\msedge.exe'), (Join-Path $pf 'Microsoft\Edge\Application\*\msedge.exe') -ErrorAction SilentlyContinue | Sort-Object { try { [version]$_.Directory.Name } catch { [version]'0.0' } } -Descending | ForEach-Object { $_.FullName }) } }
$chrome = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Chromium\Application\chrome.exe")
$firefox = @("$env:ProgramFiles\Mozilla Firefox\firefox.exe", "${env:ProgramFiles(x86)}\Mozilla Firefox\firefox.exe", "$env:LOCALAPPDATA\Mozilla Firefox\firefox.exe",
  "$env:ProgramFiles\Firefox Developer Edition\firefox.exe", "$env:ProgramFiles\Firefox Nightly\firefox.exe")
$cands = switch -Regex ($Browser) { '^\s*$' { $edge + $chrome + $firefox } '^(ms)?edge$' { $edge } '^(google-)?chrom(e|ium)$' { $chrome } '^(mozilla-)?firefox$' { $firefox } default { @($Browser) } }
$exe = $cands | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
if (-not $exe) { Write-Host "FAIL  no $(if ($Browser) { $Browser } else { 'Edge, Chrome or Firefox' }) found (pass -Browser <path> or set SILICODRAW_BROWSER)"; exit 1 }
$isFirefox = [IO.Path]::GetFileName($exe) -match '^firefox'

# a free port and a server of our own (never the one you work with)
if ($Port -le 0) { $t = New-Object Net.Sockets.TcpListener ([Net.IPAddress]::Loopback), 0; $t.Start(); $Port = $t.LocalEndpoint.Port; $t.Stop() }
$id = 'zz-tests-' + [DateTime]::Now.ToString('yyyyMMddHHmmss') + '-' + (Get-Random -Maximum 99999)
$figName = $id -replace '^zz-tests-', 'zz-test-'   # the scratch figure: named here, so it is removed even when the page never reports
$reportFile = Join-Path $Root "exports\$id.json"
$prof = Join-Path ([IO.Path]::GetTempPath()) "silicodraw-browser-$id"
$url = "http://localhost:$Port/${runPath}?report=$id&figure=$figName"   # braces: ? is a valid character in a PowerShell variable name
if ($Editor) { $url += '&editor=' + [Uri]::EscapeDataString($Editor) }
if ($Only) { $url += '&only=' + [Uri]::EscapeDataString($Only) }
Write-Host "SiliCoDraw browser tests, folder: $Root"
Write-Host "  browser: $exe"
Write-Host "  page:    $url"
$fail = 1; $srv = $null; $br = $null; $res = $null
try {
  $srv = Start-Process powershell -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$Root\serve.ps1`"", '-port', $Port -PassThru -WindowStyle Hidden
  $up = $false
  for ($i = 0; $i -lt 80 -and -not $up; $i++) { Start-Sleep -Milliseconds 250; try { $up = (Invoke-WebRequest "http://localhost:$Port/api/files" -UseBasicParsing -TimeoutSec 5).StatusCode -eq 200 } catch {} }
  if (-not $up) { throw "the server did not start on port $Port" }
  if ($isFirefox) {
    # Firefox: a fresh profile of its own (-no-remote: never hands the page to a Firefox window that is already open), no first-run pages, no throttled background timers
    New-Item -ItemType Directory -Force $prof | Out-Null
    $prefs = @('browser.shell.checkDefaultBrowser', 'false'), @('browser.aboutwelcome.enabled', 'false'), @('datareporting.policy.dataSubmissionEnabled', 'false'),
      @('toolkit.telemetry.reportingpolicy.firstRun', 'false'), @('browser.startup.homepage_override.mstone', '"ignore"'), @('app.update.disabledForTesting', 'true'),
      @('dom.min_background_timeout_value', '4'), @('dom.timeout.enable_budget_timer_throttling', 'false')
    [IO.File]::WriteAllText((Join-Path $prof 'user.js'), (($prefs | ForEach-Object { "user_pref(`"$($_[0])`", $($_[1]));" }) -join "`n"))
    $args0 = @('-no-remote', '-profile', "`"$prof`"", '-width', '1500', '-height', '1100')
    if (-not $Show) { $args0 = @('-headless') + $args0 }
  } else {
    $args0 = @('--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync', '--disable-features=Translate', '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--window-size=1500,1100', "--user-data-dir=`"$prof`"")
    if (-not $Show) { $args0 = @('--headless=new', '--disable-gpu', '--mute-audio') + $args0 }
  }
  $br = Start-Process $exe -ArgumentList ($args0 + "`"$url`"") -PassThru
  $t0 = Get-Date; $next = 30
  while (-not $res) {
    Start-Sleep -Milliseconds 500
    if (Test-Path -LiteralPath $reportFile) { try { $res = [IO.File]::ReadAllText($reportFile, [Text.Encoding]::UTF8) | ConvertFrom-Json } catch { $res = $null } }
    $s = ((Get-Date) - $t0).TotalSeconds
    if ($s -gt $next) { Write-Host "  ... still running ($([int]$s) s)"; $next += 30 }
    if ($s -gt $Timeout) { throw "no results after $Timeout s" }
    if ($srv.HasExited) { throw 'the server stopped' }
  }
} catch { Write-Host "  FAIL  $($_.Exception.Message)" }
finally {
  if ($br) { & taskkill /T /F /PID $br.Id 2>$null | Out-Null }
  try { Get-CimInstance Win32_Process -Filter "Name='msedge.exe' OR Name='chrome.exe' OR Name='firefox.exe'" | Where-Object { $_.CommandLine -like "*$id*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } } catch {}   # only ours: the profile path carries the run id
  if ($srv -and -not $srv.HasExited) { Stop-Process -Id $srv.Id -Force -ErrorAction SilentlyContinue }
  Remove-Item -LiteralPath $reportFile -Force -ErrorAction SilentlyContinue
  # the scratch figure, if the page could not remove it (also after a timeout or a browser crash)
  foreach ($f in @($figName, "$figName-phone")) {   # -phone: the phone layout test's own figure
    foreach ($p in @((Join-Path $Root "$f.json"), (Join-Path $Root "trash\$f.json"))) { Remove-Item -LiteralPath $p -Force -ErrorAction SilentlyContinue }
    Remove-Item -LiteralPath (Join-Path $Root "history\$f") -Recurse -Force -ErrorAction SilentlyContinue }
  for ($i = 0; $i -lt 10 -and (Test-Path -LiteralPath $prof); $i++) { Remove-Item -LiteralPath $prof -Recurse -Force -ErrorAction SilentlyContinue; if (Test-Path -LiteralPath $prof) { Start-Sleep -Milliseconds 500 } }
}
if ($res) {
  foreach ($t in $res.tests) {
    $tag = if ($t.skip) { 'skip' } elseif ($t.ok) { 'ok  ' } else { 'FAIL' }
    $line = "  $tag  $($t.name)"; if ($t.msg) { $line += " -- $($t.msg)" }; if ($null -ne $t.ms) { $line += " ($($t.ms) ms)" }
    Write-Host $line
  }
  Write-Host ("{0} passed, {1} failed, {2} skipped in {3:N1} s ({4}{5})" -f $res.passed, $res.failed, $res.skipped, ($res.ms / 1000), $res.env.ua, $(if ($res.env.web) { ', web version' } else { '' }))
  if ($res.ok -eq $true) { $fail = 0 }
}
if ($fail) { Write-Host 'Browser tests FAILED.' } else { Write-Host 'All browser tests passed.' }
exit $fail
