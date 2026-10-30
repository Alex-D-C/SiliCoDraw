# SiliCoDraw server: http://localhost:<port>/
#  - serves the editor and the figure files in this folder
#  - saves figures (POST <name>.json); before overwriting, keeps a snapshot in history\<name>\ (at most every 5 minutes)
#  - sends a figure with its version (ETag); a save made from an older version (If-Match) is refused with 409 and the current file, so the editor merges;
#    a read that sends the version it has (If-None-Match) gets 304 when unchanged
#  - writes exports (POST exports/<name>.png|svg|pdf|tif|pptx)
#  - api/files, api/history?file=..., api/rename, api/move, api/delete for the editor's file menu
param([int]$port = 8770)
$root = $PSScriptRoot
$nameRe = '^[\w.\-]+\.json$'
$l = New-Object System.Net.HttpListener
$l.Prefixes.Add("http://localhost:$port/")
try { $l.Start() } catch {
  # started twice (the launcher double-clicked again): if SiliCoDraw already answers there, that is fine
  $running = $false
  try { $running = (Invoke-WebRequest -Uri "http://localhost:$port/api/files" -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200 } catch {}
  if ($running) { Write-Host "SiliCoDraw is already running at http://localhost:$port/"; Start-Sleep -Seconds 3; exit 0 }
  Write-Host "Could not start on port ${port}: another program uses it. Close that program and try again."
  Start-Sleep -Seconds 8; exit 1
}
Write-Host "SiliCoDraw is running at http://localhost:$port/  (close this window to stop it)"
$types = @{ '.html'='text/html; charset=utf-8'; '.js'='text/javascript'; '.css'='text/css'; '.json'='application/json; charset=utf-8'; '.svg'='image/svg+xml; charset=utf-8'; '.png'='image/png'; '.jpg'='image/jpeg'; '.jpeg'='image/jpeg'; '.gif'='image/gif'; '.webp'='image/webp'; '.md'='text/markdown; charset=utf-8'; '.txt'='text/plain; charset=utf-8'; '.pptx'='application/vnd.openxmlformats-officedocument.presentationml.presentation'; '.pdf'='application/pdf'; '.tif'='image/tiff'; '.tiff'='image/tiff' }
# a figure's version is a hash of its content, sent as ETag with the figure (the same as serve.py). A save carries it back (If-Match, or ?base= from a
# page that is closing) and is refused with 409 and the file as it is now when the file changed since (another window or a tool wrote it): the editor merges instead of overwriting
$sha = [Security.Cryptography.SHA256]::Create()
function Get-ETag($bytes) { '"' + ([BitConverter]::ToString($sha.ComputeHash($bytes)) -replace '-', '').ToLower() + '"' }

# query parameters decoded as UTF-8 (HttpListener's QueryString uses the ANSI code page, which garbles names like non-ASCII names)
function Get-Q($req, $name) {
  foreach ($pair in $req.Url.Query.TrimStart('?').Split('&')) {
    $kv = $pair.Split([char[]]'=', 2)
    if ([Uri]::UnescapeDataString($kv[0].Replace('+', ' ')) -eq $name) { if ($kv.Count -gt 1) { return [Uri]::UnescapeDataString($kv[1].Replace('+', ' ')) } else { return '' } }
  }
  return $null
}
function Send-Raw($ctx, $json) {
  $b = [Text.Encoding]::UTF8.GetBytes($json)
  $ctx.Response.ContentType = 'application/json; charset=utf-8'
  $ctx.Response.Headers.Add('Cache-Control','no-store')
  $ctx.Response.ContentLength64 = $b.Length
  if ($ctx.Request.HttpMethod -ne 'HEAD') { $ctx.Response.OutputStream.Write($b, 0, $b.Length) }   # a HEAD probe (e.g. from a launcher) gets headers only
}
function Send-Json($ctx, $obj) {
  # an empty list must become "[]" (ConvertTo-Json gives nothing for an empty array in PowerShell 5.1)
  Send-Raw $ctx $(if ($null -eq $obj -or @($obj).Count -eq 0) { '[]' } else { ConvertTo-Json -InputObject @($obj) -Depth 4 -Compress })
}
function Get-HistoryDir($name) { Join-Path $root ('history\' + [IO.Path]::GetFileNameWithoutExtension($name)) }
function Get-Entries($files) {
  @($files | Where-Object { $_ } | ForEach-Object { [ordered]@{ name = $_.Name; size = $_.Length; modified = $_.LastWriteTime.ToString('yyyy-MM-dd HH:mm') } })
}

while ($l.IsListening) {
  $ctx = $l.GetContext()
  try {
    $req = $ctx.Request
    $path = [Uri]::UnescapeDataString($req.Url.AbsolutePath.TrimStart('/'))
    if ($path -eq '') { $path = 'figure-editor.html' }
    $full = [IO.Path]::GetFullPath((Join-Path $root $path))
    # writes are accepted from the editor (same origin) and from local tools, never from a web page on another site
    # (a browser marks such requests with Sec-Fetch-Site: cross-site and an Origin that is not localhost)
    $origin = $req.Headers['Origin']; $site = $req.Headers['Sec-Fetch-Site']
    $foreign = ($site -eq 'cross-site') -or ($origin -and ($origin -notmatch '^https?://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$') -and ($origin -ne ('http://' + $req.Headers['Host'])))
    if ($req.HttpMethod -eq 'POST' -and $foreign) { $ctx.Response.StatusCode = 403; $ctx.Response.Close(); continue }

    if ($path -eq 'api/files') {
      # ?scope=active (root, default) | archive | trash | examples
      $scope = (Get-Q $req 'scope')
      $dir = if ($scope -eq 'archive' -or $scope -eq 'trash' -or $scope -eq 'examples') { Join-Path $root $scope } else { $root }
      $list = if (Test-Path -LiteralPath $dir) { Get-ChildItem -LiteralPath $dir -Filter *.json -File | Sort-Object Name } else { @() }
      Send-Json $ctx (Get-Entries $list)
    } elseif ($req.HttpMethod -eq 'POST' -and $path -eq 'api/move') {
      # move a figure between active (root), archive\ and trash\
      $f = (Get-Q $req 'file'); $from = (Get-Q $req 'from'); $to = (Get-Q $req 'to')
      $fromDir = if ($from -eq 'archive' -or $from -eq 'trash') { Join-Path $root $from } else { $root }
      $toDir = if ($to -eq 'archive' -or $to -eq 'trash') { Join-Path $root $to } else { $root }
      $srcP = Join-Path $fromDir $f; $dstP = Join-Path $toDir $f
      if ($f -match $nameRe -and $fromDir -ne $toDir -and (Test-Path -LiteralPath $srcP) -and -not (Test-Path -LiteralPath $dstP)) {
        New-Item -ItemType Directory -Force $toDir | Out-Null; Move-Item -LiteralPath $srcP -Destination $dstP; $ctx.Response.StatusCode = 204
      } else { $ctx.Response.StatusCode = 409 }
    } elseif ($req.HttpMethod -eq 'POST' -and $path -eq 'api/delete') {
      # permanent delete: only possible from trash\ (the figure's history goes with it)
      $f = (Get-Q $req 'file'); $p = Join-Path (Join-Path $root 'trash') $f
      if ($f -match $nameRe -and (Test-Path -LiteralPath $p)) {
        Remove-Item -LiteralPath $p; $h = Get-HistoryDir $f; if (Test-Path -LiteralPath $h) { Remove-Item -LiteralPath $h -Recurse }; $ctx.Response.StatusCode = 204
      } else { $ctx.Response.StatusCode = 409 }
    } elseif ($path -eq 'api/history') {
      $f = (Get-Q $req 'file'); $dir = Get-HistoryDir $f
      if ($f -match $nameRe -and (Test-Path -LiteralPath $dir)) { Send-Json $ctx (Get-Entries (Get-ChildItem -LiteralPath $dir -Filter *.json -File | Sort-Object LastWriteTime -Descending)) }
      else { Send-Json $ctx @() }
    } elseif ($req.HttpMethod -eq 'POST' -and $path -eq 'api/rename') {
      $from = (Get-Q $req 'from'); $to = (Get-Q $req 'to')
      $src = Join-Path $root $from; $dst = Join-Path $root $to
      if ($from -match $nameRe -and $to -match $nameRe -and (Test-Path -LiteralPath $src) -and -not (Test-Path -LiteralPath $dst)) {
        Move-Item -LiteralPath $src -Destination $dst
        $hs = Get-HistoryDir $from; $hd = Get-HistoryDir $to
        if ((Test-Path -LiteralPath $hs) -and -not (Test-Path -LiteralPath $hd)) { Move-Item -LiteralPath $hs -Destination $hd }
        $ctx.Response.StatusCode = 204
      } else { $ctx.Response.StatusCode = 409 }
    } elseif ($req.HttpMethod -eq 'POST' -and $path -match $nameRe) {
      $reader = New-Object IO.StreamReader($req.InputStream, [Text.Encoding]::UTF8)
      $text = $reader.ReadToEnd()
      if ($text.Trim() -eq '') { $ctx.Response.StatusCode = 400; $ctx.Response.Close(); continue }   # an empty body (a broken tool or upload) would wipe the figure
      # made from an older version of the file than the one there now: refused, with the current file (see Get-ETag)
      $base = $req.Headers['If-Match']; if (-not $base) { $base = Get-Q $req 'base' }
      if ($base -and $base.Trim() -eq '*') { $base = $null }   # If-Match: * = "any version" (HTTP): no check
      if ($base -and (Test-Path -LiteralPath $full)) {
        $cur = [IO.File]::ReadAllBytes($full); $tag = Get-ETag $cur
        if ((($base.Trim() -replace '^W/', '').Trim('"')) -ne $tag.Trim('"')) {
          if (-not $req.Headers['If-Match']) {   # sent by a page that was closing (?base=): it cannot merge any more, so its last change is kept in the version history
            $hdir = Get-HistoryDir $path; New-Item -ItemType Directory -Force $hdir | Out-Null
            [IO.File]::WriteAllText((Join-Path $hdir ((Get-Date).ToString('yyyy-MM-dd_HH-mm-ss') + '-closed-window.json')), $text, (New-Object Text.UTF8Encoding $false))
          }
          $ctx.Response.StatusCode = 409; $ctx.Response.ContentType = 'application/json; charset=utf-8'
          $ctx.Response.Headers.Add('ETag', $tag); $ctx.Response.Headers.Add('Cache-Control', 'no-store')
          $ctx.Response.ContentLength64 = $cur.Length; $ctx.Response.OutputStream.Write($cur, 0, $cur.Length); $ctx.Response.Close(); continue
        }
      }
      # snapshot the previous version first (at most one snapshot every 5 minutes per figure), keep the newest 60
      if (Test-Path -LiteralPath $full) {
        $hdir = Get-HistoryDir $path
        New-Item -ItemType Directory -Force $hdir | Out-Null
        $last = Get-ChildItem -LiteralPath $hdir -Filter *.json -File | Where-Object { $_.Name -notlike '*-closed-window.json' } | Sort-Object CreationTime -Descending | Select-Object -First 1   # a closed window's kept change is no snapshot: it must not hold back the next one
        if (-not $last -or ((Get-Date) - $last.CreationTime).TotalMinutes -ge 5) {
          Copy-Item -LiteralPath $full -Destination (Join-Path $hdir ((Get-Item -LiteralPath $full).LastWriteTime.ToString('yyyy-MM-dd_HH-mm-ss') + '.json')) -Force
          Get-ChildItem -LiteralPath $hdir -Filter *.json -File | Sort-Object LastWriteTime -Descending | Select-Object -Skip 60 | Remove-Item
        }
      }
      # write a temporary file and swap it in: a full disk or a crash mid-write no longer leaves a truncated figure
      $tmp = $full + '.tmp'
      $bytes = (New-Object Text.UTF8Encoding $false).GetBytes($text)
      [IO.File]::WriteAllBytes($tmp, $bytes)
      if (Test-Path -LiteralPath $full) { try { [IO.File]::Replace($tmp, $full, $null) } catch { [IO.File]::Copy($tmp, $full, $true); Remove-Item -LiteralPath $tmp } }
      else { [IO.File]::Move($tmp, $full) }
      $ctx.Response.Headers.Add('ETag', (Get-ETag $bytes))   # the new version, for the editor's next save
      $ctx.Response.StatusCode = 204
    } elseif ($req.HttpMethod -eq 'POST' -and $path -match '^(exports|assets)/[\w.\-]+\.(png|svg|jpg|jpeg|gif|webp|pptx|pdf|tif|tiff|json)$') {
      # exports (PNG/SVG/PDF/TIFF/PPTX), inserted images and the user's own icon library (assets/my-icons.json) are written as files into their folder
      New-Item -ItemType Directory -Force (Join-Path $root $Matches[1]) | Out-Null
      $ms = New-Object IO.MemoryStream
      $req.InputStream.CopyTo($ms)
      [IO.File]::WriteAllBytes($full, $ms.ToArray())
      $ctx.Response.StatusCode = 204
    } elseif ($req.HttpMethod -eq 'POST') {
      $ctx.Response.StatusCode = 405   # nothing else can be written to
    } elseif ($full.StartsWith($root.TrimEnd('\') + '\') -and (Test-Path -LiteralPath $full -PathType Leaf)) {   # -LiteralPath: [ ] in a folder name are not wildcards
      $bytes = [IO.File]::ReadAllBytes($full)
      $ext = [IO.Path]::GetExtension($full).ToLower()
      $ctx.Response.ContentType = if ($types[$ext]) { $types[$ext] } else { 'application/octet-stream' }
      $ctx.Response.Headers.Add('Cache-Control','no-store')
      $same = $false
      if ($path -match $nameRe) {   # a figure: its version (see Get-ETag)
        $etg = Get-ETag $bytes; $ctx.Response.Headers.Add('ETag', $etg)
        # the editor's poll sends the version it has (If-None-Match): unchanged = 304 without the file (as serve.py)
        $inm = $req.Headers['If-None-Match']
        if ($inm) { $seen = @($inm.Split(',') | ForEach-Object { $_.Trim() -replace '^W/', '' } | Where-Object { $_ }); $same = ($seen -contains $etg) -or ($seen -contains '*') }
      }
      if ($same) { $ctx.Response.StatusCode = 304 }
      else {
        $ctx.Response.ContentLength64 = $bytes.Length
        if ($req.HttpMethod -ne 'HEAD') { $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length) }
      }
    } else { $ctx.Response.StatusCode = 404 }
  } catch {
    Write-Host "Request failed: $($_.Exception.Message)"
    try { $ctx.Response.StatusCode = 500 } catch {}
  }
  try { $ctx.Response.Close() } catch {}
}
