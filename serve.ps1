# SiliCoDraw server: http://localhost:<port>/
#  - serves the editor and the figure files in this folder
#  - saves figures (POST <name>.json); before overwriting, keeps a snapshot in history\<name>\ (at most every 5 minutes)
#  - sends a figure with its version (ETag); a save made from an older version (If-Match) is refused with 409 and the current file, so the editor merges;
#    a read that sends the version it has (If-None-Match) gets 304 when unchanged
#  - writes exports (POST exports/<name>.png|svg|pdf|tif|pptx)
#  - api/files, api/history?file=..., api/rename, api/move, api/delete for the editor's file menu
#  - api/storage: the figures folder (figures, archive\, trash\, history\, assets\, exports\), this folder by default, or any other folder such as
#    one synced by Dropbox, OneDrive, Google Drive, iCloud Drive or Box; the program itself stays here. -data <folder> sets it for this run only
#  - api/quit (POST): stops the server (File > Quit SiliCoDraw in the editor)
#  - writes (every POST) are accepted only from the editor's own page (Origin = this server's exact address and port) or from a
#    tool that sends no Origin (curl, scripts, the tests); never from another site or another port of this computer
param([int]$port = 8770, [string]$data = '')
# a PC where IT policy restricts PowerShell (ConstrainedLanguage: AppLocker, WDAC) cannot run this server: say so instead of failing on the first .NET call
if ($ExecutionContext.SessionState.LanguageMode -ne 'FullLanguage') {
  Write-Host 'Your IT policy blocks the local SiliCoDraw server on this computer (PowerShell runs in restricted mode).'
  Write-Host 'Use SiliCoDraw in your browser instead: https://silicodraw.com'
  Start-Sleep -Seconds 15; exit 1
}
try { $Host.UI.RawUI.WindowTitle = "SiliCoDraw server (port $port)" } catch {}   # the name the launcher's messages give (the taskbar button)
$root = $PSScriptRoot
$config = Join-Path $root '.silicodraw-folder'   # the figures folder chosen in the editor (one line); never replaced by the updater
$dataFixed = [bool]$data
if ($data) { New-Item -ItemType Directory -Force $data | Out-Null; $data = (Resolve-Path -LiteralPath $data).ProviderPath.TrimEnd('\') }
else {
  $data = $root
  if (Test-Path -LiteralPath $config) {
    $chosen = ([IO.File]::ReadAllText($config)).Trim()
    if ($chosen) { $data = $chosen.TrimEnd('\'); if (-not (Test-Path -LiteralPath $chosen -PathType Container)) { Write-Host "The figures folder cannot be reached at the moment: $chosen" } }   # never a new empty folder in its place: figures wait for it, and the editor says so
  }
}
$nameRe = '^[\w\-][\w.\-]*\.json$'   # (no name starting with a dot: ...json made the figures folder its own history folder, and deleting it emptied the folder)
$l = New-Object System.Net.HttpListener
$l.Prefixes.Add("http://localhost:$port/")
try { $l.Start() } catch {
  # started twice (the launcher double-clicked again): if SiliCoDraw already answers there, that is fine
  $running = $false
  try { $running = (Invoke-WebRequest -Uri "http://localhost:$port/api/storage?brief=1" -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200 } catch {}
  if ($running) { Write-Host "SiliCoDraw is already running at http://localhost:$port/"; Start-Sleep -Seconds 3; exit 0 }
  Write-Host "Could not start on port ${port}: another program uses it. Close that program and try again."
  Start-Sleep -Seconds 8; exit 1
}
Write-Host "SiliCoDraw is running at http://localhost:$port/  (to stop it: File > Quit SiliCoDraw in the editor, or close this window)"
$quit = $false   # set by POST api/quit: the loop ends after that answer
# one request at a time: a tab that stops reading must not hold up the others for hours (the default minimum is 150 bytes/s)
try { $l.TimeoutManager.MinSendBytesPerSecond = 10000 } catch {}
$types = @{ '.html'='text/html; charset=utf-8'; '.js'='text/javascript'; '.css'='text/css'; '.json'='application/json; charset=utf-8'; '.svg'='image/svg+xml; charset=utf-8'; '.png'='image/png'; '.jpg'='image/jpeg'; '.jpeg'='image/jpeg'; '.gif'='image/gif'; '.webp'='image/webp'; '.md'='text/markdown; charset=utf-8'; '.txt'='text/plain; charset=utf-8'; '.pptx'='application/vnd.openxmlformats-officedocument.presentationml.presentation'; '.pdf'='application/pdf'; '.tif'='image/tiff'; '.tiff'='image/tiff'; '.ico'='image/x-icon'; '.icns'='image/icns' }
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
function Get-HistoryDir($name) { Join-Path $data ('history\' + [IO.Path]::GetFileNameWithoutExtension($name)) }
$dataDirs = @('archive', 'trash', 'history', 'assets', 'exports')
# files of the figures folder (figures, archive/, trash/, history/, assets/, exports/) are the user's data, not the program: a picture that came in
# with a .zip or through a sync folder may be an SVG or HTML with a script, and opened as a page it would run as the editor's own origin (and
# pass the write rule). They are served sandboxed (no scripts, a unique origin), never sniffed; a PDF is left out of the sandbox (browsers
# refuse to show a PDF in one) and runs no page script anyway. <img> / <image> use is unaffected. The same headers as serve.py (USER_CSP).
$userCsp = "sandbox; default-src 'none'; img-src data: 'self'; style-src 'unsafe-inline'; font-src data:"
# the editor's own pages (the program's .html files) carry a Content-Security-Policy, the same as serve.py (PAGE_CSP): only the page's own scripts
# run (its inline scripts by their hash, worked out from the file as it is served, and lib/), so markup that a figure smuggled in can run nothing
# (no handler attribute, no javascript: link), and nothing is sent anywhere but this server and the reference look-up services (2026-11-17).
# 'unsafe-eval': MathJax and PptxGenJS build functions from text; injected markup cannot reach that without running first.
$pageCsp = "default-src 'self'; script-src 'self' __HASHES__ 'unsafe-eval' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' data: blob:; connect-src 'self' https://api.crossref.org https://api.datacite.org https://eutils.ncbi.nlm.nih.gov https://export.arxiv.org https://cdnjs.cloudflare.com https://cdn.jsdelivr.net; frame-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'"
$cspMemo = @{}
function Get-PageCsp($full, $bytes) {
  $key = "$full|$($bytes.Length)|$([IO.File]::GetLastWriteTimeUtc($full).Ticks)"
  if (-not $cspMemo.ContainsKey($key)) {
    $text = [Text.Encoding]::UTF8.GetString($bytes); if ($text.Length -and $text[0] -eq [char]0xFEFF) { $text = $text.Substring(1) }
    # each inline <script> as the browser reads it (line ends as \n): its SHA-256
    $hashes = @(foreach ($m in [regex]::Matches($text, '(?is)<script(?![^>]*\bsrc\s*=)[^>]*>(.*?)</script\s*>')) { $body = $m.Groups[1].Value.Replace("`r`n", "`n").Replace("`r", "`n"); "'sha256-" + [Convert]::ToBase64String($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($body))) + "'" })
    if ($cspMemo.Count -gt 20) { $cspMemo.Clear() }
    $cspMemo[$key] = $pageCsp.Replace('__HASHES__', ($hashes -join ' '))
  }
  $cspMemo[$key]
}
# what a page is never given, even though it lies in the program folder: anything under a name starting with a dot (.git, .silicodraw-folder),
# the private development material (dev/ except the website build dev/web/, outreach/) and the updater's figure backups (updates/); and nothing
# reached through a link (a symbolic link or junction could lead out of the folder: serve.py resolves links and refuses what lies outside)
function Test-Withheld($rel) {
  $segs = @($rel -split '[\\/]' | Where-Object { $_ })
  if (@($segs | Where-Object { $_.StartsWith('.') }).Count) { return $true }
  ($segs.Count -and @('dev', 'outreach', 'updates') -contains $segs[0] -and -not ($segs.Count -gt 2 -and $segs[0] -eq 'dev' -and $segs[1] -eq 'web'))
}
# a page that asks to keep the figures in another folder (File > Where figures are kept...) is confirmed by the person at this computer, in a
# window of this server that no page can answer (as serve.py's confirm_folder): code smuggled into the page could otherwise point the figures
# folder at any folder and read its files (2026-11-17). A tool (no Origin: curl, a script, an agent) is not asked, as for every write; the test
# servers of browser.ps1 / browser.sh set SILICODRAW_NO_CONFIRM. No is the default button.
function Confirm-Folder($dir) {
  if ($env:SILICODRAW_NO_CONFIRM) { return $true }
  try {
    Add-Type -AssemblyName System.Windows.Forms, System.Drawing
    $f = New-Object Windows.Forms.Form; $f.TopMost = $true; $f.ShowInTaskbar = $false; $f.StartPosition = 'Manual'; $f.Location = New-Object Drawing.Point(-3000, -3000); $f.Size = New-Object Drawing.Size(1, 1); $f.Show(); $f.Activate()
    $r = [Windows.Forms.MessageBox]::Show($f, "Keep your SiliCoDraw figures in this folder?`n`n$dir`n`nSay Yes only if you chose this folder yourself, just now, in SiliCoDraw (File > Where figures are kept...).", 'SiliCoDraw: where figures are kept', [Windows.Forms.MessageBoxButtons]::YesNo, [Windows.Forms.MessageBoxIcon]::Question, [Windows.Forms.MessageBoxDefaultButton]::Button2)
    $f.Close(); $f.Dispose()
    return ($r -eq [Windows.Forms.DialogResult]::Yes)
  } catch { return $false }
}
function Test-Linked($base, $rel) {
  $p = $base.TrimEnd('\')
  foreach ($s in @($rel -split '[\\/]' | Where-Object { $_ })) { $p = Join-Path $p $s; try { $it = Get-Item -LiteralPath $p -Force -ErrorAction Stop; if (@('SymbolicLink', 'Junction') -contains "$($it.LinkType)") { return $true } } catch { return $false } }
  $false
}
# where a path of the address lives: a figure and its data in the figures folder, everything else with the program
# a chosen folder that cannot be reached at the moment (an unplugged drive, a sync app stopped): figures are then refused with 503, and never read from or written to anywhere else
function Test-DataGone { ($data -ne $root.TrimEnd('\')) -and -not (Test-Path -LiteralPath $data -PathType Container) }
function Get-Home($path) { if ($path -match $nameRe -or $dataDirs -contains ($path -split '/')[0]) { $data } else { $root } }
# the folders of sync apps found on this computer. Dropbox says where it is in its info.json
function Get-CloudFolders {
  $found = New-Object Collections.ArrayList; $me = [Environment]::GetFolderPath('UserProfile')
  $add = { param($name, $p) if ($p -and (Test-Path -LiteralPath $p -PathType Container)) { $full = (Resolve-Path -LiteralPath $p).ProviderPath.TrimEnd('\'); if (-not (@($found | Where-Object { $_.path -eq $full }).Count)) { [void]$found.Add([ordered]@{ name = $name; path = $full }) } } }
  foreach ($info in @((Join-Path "$env:APPDATA" 'Dropbox\info.json'), (Join-Path "$env:LOCALAPPDATA" 'Dropbox\info.json'))) {
    try { if (Test-Path -LiteralPath $info) { $j = [IO.File]::ReadAllText($info) | ConvertFrom-Json; foreach ($acc in $j.PSObject.Properties) { & $add 'Dropbox' $acc.Value.path } } } catch {}
  }
  & $add 'iCloud Drive' (Join-Path $me 'iCloudDrive')
  foreach ($v in @($env:OneDrive, $env:OneDriveConsumer, $env:OneDriveCommercial)) { & $add 'OneDrive' $v }
  foreach ($d in @(Get-ChildItem -LiteralPath $me -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -like 'OneDrive*' })) { & $add 'OneDrive' $d.FullName }
  foreach ($d in @(Get-ChildItem -LiteralPath $me -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -like 'Dropbox*' })) { & $add 'Dropbox' $d.FullName }
  foreach ($rel in @('Google Drive\My Drive', 'Google Drive', 'GoogleDrive')) { & $add 'Google Drive' (Join-Path $me $rel) }
  foreach ($c in @(Get-PSDrive -PSProvider FileSystem -ErrorAction SilentlyContinue)) { if ($c.Root -notlike 'C:*') { & $add 'Google Drive' (Join-Path $c.Root 'My Drive') } }
  foreach ($rel in @('Box', 'Box Sync')) { & $add 'Box' (Join-Path $me $rel) }
  $found.ToArray()
}
# copies the figures to a new folder without replacing anything there: the number copied, and the names that differ there
function Copy-Missing($src, $dst) {
  $copied = 0; $differ = @(); $skipped = @()
  $roots = @(Get-ChildItem -LiteralPath $src -Filter *.json -File -ErrorAction Stop)
  $items = @($roots | Where-Object { $_.Name -match $nameRe }); $skipped = @($roots | Where-Object { $_.Name -notmatch $nameRe } | ForEach-Object { $_.Name })
  foreach ($d in @('archive', 'trash', 'history', 'assets')) { $p = Join-Path $src $d; if (Test-Path -LiteralPath $p) { $items += @(Get-ChildItem -LiteralPath $p -File -Recurse -ErrorAction Stop) } }
  foreach ($it in $items) {
    $rel = $it.FullName.Substring($src.TrimEnd('\').Length + 1); $b = Join-Path $dst $rel
    if (Test-Path -LiteralPath $b) { if ((Get-ETag ([IO.File]::ReadAllBytes($it.FullName))) -ne (Get-ETag ([IO.File]::ReadAllBytes($b)))) { $differ += $rel.Replace('\', '/') }; continue }
    New-Item -ItemType Directory -Force (Split-Path $b -Parent) -ErrorAction Stop | Out-Null; $tmpB = "$b.tmp"; try { Copy-Item -LiteralPath $it.FullName -Destination $tmpB -ErrorAction Stop; [IO.File]::Move($tmpB, $b) } catch { Remove-Item -LiteralPath $tmpB -Force -ErrorAction SilentlyContinue; throw }; $copied++   # (Stop: one that fails refuses the switch; it was counted as copied. A temporary name: no half figure, which a second try would count as already there)
  }
  @{ copied = $copied; differ = @($differ); skipped = @($skipped) }
}
function Get-Entries($files) {
  @($files | Where-Object { $_ } | ForEach-Object { [ordered]@{ name = $_.Name; size = $_.Length; modified = $_.LastWriteTime.ToString('yyyy-MM-dd HH:mm') } })
}

while ($l.IsListening) {
  $ctx = $l.GetContext()
  try {
    $req = $ctx.Request
    $path = [Uri]::UnescapeDataString($req.Url.AbsolutePath.TrimStart('/'))
    if ($path -eq '') { $path = 'figure-editor.html' }
    $scopeQ = Get-Q $req 'scope'
    $isData = ($path -match $nameRe) -or ($dataDirs -contains ($path -split '/')[0]) -or (@('api/move', 'api/delete', 'api/rename', 'api/history') -contains $path) -or ($path -eq 'api/files' -and $scopeQ -ne 'examples')
    $homeDir = Get-Home $path
    $full = [IO.Path]::GetFullPath((Join-Path $homeDir $path))
    # writes are accepted from the editor's own page and from local tools, never from another web page (the same rule as serve.py):
    # a browser names the page that sends a request in Origin, and it must be this server's exact address: http, a local name and
    # this port (a page on another port of this computer, such as a dev server or another app, is another site's page, though the
    # browser calls it "same-site"); Sec-Fetch-Site, when sent, must say same-origin. A request with neither header comes from a tool
    # (curl, a script, an agent, the tests) and is accepted as before. The Host check (a name other than this computer's) is HttpListener's own: 400
    $origin = $req.Headers['Origin']; $site = $req.Headers['Sec-Fetch-Site']; $hostH = "$($req.Headers['Host'])"
    $ownHost = $hostH -match ('^(localhost|127\.0\.0\.1|\[::1\])' + $(if ($port -eq 80) { '(:80)?' } else { ":$port" }) + '$')
    $foreign = ($site -and @('same-origin', 'none') -notcontains $site) -or ($origin -and -not ($ownHost -and $origin -eq ('http://' + $hostH)))
    if (@('GET', 'HEAD', 'POST') -notcontains $req.HttpMethod) { $ctx.Response.StatusCode = 405; $ctx.Response.Close(); continue }   # PUT, DELETE, OPTIONS...: nothing is changed in any other way
    if ($req.HttpMethod -eq 'POST' -and $foreign) { $ctx.Response.StatusCode = 403; $ctx.Response.Close(); continue }

    if ($req.HttpMethod -eq 'POST' -and $path -eq 'api/quit') {
      # File > Quit SiliCoDraw: the editor saved first; answered, then the server stops (never on its own: no idle timeout)
      $quit = $true; $ctx.Response.StatusCode = 204; $ctx.Response.Close(); break
    }
    if ($isData -and (Test-DataGone)) { $ctx.Response.StatusCode = 503; $ctx.Response.Close(); continue }   # (after the origin check, as in serve.py)

    if ($path -eq 'api/files') {
      # ?scope=active (root, default) | archive | trash | examples
      $scope = (Get-Q $req 'scope')
      $dir = if ($scope -eq 'examples') { Join-Path $root 'examples' } elseif ($scope -eq 'archive' -or $scope -eq 'trash') { Join-Path $data $scope } else { $data }
      $list = if (Test-Path -LiteralPath $dir) { Get-ChildItem -LiteralPath $dir -Filter *.json -File | Sort-Object Name } else { @() }
      Send-Json $ctx (Get-Entries $list)
    } elseif ($path -eq 'api/storage' -and $req.HttpMethod -ne 'POST') {
      $opts = @(); if ($null -eq (Get-Q $req 'brief')) { $opts = @(Get-CloudFolders) }   # brief: no looking around the computer's drives (this server answers one request at a time, and a dead network drive can take long)
      Send-Raw $ctx (ConvertTo-Json -InputObject ([ordered]@{ dir = $data; isDefault = ($data -eq $root.TrimEnd('\')); missing = $(if (Test-DataGone) { $data } else { '' }); canChange = (-not $dataFixed); program = $root; options = $opts }) -Depth 4 -Compress)
    } elseif ($req.HttpMethod -eq 'POST' -and $path -eq 'api/storage') {
      # ?dir=<folder> (empty: back to this folder) &copy=1: the figures come along, nothing there is replaced
      $why = ''
      # only the editor's own page: another page on this computer (any localhost port) could send every figure to a folder of its choice
      if ($dataFixed -or ($origin -and $origin -ne ('http://' + $req.Headers['Host'])) -or ($site -and @('same-origin', 'none') -notcontains $site)) { $ctx.Response.StatusCode = 403 }
      else {
        try {
          $want = "$(Get-Q $req 'dir')".Trim().Trim('"'); $folder = $root.TrimEnd('\')
          if ($want) {
            if ($want.StartsWith('~')) { $want = [Environment]::GetFolderPath('UserProfile') + $want.Substring(1) }
            if (-not [IO.Path]::IsPathRooted($want)) { $why = 'Give the whole path of the folder.' }
            else { $folder = [IO.Path]::GetFullPath($want).TrimEnd('\'); if ($folder -match '^[A-Za-z]:$' -or $folder -eq '') { $why = 'Choose a folder, not a whole drive.' } }
          }
          if (-not $why -and $folder -ne $root.TrimEnd('\') -and $folder -ne $data -and ($origin -or $site) -and -not (Confirm-Folder $folder)) { $why = 'Not changed: the folder was not confirmed. SiliCoDraw asks in a window of its own (it may be behind the browser); say Yes there to use this folder.' }   # see Confirm-Folder
          if (-not $why) {
            if ($folder -ne $root.TrimEnd('\')) { New-Item -ItemType Directory -Force $folder -ErrorAction Stop | Out-Null; $probe = Join-Path $folder '.silicodraw-write-test'; [IO.File]::WriteAllText($probe, 'ok'); Remove-Item -LiteralPath $probe -ErrorAction Stop; $folder = (Resolve-Path -LiteralPath $folder).ProviderPath.TrimEnd('\') }
            $res = @{ copied = 0; differ = @(); skipped = @() }
            if ((Get-Q $req 'copy') -eq '1' -and $folder -ne $data -and -not (Test-DataGone)) { $res = Copy-Missing $data $folder }
            if ($folder -eq $root.TrimEnd('\')) { if (Test-Path -LiteralPath $config) { Remove-Item -LiteralPath $config -ErrorAction Stop } } else { [IO.File]::WriteAllText($config, $folder, (New-Object Text.UTF8Encoding $false)) }
            $data = $folder   # last: a failure changes nothing
            Send-Raw $ctx (ConvertTo-Json -InputObject ([ordered]@{ dir = $data; isDefault = ($data -eq $root.TrimEnd('\')); copied = $res.copied; differ = @($res.differ); skipped = @($res.skipped) }) -Depth 4 -Compress)
          }
        } catch { $why = "This folder cannot be used: $($_.Exception.Message)" }
        if ($why) { $ctx.Response.StatusCode = 400; $wb = [Text.Encoding]::UTF8.GetBytes($why); $ctx.Response.ContentType = 'text/plain; charset=utf-8'; $ctx.Response.ContentLength64 = $wb.Length; $ctx.Response.OutputStream.Write($wb, 0, $wb.Length) }
      }
    } elseif ($req.HttpMethod -eq 'POST' -and $path -eq 'api/move') {
      # move a figure between active (root), archive\ and trash\
      $f = (Get-Q $req 'file'); $from = (Get-Q $req 'from'); $to = (Get-Q $req 'to')
      $fromDir = if ($from -eq 'archive' -or $from -eq 'trash') { Join-Path $data $from } else { $data }
      $toDir = if ($to -eq 'archive' -or $to -eq 'trash') { Join-Path $data $to } else { $data }
      $srcP = Join-Path $fromDir $f; $dstP = Join-Path $toDir $f
      if ($f -match $nameRe -and $fromDir -ne $toDir -and (Test-Path -LiteralPath $srcP) -and -not (Test-Path -LiteralPath $dstP)) {
        New-Item -ItemType Directory -Force $toDir | Out-Null; Move-Item -LiteralPath $srcP -Destination $dstP; $ctx.Response.StatusCode = 204
      } else { $ctx.Response.StatusCode = 409 }
    } elseif ($req.HttpMethod -eq 'POST' -and $path -eq 'api/delete') {
      # permanent delete: only possible from trash\ (the figure's history goes with it, unless an active or archived figure has that name: the history is kept by name, so it is theirs)
      $f = (Get-Q $req 'file'); $p = Join-Path (Join-Path $data 'trash') $f
      if ($f -match $nameRe -and (Test-Path -LiteralPath $p)) {
        Remove-Item -LiteralPath $p
        if (-not (Test-Path -LiteralPath (Join-Path $data $f)) -and -not (Test-Path -LiteralPath (Join-Path (Join-Path $data 'archive') $f))) { $h = Get-HistoryDir $f; if (Test-Path -LiteralPath $h) { Remove-Item -LiteralPath $h -Recurse } }
        $ctx.Response.StatusCode = 204
      } else { $ctx.Response.StatusCode = 409 }
    } elseif ($path -eq 'api/history') {
      $f = (Get-Q $req 'file'); $dir = Get-HistoryDir $f
      if ($f -match $nameRe -and (Test-Path -LiteralPath $dir)) { Send-Json $ctx (Get-Entries (Get-ChildItem -LiteralPath $dir -Filter *.json -File | Sort-Object LastWriteTime -Descending)) }
      else { Send-Json $ctx @() }
    } elseif ($req.HttpMethod -eq 'POST' -and $path -eq 'api/rename') {
      $from = (Get-Q $req 'from'); $to = (Get-Q $req 'to')
      $src = Join-Path $data $from; $dst = Join-Path $data $to
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
          Copy-Item -LiteralPath $full -Destination (Join-Path $hdir ((Get-Item -LiteralPath $full).LastWriteTime.ToString('yyyy-MM-dd_HH-mm-ss') + '.json')) -Force -ErrorAction Stop   # (Stop: without its copy in the history a figure is not overwritten)
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
      # exports (PNG/SVG/PDF/TIFF/PPTX), inserted images, the user's own icon library (assets/my-icons.json) and the list of imported icon packs
      # (assets/icon-packs.json; the packs themselves, icon-expansions/, are program files and only read) are written as files into their folder
      New-Item -ItemType Directory -Force (Join-Path $data $Matches[1]) | Out-Null
      $ms = New-Object IO.MemoryStream
      $req.InputStream.CopyTo($ms)
      [IO.File]::WriteAllBytes($full, $ms.ToArray())
      $ctx.Response.StatusCode = 204
    } elseif ($req.HttpMethod -eq 'POST') {
      $ctx.Response.StatusCode = 405   # nothing else can be written to
    } elseif ($full.StartsWith($homeDir.TrimEnd('\') + '\') -and (Test-Path -LiteralPath $full -PathType Leaf) -and -not (($homeDir -eq $root -and (Test-Withheld $full.Substring($homeDir.TrimEnd('\').Length + 1))) -or (Test-Linked $homeDir $full.Substring($homeDir.TrimEnd('\').Length + 1)))) {   # -LiteralPath: [ ] in a folder name are not wildcards; Test-Withheld on the path as resolved (dev/web/../queue is dev/queue)
      $bytes = [IO.File]::ReadAllBytes($full)
      $ext = [IO.Path]::GetExtension($full).ToLower()
      $ctx.Response.ContentType = if ($types[$ext]) { $types[$ext] } else { 'application/octet-stream' }
      $ctx.Response.Headers.Add('Cache-Control','no-store')
      if ($path -match $nameRe -or $dataDirs -contains ($path -split '/')[0]) {   # a file of the figures folder (see $userCsp)
        $ctx.Response.Headers.Add('X-Content-Type-Options', 'nosniff')
        if ($ext -ne '.pdf') { $ctx.Response.Headers.Add('Content-Security-Policy', $userCsp) }
      } elseif ($ext -eq '.html') { $ctx.Response.Headers.Add('Content-Security-Policy', (Get-PageCsp $full $bytes)) }   # one of the program's pages (see $pageCsp)
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
    } else {
      $ctx.Response.StatusCode = 404
      if ($path -match $nameRe -and $data -ne $root.TrimEnd('\')) { $ctx.Response.Headers.Add('X-SiliCoDraw-Chosen', '1') }   # a figure not in a chosen folder: the editor does not put this browser's copy there by itself
    }
  } catch {
    # a tab reloaded or closed during an answer is routine and not printed: printing waits while text is selected in this window (a console's QuickEdit), and every other request waited with it
    $ex = $_.Exception; if ($ex.InnerException) { $ex = $ex.InnerException }
    if ($ex -isnot [Net.HttpListenerException]) { Write-Host "Request failed: $($_.Exception.Message)" }
    try { $ctx.Response.StatusCode = 500 } catch {}
  }
  try { $ctx.Response.Close() } catch {}
}
if ($quit) { try { $l.Stop(); $l.Close() } catch {}; Write-Host 'SiliCoDraw has stopped (File > Quit SiliCoDraw).' }
