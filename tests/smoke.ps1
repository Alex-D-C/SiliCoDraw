# Smoke test for Windows (PowerShell 5.1 or 7), run by .github/workflows/test.yml on every push and by hand:
#   powershell -NoProfile -ExecutionPolicy Bypass -File tests\smoke.ps1
# Checks the built-in PowerShell server (page, save, history, file list, refusal of cross-site writes) and the
# updater's dry run. Exit code 0 = everything passed.
param([int]$Port = 8798, [switch]$Offline)
$root = Split-Path $PSScriptRoot -Parent
$fail = 0
function Ok($m) { Write-Host "  ok    $m" }
function Bad($m) { Write-Host "  FAIL  $m"; $script:fail = 1 }
function Code($method, $url, $body, $headers) {
  try { $r = Invoke-WebRequest -Uri $url -Method $method -Body $body -Headers $headers -UseBasicParsing -TimeoutSec 10; return [int]$r.StatusCode }
  catch { if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode } return -1 }
}
Write-Host "SiliCoDraw smoke test (Windows, PowerShell $($PSVersionTable.PSVersion)), folder: $root"
$srv = Start-Process powershell -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$root\serve.ps1`"", '-port', $Port -PassThru -WindowStyle Hidden
try {
  $up = $false
  for ($i = 0; $i -lt 60 -and -not $up; $i++) { Start-Sleep -Milliseconds 250; $up = (Code GET "http://localhost:$Port/api/files") -eq 200 }
  if ($up) { Ok 'server started' } else { Bad 'server did not start' }
  $page = try { (Invoke-WebRequest "http://localhost:$Port/" -UseBasicParsing).Content } catch { '' }
  if ($page -match '<title>SiliCoDraw</title>') { Ok 'editor page served' } else { Bad 'editor page not served' }
  $fig = '{"version":4,"w":400,"h":300,"bg":"#ffffff","objects":[{"id":"t","type":"text","x":20,"y":40,"text":"smoke"}]}'
  $c = Code POST "http://localhost:$Port/zz-smoke.json" $fig; if ($c -eq 204) { Ok 'save a figure' } else { Bad "save a figure (HTTP $c)" }
  $back = try { (Invoke-WebRequest "http://localhost:$Port/zz-smoke.json" -UseBasicParsing).Content } catch { '' }
  if ($back -match '"smoke"') { Ok 'read it back' } else { Bad 'read it back' }
  Code POST "http://localhost:$Port/zz-smoke.json" $fig | Out-Null
  if (Get-ChildItem "$root\history\zz-smoke" -Filter *.json -ErrorAction SilentlyContinue) { Ok 'history snapshot' } else { Bad 'no history snapshot' }
  $list = try { (Invoke-WebRequest "http://localhost:$Port/api/files" -UseBasicParsing).Content } catch { '' }
  if ($list -match 'zz-smoke.json') { Ok 'file list' } else { Bad 'file list' }
  $c = Code POST "http://localhost:$Port/zz-evil.json" $fig @{ Origin = 'https://evil.example' }; if ($c -eq 403) { Ok 'refuses writes from other websites' } else { Bad "accepted a cross-site write (HTTP $c)" }
  $c = Code POST "http://localhost:$Port/figure-editor.html" 'x'; if ($c -ne 204) { Ok "cannot overwrite the editor ($c)" } else { Bad 'editor file was writable' }
} finally {
  if ($srv -and -not $srv.HasExited) { Stop-Process -Id $srv.Id -Force -ErrorAction SilentlyContinue }
  Remove-Item "$root\zz-smoke.json", "$root\zz-evil.json" -Force -ErrorAction SilentlyContinue
  Remove-Item "$root\history\zz-smoke" -Recurse -Force -ErrorAction SilentlyContinue
}
if (-not $Offline) {
  $out = & powershell -NoProfile -ExecutionPolicy Bypass -File "$root\update.ps1" -Check -Yes 2>&1 | Out-String
  if ($LASTEXITCODE -eq 0) { Ok 'updater -Check' } else { Bad "updater -Check: $out" }
}
if ($fail) { Write-Host 'Some checks FAILED.' } else { Write-Host 'All checks passed.' }
exit $fail
