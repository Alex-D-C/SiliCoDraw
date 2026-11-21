#!/usr/bin/env python3
"""SiliCoDraw server (cross-platform twin of serve.ps1).

    python3 serve.py              -> http://localhost:8770/
    python3 serve.py --port 9000
    python3 serve.py --host 0.0.0.0   (reachable on your network; see README "Privacy")
    python3 serve.py --data <folder>  (keep the figures in that folder for this run; File -> Where figures are kept... sets it for good)

What it does:
  * serves figure-editor.html and the files in this folder
  * saves figures   (POST <name>.json), keeping a snapshot in history/<name>/ at most every 5 minutes
  * sends a figure with its version (ETag); a save made from an older version (If-Match) is refused with 409 and
    the current file, so the editor merges; a read that sends the version it has (If-None-Match) gets 304 when unchanged
  * writes exports  (POST exports/<name>.png|svg|pdf|tif|pptx) and inserted images (POST assets/<name>.png|jpg|svg|...)
  * api/files, api/history?file=..., api/rename, api/move, api/delete   for the editor's File menu
  * api/storage: the figures folder (figures, archive/, trash/, history/, assets/, exports/), this folder by default, or any other
    folder such as one synced by Dropbox, OneDrive, Google Drive, iCloud Drive or Box; the program itself stays here
  * api/quit (POST): stops the server (File -> Quit SiliCoDraw in the editor)
  * writes (every POST) are accepted only from the editor's own page (Origin = this server's exact address and port) or from
    a tool that sends no Origin (curl, scripts, the tests); never from another site or another port of this computer
No dependencies beyond the Python 3 standard library.
"""
import sys
if sys.version_info < (3, 7):
    sys.exit('SiliCoDraw needs Python 3.7 or newer (this is %d.%d). Get it from https://www.python.org/downloads/' % sys.version_info[:2])
import argparse, glob, hashlib, json, os, re, shutil, socket, subprocess, threading, time, urllib.parse, urllib.request, webbrowser
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.realpath(os.path.dirname(os.path.abspath(__file__)))   # realpath: a folder reached through a symlink still works
NAME_RE = re.compile(r'^[\w\-][\w.\-]*\.json$')   # (no name starting with a dot: ...json had no name of its own for its history folder)
FILE_RE = re.compile(r'^(exports|assets)/[\w.\-]+\.(png|svg|jpg|jpeg|gif|webp|pptx|pdf|tif|tiff|json)$', re.I)   # exports, inserted images, the user's icon library, the list of imported icon packs (assets/icon-packs.json; the packs, icon-expansions/, are program files)
TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
         '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml; charset=utf-8', '.png': 'image/png',
         '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
         '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
         '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
         '.pdf': 'application/pdf', '.tif': 'image/tiff', '.tiff': 'image/tiff',
         '.ico': 'image/x-icon', '.icns': 'image/icns'}   # the app icons in brand/
SNAPSHOT_EVERY = 300   # seconds
ANY_HOST = False       # True when started with --host other than 127.0.0.1 (reachable from the network on purpose)
PORT = 8770            # this server's port: a write's Origin must name it (see Handler._origin_ok)
KEEP_SNAPSHOTS = 60
SAVE_LOCK = threading.Lock()   # a version check and the write after it are one step (requests run in threads)
CONFIG = os.path.join(ROOT, '.silicodraw-folder')   # the figures folder chosen in the editor (one line); never replaced by the updater
DATA = ROOT            # where the figures are kept (DATA_DIRS below them too); the program's own files are always in ROOT
DATA_DIRS = ('archive', 'trash', 'history', 'assets', 'exports')
DATA_FIXED = False     # started with --data: for this run only, not changed from the editor


def data_gone():
    """A chosen folder that cannot be reached at the moment (an unplugged drive, a sync app stopped). Figures are then refused with 503, and never
    read from or written to anywhere else: a figure is not "new" because its folder is away, and it comes back by itself."""
    return DATA != ROOT and not os.path.isdir(DATA)


def is_data_request(path, q):
    return bool(NAME_RE.match(path)) or path.split('/', 1)[0] in DATA_DIRS or path in ('api/move', 'api/delete', 'api/rename', 'api/history') or (path == 'api/files' and q.get('scope', [''])[0] != 'examples')


def icloud_away(full):
    """iCloud Drive on older macOS keeps a figure it has moved off this Mac as .<name>.icloud: the figure exists, so it is fetched, not treated as new."""
    mark = os.path.join(os.path.dirname(full), '.%s.icloud' % os.path.basename(full))
    if os.path.exists(full) or not os.path.exists(mark):
        return False
    try:
        subprocess.Popen(['brctl', 'download', full], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except OSError:
        pass
    return True


def locate(path):
    """Where a path of the address lives: a figure and its data in the figures folder, everything else with the program."""
    return DATA if NAME_RE.match(path) or path.split('/', 1)[0] in DATA_DIRS else ROOT


# Files of the figures folder (figures, archive/, trash/, history/, assets/, exports/) are the user's data, not the program: a picture
# that came in with a .zip or through a sync folder may be an SVG or HTML with a script, and opened as a page it would run as the
# editor's own origin (and pass the write rule). They are served sandboxed (no scripts, a unique origin), never sniffed; a PDF is
# left out of the sandbox (browsers refuse to show a PDF in one) and runs no page script anyway. <img> / <image> use is unaffected.
# The same headers as serve.ps1 ($userCsp).
USER_CSP = "sandbox; default-src 'none'; img-src data: 'self'; style-src 'unsafe-inline'; font-src data:"
# The editor's own pages (the program's .html files) carry a Content-Security-Policy, the same as serve.ps1 ($pageCsp): only the page's own
# scripts run (its inline scripts by their hash, worked out from the file as it is served, and lib/), so markup that a figure smuggled in can run
# nothing (no handler attribute, no javascript: link), and nothing is sent anywhere but this server and the reference look-up services (2026-11-17).
# 'unsafe-eval': MathJax and PptxGenJS build functions from text; injected markup cannot reach that without running first.
PAGE_CSP = ("default-src 'self'; script-src 'self' __HASHES__ 'unsafe-eval' https://cdn.jsdelivr.net/npm/mathjax@3.2.2/ https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/ https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/; "
            "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' data: blob:; "
            "connect-src 'self' https://api.crossref.org https://api.datacite.org https://eutils.ncbi.nlm.nih.gov https://export.arxiv.org https://cdn.jsdelivr.net/npm/mathjax@3.2.2/ https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/ https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/; "
            "frame-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'")
SCRIPT_RE = re.compile(r'<script(?![^>]*\bsrc\s*=)[^>]*>(.*?)</script\s*>', re.I | re.S)
_CSP_MEMO = {}


def page_csp(full, data):
    """PAGE_CSP with the SHA-256 of each inline <script> of this page, as the browser reads it (line ends as \\n)."""
    key = (full, len(data), os.path.getmtime(full))
    if key not in _CSP_MEMO:
        import base64
        text = data.decode('utf-8', 'replace')
        if text.startswith('﻿'):
            text = text[1:]
        hs = ["'sha256-%s'" % base64.b64encode(hashlib.sha256(m.group(1).replace('\r\n', '\n').replace('\r', '\n').encode('utf-8')).digest()).decode('ascii') for m in SCRIPT_RE.finditer(text)]
        if len(_CSP_MEMO) > 20:
            _CSP_MEMO.clear()
        _CSP_MEMO[key] = PAGE_CSP.replace('__HASHES__', ' '.join(hs))
    return _CSP_MEMO[key]


def confirm_folder(folder):
    """A page that asks to keep the figures in another folder (File > Where figures are kept...) is confirmed by the person at this
    computer, in a window of this server that no page can answer (as serve.ps1's Confirm-Folder): code smuggled into the page could
    otherwise point the figures folder at any folder and read its files (2026-11-17). A tool (no Origin: curl, a script, an agent) is not
    asked, as for every write; the test servers of browser.sh / browser.ps1 set SILICODRAW_NO_CONFIRM. No is the default answer.
    None = no way to ask here (Linux without zenity or kdialog): the folder is then chosen with --data."""
    if os.environ.get('SILICODRAW_NO_CONFIRM'):
        return True
    text = 'Keep your SiliCoDraw figures in this folder?\n\n%s\n\nSay Yes only if you chose this folder yourself, just now, in SiliCoDraw (File > Where figures are kept...).' % folder
    title = 'SiliCoDraw: where figures are kept'
    try:
        if os.name == 'nt':
            import ctypes
            return ctypes.windll.user32.MessageBoxW(None, text, title, 0x4 | 0x20 | 0x100 | 0x1000 | 0x40000) == 6   # Yes/No, question, No first, system modal, topmost; 6 = Yes
        if sys.platform == 'darwin':   # the folder goes in as an argument, never as script text
            r = subprocess.run(['osascript', '-e', 'on run argv', '-e', 'display dialog (item 1 of argv) buttons {"No", "Yes"} default button "No" with title "%s" with icon caution' % title, '-e', 'end run', text],
                               capture_output=True, text=True, timeout=600)
            return r.returncode == 0 and 'Yes' in r.stdout
        for cmd in (['zenity', '--question', '--no-markup', '--title', title, '--text', text], ['kdialog', '--title', title, '--yesno', text]):
            if shutil.which(cmd[0]):
                return subprocess.run(cmd, timeout=600).returncode == 0
        return None
    except Exception:
        return False
    return None


def withheld(rel):
    """What a page is never given, though it lies in the program folder (as serve.ps1's Test-Withheld): anything under a name starting
    with a dot (.git, .silicodraw-folder), the private development material (dev/ except the website build dev/web/, outreach/) and the
    updater's figure backups (updates/). Links are resolved before this (realpath), and what lies outside the folder is refused."""
    segs = [s for s in re.split(r'[\\/]', rel) if s]
    if any(s.startswith('.') for s in segs):
        return True
    first = segs[0].lower() if segs else ''
    return first in ('dev', 'outreach', 'updates') and not (first == 'dev' and len(segs) > 2 and segs[1].lower() == 'web')


def host_name_ok(name):
    """With --host: the names a page on the network may address this server by. An IP address (v4, or v6 in brackets),
    localhost, or this computer's own name (also with .local or its full domain name); any other name is a site that pointed
    its own domain name at this computer (DNS rebinding) and is refused, so it can neither read nor write figures."""
    n = name.lower().rstrip('.') if name else ''
    if not n:
        return False
    if re.match(r'^\d{1,3}(\.\d{1,3}){3}$', n) or re.match(r'^\[[0-9a-f:.]+(%[\w.\-]+)?\]$', n):
        return True
    if n == 'localhost' or n.endswith('.localhost'):
        return True
    if not OWN_NAMES:   # worked out once (getfqdn may ask the DNS)
        own = set()
        try:
            own.add(socket.gethostname().lower())
            own.add(socket.getfqdn().lower())
        except OSError:
            pass
        own |= {o.split('.')[0] for o in own if o}
        own |= {o + '.local' for o in list(own) if o and '.' not in o}
        OWN_NAMES.update(o for o in own if o)
        OWN_NAMES.add('')
    return n in OWN_NAMES


OWN_NAMES = set()   # (host_name_ok)


def user_file_headers(path, full):
    """The headers of a file served from the figures folder (see USER_CSP); {} for the program's own files."""
    if not (NAME_RE.match(path) or path.split('/', 1)[0] in DATA_DIRS):
        return {}
    h = {'X-Content-Type-Options': 'nosniff'}
    if os.path.splitext(full)[1].lower() != '.pdf':
        h['Content-Security-Policy'] = USER_CSP
    return h


def cloud_folders():
    """The folders of sync apps found on this computer, as [{name, path}]. Dropbox says where it is in its info.json."""
    home = os.path.expanduser('~')
    found = []

    def add(name, p):
        if p and os.path.isdir(p) and not any(os.path.realpath(p) == os.path.realpath(f['path']) for f in found):
            found.append({'name': name, 'path': p})
    for base in (os.environ.get('APPDATA'), os.environ.get('LOCALAPPDATA'), os.path.join(home, '.dropbox')):
        for info in ([os.path.join(base, 'Dropbox', 'info.json'), os.path.join(base, 'info.json')] if base else []):
            try:
                with open(info, encoding='utf-8') as f:
                    for acc in json.load(f).values():
                        add('Dropbox', acc.get('path'))
            except (OSError, ValueError, AttributeError):
                pass
    cs = os.path.join(home, 'Library', 'CloudStorage')   # macOS keeps the sync apps here
    for pat, name, sub in (('Dropbox*', 'Dropbox', ''), ('OneDrive*', 'OneDrive', ''), ('GoogleDrive-*', 'Google Drive', 'My Drive'), ('Box*', 'Box', '')):
        for p in sorted(glob.glob(os.path.join(glob.escape(cs), pat))):
            add(name, os.path.join(p, sub) if sub else p)
    add('iCloud Drive', os.path.join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs'))
    add('iCloud Drive', os.path.join(home, 'iCloudDrive'))
    for var in ('OneDrive', 'OneDriveConsumer', 'OneDriveCommercial'):
        add('OneDrive', os.environ.get(var))
    for p in sorted(glob.glob(os.path.join(glob.escape(home), 'OneDrive*'))):
        add('OneDrive', p)
    for p in sorted(glob.glob(os.path.join(glob.escape(home), 'Dropbox*'))):
        add('Dropbox', p)
    for rel in ('Google Drive', 'GoogleDrive', os.path.join('Google Drive', 'My Drive')):
        add('Google Drive', os.path.join(home, rel))
    if os.name == 'nt':
        for c in 'DEFGHIJKLMNOPQRSTUVWXYZ':
            add('Google Drive', c + ':\\My Drive')
    for rel in ('Box', 'Box Sync'):
        add('Box', os.path.join(home, rel))
    return found


def copy_missing(src, dst):
    """Copies the figures to a new folder without replacing anything there. Returns (copied, names that differ there, .json files left behind: no figure's name)."""
    copied, differ = 0, []
    roots = [n for n in os.listdir(src) if n.lower().endswith('.json') and os.path.isfile(os.path.join(src, n))]
    items = [n for n in roots if NAME_RE.match(n)]
    skipped = [n for n in roots if not NAME_RE.match(n)]
    for d in DATA_DIRS:
        for base, _, files in os.walk(os.path.join(src, d)):
            if d == 'exports':
                continue
            items += [os.path.relpath(os.path.join(base, f), src) for f in files]
    for rel in items:
        a, b = os.path.join(src, rel), os.path.join(dst, rel)
        if os.path.exists(b):
            with open(a, 'rb') as f1, open(b, 'rb') as f2:
                if f1.read() != f2.read():
                    differ.append(rel.replace(os.sep, '/'))
            continue
        os.makedirs(os.path.dirname(b), exist_ok=True)
        tmp = b + '.tmp'   # a copy that fails leaves no half figure, which a second try would count as already there
        try:
            shutil.copy2(a, tmp)
            os.replace(tmp, b)
        except OSError:
            if os.path.exists(tmp):
                os.remove(tmp)
            raise
        copied += 1
    return copied, differ, skipped


def try_folder(folder):
    """The folder, real path, ready to be written. Raises OSError with a message for the editor when it cannot be used."""
    if os.path.realpath(folder) != ROOT:
        os.makedirs(folder, exist_ok=True)
        probe = os.path.join(folder, '.silicodraw-write-test')
        with open(probe, 'w') as f:
            f.write('ok')
        os.remove(probe)
    return os.path.realpath(folder)


def etag(data):
    """A figure's version: a hash of its content, sent as ETag with the figure (the same as serve.ps1). A save carries it
    back (If-Match, or ?base= from a page that is closing) and is refused with 409 and the file as it is now when the file
    changed since (another window or a tool wrote it): the editor then merges instead of overwriting."""
    return '"%s"' % hashlib.sha256(data).hexdigest()


def entries(paths):
    out = []
    for p in paths:
        try:
            out.append({'name': os.path.basename(p), 'size': os.path.getsize(p),
                        'modified': datetime.fromtimestamp(os.path.getmtime(p)).strftime('%Y-%m-%d %H:%M')})
        except OSError:   # moved or removed just now by another request (the whole list answered 500)
            pass
    return out


def mtime(p):
    try:
        return os.path.getmtime(p)
    except OSError:
        return 0


def stamped(e):
    """A snapshot's time is the version's own time (in its name), as serve.ps1 lists it, not the time it was copied."""
    m = re.match(r'^(\d{4}-\d\d-\d\d)_(\d\d)-(\d\d)', e['name'])
    if m:
        e['modified'] = '%s %s:%s' % m.groups()
    return e


def write_atomic(full, body):
    """Write a temporary file and swap it in: a full disk, a crash or a poll mid-write never sees a truncated figure."""
    tmp = full + '.tmp'
    with open(tmp, 'wb') as f:
        f.write(body)
    try:
        os.replace(tmp, full)
    except OSError:   # Windows: the figure is open in another program without delete sharing
        shutil.copyfile(tmp, full)
        os.remove(tmp)


def history_dir(name):
    return os.path.join(DATA, 'history', os.path.splitext(name)[0])


def snapshot(full, name):
    """Before a figure file is overwritten, keep a copy (at most one per 5 minutes, newest 60)."""
    hdir = history_dir(name)
    os.makedirs(hdir, exist_ok=True)
    snaps = sorted(glob.glob(os.path.join(glob.escape(hdir), '*.json')), key=os.path.getmtime, reverse=True)
    regular = [s for s in snaps if not s.endswith('-closed-window.json')]   # a closed window's kept change is no snapshot: it must not hold back the next one
    if regular and time.time() - os.path.getmtime(regular[0]) < SNAPSHOT_EVERY:
        return
    stamp = datetime.fromtimestamp(os.path.getmtime(full)).strftime('%Y-%m-%d_%H-%M-%S')
    shutil.copyfile(full, os.path.join(hdir, stamp + '.json'))   # copyfile: the snapshot's own mtime = now
    for old in snaps[KEEP_SNAPSHOTS - 1:]:
        os.remove(old)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):   # keep the console quiet
        pass

    # --- helpers ---
    def _parts(self):
        u = urllib.parse.urlparse(self.path)
        path = urllib.parse.unquote(u.path.lstrip('/')) or 'figure-editor.html'
        return path, urllib.parse.parse_qs(u.query)

    def _send(self, code, body=b'', ctype='text/plain; charset=utf-8', headers=None):
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Cache-Control', 'no-store')
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        if body and self.command != 'HEAD':   # a HEAD probe gets headers only, as in serve.ps1
            self.wfile.write(body)

    def _guard(self, fn):
        """A failed request (file locked by a sync tool, disk full) answers 500 like serve.ps1; it used to drop the
        connection, which the editor reads as "server offline" instead of "not saved"."""
        try:
            fn()
        except Exception as e:
            print('Request failed: %s' % e, flush=True)
            try:
                self._send(500, b'request failed')
            except Exception:
                pass

    def do_GET(self):
        self._guard(self._get)

    def do_HEAD(self):
        self._guard(self._get)

    def do_POST(self):
        self._guard(self._post)

    def _json(self, obj):
        self._send(200, json.dumps(obj).encode('utf-8'), 'application/json; charset=utf-8')

    def _body(self):
        return self.rfile.read(int(self.headers.get('Content-Length') or 0))

    def _refuse(self):   # PUT, DELETE, OPTIONS...: nothing is changed in any other way (as serve.ps1)
        self._send(405, b'method not allowed')

    do_PUT = do_DELETE = do_PATCH = do_OPTIONS = _refuse

    def _origin_ok(self):
        """Writes are accepted from the editor's own page and from local tools, never from another web page (the same rule as
        serve.ps1): a browser names the page that sends a request in Origin, and it must be this server's exact address: http,
        this computer's name (with --host: an IP address or its own name, host_name_ok) and this port (a page on another port of this computer, such as a dev server
        or another app, is another site's page, though the browser calls it "same-site"); Sec-Fetch-Site, when sent, must say
        same-origin. A request with neither header comes from a tool (curl, a script, an agent, the tests): accepted as before."""
        origin, site = self.headers.get('Origin') or '', (self.headers.get('Sec-Fetch-Site') or '').lower()   # (without regard to case, as serve.ps1's -notcontains)
        host = (self.headers.get('Host') or '').strip()
        if site and site not in ('same-origin', 'none'):
            return False
        if not origin:
            return True
        name = host.split(']')[0] + ']' if host.startswith('[') else host.rsplit(':', 1)[0]
        port = host[len(name) + 1:] if host[len(name):len(name) + 1] == ':' else ('80' if host else '')
        own = (host_name_ok(name) if ANY_HOST else name.lower() in ('localhost', '127.0.0.1', '[::1]')) and port == str(PORT)
        return own and origin.lower() == 'http://' + host.lower()

    def _host_ok(self):
        """Only requests addressed to this computer by name: a page on another site that points its own domain name at
        127.0.0.1 (DNS rebinding) sends its own name in Host and is refused, so it can neither read nor write figures.
        With --host (reachable from the network): an IP address, localhost or this computer's own name (see host_name_ok)."""
        h = (self.headers.get('Host') or '').strip().lower()
        name = h.split(']')[0] + ']' if h.startswith('[') else h.rsplit(':', 1)[0]
        if ANY_HOST:
            return name == '' or host_name_ok(name)
        return name in ('', 'localhost', '127.0.0.1', '[::1]')

    # --- GET: editor, figure files, api ---
    def _get(self):
        if not self._host_ok():
            return self._send(403, b'forbidden: unknown host name')
        path, q = self._parts()
        if data_gone() and is_data_request(path, q):
            return self._send(503, 'The figures folder cannot be reached.'.encode('utf-8'))
        if path == 'api/files':   # ?scope=active (root, default) | archive | trash | examples
            scope = q.get('scope', [''])[0]
            d = os.path.join(ROOT, 'examples') if scope == 'examples' else os.path.join(DATA, scope) if scope in ('archive', 'trash') else DATA
            return self._json(entries(sorted(glob.glob(os.path.join(glob.escape(d), '*.json')))))
        if path == 'api/storage':
            return self._json({'dir': DATA, 'isDefault': DATA == ROOT, 'missing': DATA if data_gone() else '', 'canChange': not (ANY_HOST or DATA_FIXED), 'program': ROOT, 'options': [] if q.get('brief') else cloud_folders()})   # brief: no looking around the computer's drives
        if path == 'api/history':
            name = q.get('file', [''])[0]
            d = history_dir(name)
            if NAME_RE.match(name) and os.path.isdir(d):
                return self._json([stamped(e) for e in entries(sorted(glob.glob(os.path.join(glob.escape(d), '*.json')), key=mtime, reverse=True))])
            return self._json([])
        home = locate(path)
        full = os.path.realpath(os.path.join(home, path))
        if full.startswith(home + os.sep) and os.path.isfile(full) and not (home == ROOT and withheld(full[len(home) + 1:])):   # withheld: on the path as resolved (dev/web/../queue is dev/queue)
            if NAME_RE.match(path):   # a figure: never read during a save (on Windows an open file made the save's os.replace fail, and its fallback rewrites the file in place: a poll could read half a figure)
                with SAVE_LOCK:
                    with open(full, 'rb') as f:
                        data = f.read()
            else:
                with open(full, 'rb') as f:
                    data = f.read()
            ctype = TYPES.get(os.path.splitext(full)[1].lower(), 'application/octet-stream')
            hdrs = user_file_headers(path, full)
            if not hdrs and full.lower().endswith('.html'):   # one of the program's pages (see PAGE_CSP)
                hdrs['Content-Security-Policy'] = page_csp(full, data)
            if NAME_RE.match(path):   # a figure: its version (see etag)
                tag = etag(data)
                hdrs['ETag'] = tag
                # the editor's poll sends the version it has (If-None-Match): unchanged = 304 without the file (as serve.ps1)
                seen = [re.sub(r'^W/', '', t.strip()) for t in (self.headers.get('If-None-Match') or '').split(',') if t.strip()]
                if tag in seen or '*' in seen:
                    return self._send(304, b'', ctype, hdrs)
            return self._send(200, data, ctype, hdrs)
        if NAME_RE.match(path) and icloud_away(full):
            return self._send(503, 'iCloud Drive is bringing this figure to this Mac.'.encode('utf-8'))
        # a figure not in a chosen folder: the editor does not put this browser's copy there by itself
        self._send(404, b'not found', headers={'X-SiliCoDraw-Chosen': '1'} if NAME_RE.match(path) and DATA != ROOT else None)

    # --- POST: save figure, rename, exports / assets ---
    def _post(self):
        global DATA
        if not self._host_ok():
            return self._send(403, b'forbidden: unknown host name')
        path, q = self._parts()
        if not self._origin_ok():   # (see _origin_ok)
            return self._send(403, b'forbidden: writes from another page are not accepted')
        if path == 'api/quit':   # File > Quit SiliCoDraw: the editor saved first; answered, then the server stops (never on its own: no idle timeout)
            self._send(204)
            self.wfile.flush()
            threading.Thread(target=self.server.shutdown, daemon=True).start()   # shutdown() waits for serve_forever, so not from this request's own thread
            return
        if data_gone() and is_data_request(path, q):
            return self._send(503, 'The figures folder cannot be reached.'.encode('utf-8'))
        if path == 'api/move':   # between active (root), archive/ and trash/
            name, frm, to = q.get('file', [''])[0], q.get('from', [''])[0], q.get('to', [''])[0]
            d_from = os.path.join(DATA, frm) if frm in ('archive', 'trash') else DATA
            d_to = os.path.join(DATA, to) if to in ('archive', 'trash') else DATA
            src, dst = os.path.join(d_from, name), os.path.join(d_to, name)
            if NAME_RE.match(name) and d_from != d_to and os.path.isfile(src) and not os.path.exists(dst):
                os.makedirs(d_to, exist_ok=True)
                os.rename(src, dst)
                return self._send(204)
            return self._send(409, b'cannot move')
        if path == 'api/delete':   # permanent, only from trash/ (history goes too, unless an active or archived figure has that name: history is kept by name, so it is theirs)
            name = q.get('file', [''])[0]
            p = os.path.join(DATA, 'trash', name)
            if NAME_RE.match(name) and os.path.isfile(p):
                os.remove(p)
                if not os.path.isfile(os.path.join(DATA, name)) and not os.path.isfile(os.path.join(DATA, 'archive', name)):
                    shutil.rmtree(history_dir(name), ignore_errors=True)
                return self._send(204)
            return self._send(409, b'cannot delete')
        if path == 'api/rename':
            src_name, dst_name = q.get('from', [''])[0], q.get('to', [''])[0]
            src, dst = os.path.join(DATA, src_name), os.path.join(DATA, dst_name)
            if (NAME_RE.match(src_name) and NAME_RE.match(dst_name)
                    and os.path.isfile(src) and not os.path.exists(dst)):
                os.rename(src, dst)
                hs, hd = history_dir(src_name), history_dir(dst_name)
                if os.path.isdir(hs) and not os.path.exists(hd):
                    os.rename(hs, hd)
                return self._send(204)
            return self._send(409, b'cannot rename')
        if path == 'api/storage':   # ?dir=<folder> (empty: back to this folder) &copy=1: the figures come along, nothing there is replaced
            if ANY_HOST or DATA_FIXED:
                return self._send(403, b'not changed from here')
            # only the editor's own page: another page on this computer (any localhost port) could send every figure to a folder of its choice
            # (checked above for every write by _origin_ok: the exact origin; kept here word for word as in serve.ps1)
            origin, site, host = self.headers.get('Origin') or '', (self.headers.get('Sec-Fetch-Site') or '').lower(), self.headers.get('Host') or ''
            if (origin and origin != 'http://' + host) or site not in ('', 'same-origin', 'none'):
                return self._send(403, b'forbidden: only the editor can do this')
            want = q.get('dir', [''])[0].strip().strip('"')
            folder = ROOT if not want else os.path.abspath(os.path.expanduser(want))
            if want and not os.path.isabs(os.path.expanduser(want)):
                return self._send(400, 'Give the whole path of the folder.'.encode('utf-8'))
            if os.path.dirname(folder) == folder:
                return self._send(400, 'Choose a folder, not a whole drive.'.encode('utf-8'))
            ok_ = True if os.path.realpath(folder) in (ROOT, DATA) or not (origin or site) else confirm_folder(folder)   # see confirm_folder
            if ok_ is None:
                return self._send(400, ('Not changed: SiliCoDraw cannot ask you to confirm a folder on this computer (it needs zenity or kdialog). Start it with --data "%s" instead.' % folder).encode('utf-8'))
            if not ok_:
                return self._send(400, 'Not changed: the folder was not confirmed. SiliCoDraw asks in a window of its own (it may be behind the browser); say Yes there to use this folder.'.encode('utf-8'))
            with SAVE_LOCK:
                try:
                    new = try_folder(folder)
                    copied, differ, skipped = copy_missing(DATA, new) if q.get('copy', [''])[0] == '1' and new != DATA and not data_gone() else (0, [], [])
                    if new == ROOT:
                        if os.path.exists(CONFIG):
                            os.remove(CONFIG)
                    else:
                        with open(CONFIG, 'w', encoding='utf-8') as f:
                            f.write(new)
                except OSError as e:
                    return self._send(400, ('This folder cannot be used: %s' % e).encode('utf-8'))
                DATA = new   # last: until here every request still has the old folder, and a failure changes nothing
            return self._json({'dir': DATA, 'isDefault': DATA == ROOT, 'copied': copied, 'differ': differ, 'skipped': skipped})
        if NAME_RE.match(path):
            body = self._body()
            if not body.strip() or len(body) < int(self.headers.get('Content-Length') or 0):   # empty, or the upload broke off: keep the figure
                return self._send(400, b'empty or incomplete figure')
            base = re.sub(r'^W/', '', (self.headers.get('If-Match') or q.get('base', [''])[0]).strip()).strip('"')
            if base == '*':   # If-Match: * = "any version" (HTTP): no check
                base = ''
            cur = None
            with SAVE_LOCK:
                full = os.path.join(DATA, path)   # in the lock: not the folder of before a switch
                if icloud_away(full):
                    return self._send(503, 'iCloud Drive is bringing this figure to this Mac.'.encode('utf-8'))
                if base and os.path.isfile(full):   # made from an older version than the one there now: refused (see etag)
                    with open(full, 'rb') as f:
                        cur = f.read()
                    if hashlib.sha256(cur).hexdigest() == base:
                        cur = None
                if cur is None:
                    if os.path.isfile(full):
                        snapshot(full, path)
                    write_atomic(full, body)
            if cur is not None:
                if not self.headers.get('If-Match'):   # sent by a page that was closing (?base=): it cannot merge any more, so its last change is kept in the version history
                    hdir = history_dir(path)
                    os.makedirs(hdir, exist_ok=True)
                    with open(os.path.join(hdir, datetime.now().strftime('%Y-%m-%d_%H-%M-%S') + '-closed-window.json'), 'wb') as f:
                        f.write(body)
                return self._send(409, cur, 'application/json; charset=utf-8', {'ETag': etag(cur)})
            return self._send(204, headers={'ETag': etag(body)})   # the new version, for the editor's next save
        if FILE_RE.match(path):
            full = os.path.join(DATA, path)
            os.makedirs(os.path.dirname(full), exist_ok=True)
            with open(full, 'wb') as f:
                f.write(self._body())
            return self._send(204)
        self._send(404, b'not found')


def main():
    ap = argparse.ArgumentParser(description='Run the Figure Editor')
    ap.add_argument('--port', type=int, default=8770)
    ap.add_argument('--host', default='127.0.0.1', help='127.0.0.1 (this computer only, default) or 0.0.0.0 (your whole network)')
    ap.add_argument('--no-browser', action='store_true', help='do not open the editor in a browser')
    ap.add_argument('--data', default='', help='keep the figures in this folder for this run (default: the one chosen in the editor, else this folder)')
    a = ap.parse_args()
    global ANY_HOST, DATA, DATA_FIXED, PORT
    ANY_HOST = a.host not in ('127.0.0.1', 'localhost', '::1')
    PORT = a.port
    if a.data:
        os.makedirs(a.data, exist_ok=True)
        DATA, DATA_FIXED = os.path.realpath(a.data), True
    elif os.path.isfile(CONFIG):
        with open(CONFIG, encoding='utf-8') as f:
            chosen = f.read().strip()
        if chosen:
            DATA = os.path.realpath(chosen)
            if not os.path.isdir(DATA):   # never a new empty folder in its place: figures wait for it, and the editor says so
                print('The figures folder cannot be reached at the moment: %s' % chosen, flush=True)
    url = f'http://localhost:{a.port}/'
    try:
        srv = ThreadingHTTPServer((a.host, a.port), Handler)
    except OSError as e:
        # started twice (e.g. the launcher double-clicked again): if SiliCoDraw already answers there, just show it
        try:
            with urllib.request.urlopen(url + 'api/storage?brief=1', timeout=3) as r:
                running = r.status == 200
        except Exception:
            running = False
        if running:
            print(f'SiliCoDraw is already running at {url}' + ('' if a.no_browser else ' (opening it in your browser)'))
            if not a.no_browser:
                webbrowser.open(url)
            sys.exit(0)
        print(f'Could not start on port {a.port}: {e}\nAnother program uses this port. Close it, or start SiliCoDraw on another port:'
              f'\n  python3 serve.py --port {a.port + 1}')
        sys.exit(1)
    print(f'SiliCoDraw is running at {url}\n'
          'Leave this window open while you work (you can minimize it). To quit SiliCoDraw: File > Quit SiliCoDraw in the editor, or close this window.', flush=True)
    if not a.no_browser:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()   # until File > Quit SiliCoDraw (api/quit) or Ctrl+C
        srv.server_close()
        print('SiliCoDraw has stopped (File > Quit SiliCoDraw).', flush=True)
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
