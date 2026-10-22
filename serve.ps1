# SiliCoDraw server: http://localhost:<port>/
#  - serves the editor and the figure files in this folder
#  - saves figures (POST <name>.json); before overwriting, keeps a snapshot in history\<name>\ (at most every 5 minutes)
#  - writes exports (POST exports/<name>.png|svg|pptx)
#  - api/files, api/history?file=..., api/rename, api/move, api/delete for the editor's file menu
param([int]$port = 8770)
$root = $PSScriptRoot
$nameRe = '^[\w.\-]+\.json$'
$l = New-Object System.Net.HttpListener
$l.Prefixes.Add("http://localhost:$port/")
try { $l.Start() } catch {
  Write-Host "Could not start on port ${port}: it is probably already running (then just use http://localhost:$port/)."
  Start-Sleep -Seconds 5; exit 1
}
Write-Host "SiliCoDraw is running at http://localhost:$port/  (close this window to stop it)"
$types = @{ '.html'='text/html; charset=utf-8'; '.js'='text/javascript'; '.css'='text/css'; '.json'='application/json; charset=utf-8'; '.svg'='image/svg+xml'; '.png'='image/png'; '.jpg'='image/jpeg'; '.jpeg'='image/jpeg'; '.gif'='image/gif'; '.webp'='image/webp'; '.pptx'='application/vnd.openxmlformats-officedocument.presentationml.presentation' }

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
      $scope = $req.QueryString['scope']
      $dir = if ($scope -eq 'archive' -or $scope -eq 'trash' -or $scope -eq 'examples') { Join-Path $root $scope } else { $root }
      $list = if (Test-Path $dir) { Get-ChildItem -Path $dir -Filter *.json -File | Sort-Object Name } else { @() }
      Send-Json $ctx (Get-Entries $list)
    } elseif ($req.HttpMethod -eq 'POST' -and $path -eq 'api/move') {
      # move a figure between active (root), archive\ and trash\
      $f = $req.QueryString['file']; $from = $req.QueryString['from']; $to = $req.QueryString['to']
      $fromDir = if ($from -eq 'archive' -or $from -eq 'trash') { Join-Path $root $from } else { $root }
      $toDir = if ($to -eq 'archive' -or $to -eq 'trash') { Join-Path $root $to } else { $root }
      $srcP = Join-Path $fromDir $f; $dstP = Join-Path $toDir $f
      if ($f -match $nameRe -and $fromDir -ne $toDir -and (Test-Path $srcP) -and -not (Test-Path $dstP)) {
        New-Item -ItemType Directory -Force $toDir | Out-Null; Move-Item $srcP $dstP; $ctx.Response.StatusCode = 204
      } else { $ctx.Response.StatusCode = 409 }
    } elseif ($req.HttpMethod -eq 'POST' -and $path -eq 'api/delete') {
      # permanent delete: only possible from trash\ (the figure's history goes with it)
      $f = $req.QueryString['file']; $p = Join-Path (Join-Path $root 'trash') $f
      if ($f -match $nameRe -and (Test-Path $p)) {
        Remove-Item $p; $h = Get-HistoryDir $f; if (Test-Path $h) { Remove-Item $h -Recurse }; $ctx.Response.StatusCode = 204
      } else { $ctx.Response.StatusCode = 409 }
    } elseif ($path -eq 'api/history') {
      $f = $req.QueryString['file']; $dir = Get-HistoryDir $f
      if ($f -match $nameRe -and (Test-Path $dir)) { Send-Json $ctx (Get-Entries (Get-ChildItem $dir -Filter *.json -File | Sort-Object LastWriteTime -Descending)) }
      else { Send-Json $ctx @() }
    } elseif ($req.HttpMethod -eq 'POST' -and $path -eq 'api/rename') {
      $from = $req.QueryString['from']; $to = $req.QueryString['to']
      $src = Join-Path $root $from; $dst = Join-Path $root $to
      if ($from -match $nameRe -and $to -match $nameRe -and (Test-Path $src) -and -not (Test-Path $dst)) {
        Move-Item $src $dst
        $hs = Get-HistoryDir $from; $hd = Get-HistoryDir $to
        if ((Test-Path $hs) -and -not (Test-Path $hd)) { Move-Item $hs $hd }
        $ctx.Response.StatusCode = 204
      } else { $ctx.Response.StatusCode = 409 }
    } elseif ($req.HttpMethod -eq 'POST' -and $path -match $nameRe) {
      # snapshot the previous version first (at most one snapshot every 5 minutes per figure), keep the newest 60
      if (Test-Path $full) {
        $hdir = Get-HistoryDir $path
        New-Item -ItemType Directory -Force $hdir | Out-Null
        $last = Get-ChildItem $hdir -Filter *.json -File | Sort-Object CreationTime -Descending | Select-Object -First 1
        if (-not $last -or ((Get-Date) - $last.CreationTime).TotalMinutes -ge 5) {
          Copy-Item $full (Join-Path $hdir ((Get-Item $full).LastWriteTime.ToString('yyyy-MM-dd_HH-mm-ss') + '.json')) -Force
          Get-ChildItem $hdir -Filter *.json -File | Sort-Object LastWriteTime -Descending | Select-Object -Skip 60 | Remove-Item
        }
      }
      $reader = New-Object IO.StreamReader($req.InputStream, [Text.Encoding]::UTF8)
      [IO.File]::WriteAllText($full, $reader.ReadToEnd(), (New-Object Text.UTF8Encoding $false))
      $ctx.Response.StatusCode = 204
    } elseif ($req.HttpMethod -eq 'POST' -and $path -match '^(exports|assets)/[\w.\-]+\.(png|svg|jpg|jpeg|gif|webp|pptx|json)$') {
      # exports (PNG/SVG/PPTX), inserted images and the user's own icon library (assets/my-icons.json) are written as files into their folder
      New-Item -ItemType Directory -Force (Join-Path $root $Matches[1]) | Out-Null
      $ms = New-Object IO.MemoryStream
      $req.InputStream.CopyTo($ms)
      [IO.File]::WriteAllBytes($full, $ms.ToArray())
      $ctx.Response.StatusCode = 204
    } elseif ($full.StartsWith($root) -and (Test-Path $full -PathType Leaf)) {
      $bytes = [IO.File]::ReadAllBytes($full)
      $ext = [IO.Path]::GetExtension($full).ToLower()
      $ctx.Response.ContentType = if ($types[$ext]) { $types[$ext] } else { 'application/octet-stream' }
      $ctx.Response.Headers.Add('Cache-Control','no-store')
      $ctx.Response.ContentLength64 = $bytes.Length
      if ($req.HttpMethod -ne 'HEAD') { $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length) }
    } else { $ctx.Response.StatusCode = 404 }
  } catch {
    Write-Host "Request failed: $($_.Exception.Message)"
    try { $ctx.Response.StatusCode = 500 } catch {}
  }
  try { $ctx.Response.Close() } catch {}
}
