#!/usr/bin/env python3
"""SiliCoDraw server (cross-platform twin of serve.ps1).

    python3 serve.py              -> http://localhost:8770/
    python3 serve.py --port 9000
    python3 serve.py --host 0.0.0.0   (reachable on your network; see README "Privacy")

What it does:
  * serves figure-editor.html and the files in this folder
  * saves figures   (POST <name>.json), keeping a snapshot in history/<name>/ at most every 5 minutes
  * writes exports  (POST exports/<name>.png|svg|pptx) and inserted images (POST assets/<name>.png|jpg|svg|...)
  * api/files, api/history?file=..., api/rename, api/move, api/delete   for the editor's File menu
No dependencies beyond the Python 3 standard library.
"""
import sys
if sys.version_info < (3, 7):
    sys.exit('SiliCoDraw needs Python 3.7 or newer (this is %d.%d). Get it from https://www.python.org/downloads/' % sys.version_info[:2])
import argparse, glob, json, os, re, shutil, threading, time, urllib.parse, urllib.request, webbrowser
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.realpath(os.path.dirname(os.path.abspath(__file__)))   # realpath: a folder reached through a symlink still works
NAME_RE = re.compile(r'^[\w.\-]+\.json$')
FILE_RE = re.compile(r'^(exports|assets)/[\w.\-]+\.(png|svg|jpg|jpeg|gif|webp|pptx|json)$', re.I)   # exports, inserted images, the user's icon library
TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
         '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml; charset=utf-8', '.png': 'image/png',
         '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
         '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
         '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation'}
SNAPSHOT_EVERY = 300   # seconds
ANY_HOST = False       # True when started with --host other than 127.0.0.1 (reachable from the network on purpose)
KEEP_SNAPSHOTS = 60


def entries(paths):
    return [{'name': os.path.basename(p), 'size': os.path.getsize(p),
             'modified': datetime.fromtimestamp(os.path.getmtime(p)).strftime('%Y-%m-%d %H:%M')} for p in paths]


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
    return os.path.join(ROOT, 'history', os.path.splitext(name)[0])


def snapshot(full, name):
    """Before a figure file is overwritten, keep a copy (at most one per 5 minutes, newest 60)."""
    hdir = history_dir(name)
    os.makedirs(hdir, exist_ok=True)
    snaps = sorted(glob.glob(os.path.join(hdir, '*.json')), key=os.path.getmtime, reverse=True)
    if snaps and time.time() - os.path.getmtime(snaps[0]) < SNAPSHOT_EVERY:
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

    def _send(self, code, body=b'', ctype='text/plain; charset=utf-8'):
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Cache-Control', 'no-store')
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

    def _host_ok(self):
        """Only requests addressed to this computer by name: a page on another site that points its own domain name at
        127.0.0.1 (DNS rebinding) sends its own name in Host and is refused, so it can neither read nor write figures."""
        if ANY_HOST:
            return True
        h = (self.headers.get('Host') or '').strip().lower()
        name = h.split(']')[0] + ']' if h.startswith('[') else h.rsplit(':', 1)[0]
        return name in ('', 'localhost', '127.0.0.1', '[::1]')

    # --- GET: editor, figure files, api ---
    def _get(self):
        if not self._host_ok():
            return self._send(403, b'forbidden: unknown host name')
        path, q = self._parts()
        if path == 'api/files':   # ?scope=active (root, default) | archive | trash | examples
            scope = q.get('scope', [''])[0]
            d = os.path.join(ROOT, scope) if scope in ('archive', 'trash', 'examples') else ROOT
            return self._json(entries(sorted(glob.glob(os.path.join(d, '*.json')))))
        if path == 'api/history':
            name = q.get('file', [''])[0]
            d = history_dir(name)
            if NAME_RE.match(name) and os.path.isdir(d):
                return self._json([stamped(e) for e in entries(sorted(glob.glob(os.path.join(d, '*.json')), key=os.path.getmtime, reverse=True))])
            return self._json([])
        full = os.path.realpath(os.path.join(ROOT, path))
        if full.startswith(ROOT + os.sep) and os.path.isfile(full):
            with open(full, 'rb') as f:
                data = f.read()
            return self._send(200, data, TYPES.get(os.path.splitext(full)[1].lower(), 'application/octet-stream'))
        self._send(404, b'not found')

    # --- POST: save figure, rename, exports / assets ---
    def _post(self):
        if not self._host_ok():
            return self._send(403, b'forbidden: unknown host name')
        path, q = self._parts()
        # writes are accepted from the editor (same origin) and from local tools, never from a web page on another
        # site: a browser marks such a request with Sec-Fetch-Site: cross-site and an Origin that is not this server
        origin, site, host = self.headers.get('Origin') or '', self.headers.get('Sec-Fetch-Site') or '', self.headers.get('Host') or ''
        local = re.match(r'^https?://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$', origin) or origin == 'http://' + host
        if site == 'cross-site' or (origin and not local):
            return self._send(403, b'forbidden: writes from another site are not accepted')
        if path == 'api/move':   # between active (root), archive/ and trash/
            name, frm, to = q.get('file', [''])[0], q.get('from', [''])[0], q.get('to', [''])[0]
            d_from = os.path.join(ROOT, frm) if frm in ('archive', 'trash') else ROOT
            d_to = os.path.join(ROOT, to) if to in ('archive', 'trash') else ROOT
            src, dst = os.path.join(d_from, name), os.path.join(d_to, name)
            if NAME_RE.match(name) and d_from != d_to and os.path.isfile(src) and not os.path.exists(dst):
                os.makedirs(d_to, exist_ok=True)
                os.rename(src, dst)
                return self._send(204)
            return self._send(409, b'cannot move')
        if path == 'api/delete':   # permanent, only from trash/ (history goes too)
            name = q.get('file', [''])[0]
            p = os.path.join(ROOT, 'trash', name)
            if NAME_RE.match(name) and os.path.isfile(p):
                os.remove(p)
                shutil.rmtree(history_dir(name), ignore_errors=True)
                return self._send(204)
            return self._send(409, b'cannot delete')
        if path == 'api/rename':
            src_name, dst_name = q.get('from', [''])[0], q.get('to', [''])[0]
            src, dst = os.path.join(ROOT, src_name), os.path.join(ROOT, dst_name)
            if (NAME_RE.match(src_name) and NAME_RE.match(dst_name)
                    and os.path.isfile(src) and not os.path.exists(dst)):
                os.rename(src, dst)
                hs, hd = history_dir(src_name), history_dir(dst_name)
                if os.path.isdir(hs) and not os.path.exists(hd):
                    os.rename(hs, hd)
                return self._send(204)
            return self._send(409, b'cannot rename')
        if NAME_RE.match(path):
            full = os.path.join(ROOT, path)
            body = self._body()
            if not body.strip() or len(body) < int(self.headers.get('Content-Length') or 0):   # empty, or the upload broke off: keep the figure
                return self._send(400, b'empty or incomplete figure')
            if os.path.isfile(full):
                snapshot(full, path)
            write_atomic(full, body)
            return self._send(204)
        if FILE_RE.match(path):
            full = os.path.join(ROOT, path)
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
    a = ap.parse_args()
    global ANY_HOST
    ANY_HOST = a.host not in ('127.0.0.1', 'localhost', '::1')
    url = f'http://localhost:{a.port}/'
    try:
        srv = ThreadingHTTPServer((a.host, a.port), Handler)
    except OSError as e:
        # started twice (e.g. the launcher double-clicked again): if SiliCoDraw already answers there, just show it
        try:
            with urllib.request.urlopen(url + 'api/files', timeout=3) as r:
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
          'Leave this window open while you work (you can minimize it). To quit SiliCoDraw, close this window.', flush=True)
    if not a.no_browser:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
