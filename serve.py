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
import argparse, glob, json, os, re, shutil, sys, threading, time, urllib.parse, webbrowser
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
NAME_RE = re.compile(r'^[\w.\-]+\.json$')
FILE_RE = re.compile(r'^(exports|assets)/[\w.\-]+\.(png|svg|jpg|jpeg|gif|webp|pptx)$')
TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
         '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
         '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
         '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
         '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation'}
SNAPSHOT_EVERY = 300   # seconds
KEEP_SNAPSHOTS = 60


def entries(paths):
    return [{'name': os.path.basename(p), 'size': os.path.getsize(p),
             'modified': datetime.fromtimestamp(os.path.getmtime(p)).strftime('%Y-%m-%d %H:%M')} for p in paths]


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
        if body:
            self.wfile.write(body)

    def _json(self, obj):
        self._send(200, json.dumps(obj).encode('utf-8'), 'application/json; charset=utf-8')

    def _body(self):
        return self.rfile.read(int(self.headers.get('Content-Length') or 0))

    # --- GET: editor, figure files, api ---
    def do_GET(self):
        path, q = self._parts()
        if path == 'api/files':   # ?scope=active (root, default) | archive | trash | examples
            scope = q.get('scope', [''])[0]
            d = os.path.join(ROOT, scope) if scope in ('archive', 'trash', 'examples') else ROOT
            return self._json(entries(sorted(glob.glob(os.path.join(d, '*.json')))))
        if path == 'api/history':
            name = q.get('file', [''])[0]
            d = history_dir(name)
            if NAME_RE.match(name) and os.path.isdir(d):
                return self._json(entries(sorted(glob.glob(os.path.join(d, '*.json')), key=os.path.getmtime, reverse=True)))
            return self._json([])
        full = os.path.realpath(os.path.join(ROOT, path))
        if full.startswith(ROOT) and os.path.isfile(full):
            with open(full, 'rb') as f:
                data = f.read()
            return self._send(200, data, TYPES.get(os.path.splitext(full)[1].lower(), 'application/octet-stream'))
        self._send(404, b'not found')

    # --- POST: save figure, rename, exports / assets ---
    def do_POST(self):
        path, q = self._parts()
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
            if os.path.isfile(full):
                snapshot(full, path)
            with open(full, 'wb') as f:
                f.write(body)
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
    try:
        srv = ThreadingHTTPServer((a.host, a.port), Handler)
    except OSError as e:
        print(f'Could not start on port {a.port}: {e}\nIf the editor is already running, just open http://localhost:{a.port}/')
        sys.exit(1)
    url = f'http://localhost:{a.port}/'
    print(f'SiliCoDraw is running at {url}  (Ctrl+C to stop)')
    if not a.no_browser:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
