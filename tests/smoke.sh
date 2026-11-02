#!/bin/sh
# Smoke test for macOS / Linux, run by .github/workflows/test.yml on every push (and by hand: sh tests/smoke.sh).
# It checks what a new user depends on: the installer, the first-start setup, the server (page, save, history,
# file list, refusal of writes from other websites) and the updater's dry run. Exit code 0 = everything passed.
#
#   SILICODRAW_TEST_ZIP=<url or file://...>   install from this ZIP instead of GitHub (for testing before upload)
#   SILICODRAW_TEST_ONLINE=0                  skip the steps that need github.com (installer download, updater check)
set -u
ROOT=$(cd "$(dirname "$0")/.." && pwd)
PORT=8799
NM="zz-smoke-$$"   # a name of its own: a figure called zz-smoke in the folder is left alone
FAIL=0
TMP=$(mktemp -d 2>/dev/null || mktemp -d -t silicodraw)
SRV=''

ok()   { printf '  ok    %s\n' "$1"; }
bad()  { printf '  FAIL  %s\n' "$1"; FAIL=1; }
cleanup() { [ -n "$SRV" ] && kill "$SRV" 2>/dev/null; rm -rf "$TMP"; }
trap cleanup EXIT INT TERM

echo "SiliCoDraw smoke test ($(uname -s) $(uname -r)), folder: $ROOT"
PY=$(command -v python3 || true)
[ -n "$PY" ] || { echo "python3 not found"; exit 1; }
"$PY" --version

# 1. shell syntax of every script a user runs
for f in "$ROOT"/*.sh "$ROOT"/*.command; do
  [ -f "$f" ] || continue
  if sh -n "$f"; then ok "syntax $(basename "$f")"; else bad "syntax $(basename "$f")"; fi
  if grep -q "$(printf '\r')" "$f"; then bad "$(basename "$f") has Windows line endings"; fi
done
"$PY" -m py_compile "$ROOT/serve.py" "$ROOT/update.py" && ok "python syntax serve.py update.py" || bad "python syntax"

# 2. first-start setup (permissions, quarantine flag, macOS app shortcut) without starting the server
chmod -x "$ROOT"/*.command "$ROOT"/*.sh 2>/dev/null   # as after a GitHub "Download ZIP" of web-uploaded files
if HOME="$TMP/home" sh "$ROOT/start.sh" --setup-only; then ok "start.sh --setup-only"; else bad "start.sh --setup-only"; fi
for f in "$ROOT"/*.command; do [ -x "$f" ] && ok "executable $(basename "$f")" || bad "not executable $(basename "$f")"; done
if [ "$(uname -s)" = Darwin ]; then
  APP="$TMP/home/Applications/SiliCoDraw.app"
  [ -d "$APP" ] && ok "app shortcut created" || bad "app shortcut missing: $APP"
  [ -x "$APP/Contents/MacOS/applet" ] && ok "app shortcut has an executable" || bad "app shortcut not runnable"
fi

# 3. the server (free ports: never a SiliCoDraw you are using)
free_port() { "$PY" -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()'; }
PORT=$(free_port)
"$PY" "$ROOT/serve.py" --no-browser --port $PORT --data "$ROOT" >"$TMP/server.log" 2>&1 &
SRV=$!
i=0; until curl -fs "http://localhost:$PORT/api/files" >/dev/null 2>&1; do i=$((i+1)); [ $i -gt 40 ] && break; sleep 0.25; done
if curl -fs "http://localhost:$PORT/" | grep -q '<title>SiliCoDraw</title>'; then ok "editor page served"; else bad "editor page not served"; cat "$TMP/server.log"; fi
FIG='{"version":4,"w":400,"h":300,"bg":"#ffffff","objects":[{"id":"t","type":"text","x":20,"y":40,"text":"smoke"}]}'
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST --data "$FIG" "http://localhost:$PORT/$NM.json")
[ "$code" = 204 ] && ok "save a figure" || bad "save a figure (HTTP $code)"
curl -fs "http://localhost:$PORT/$NM.json" | grep -q '"smoke"' && ok "read it back" || bad "read it back"
TAG=$(curl -fsI "http://localhost:$PORT/$NM.json" | tr -d '\r' | sed -n 's/^[Ee][Tt][Aa][Gg]: *//p')
code=$(curl -s -o /dev/null -w '%{http_code}' -H "If-None-Match: $TAG" "http://localhost:$PORT/$NM.json")
[ -n "$TAG" ] && [ "$code" = 304 ] && ok "unchanged figure: 304" || bad "unchanged figure with If-None-Match (HTTP $code)"
curl -s -o /dev/null -X POST --data "$FIG" "http://localhost:$PORT/$NM.json"
ls "$ROOT/history/$NM/"*.json >/dev/null 2>&1 && ok "history snapshot" || bad "no history snapshot"
curl -fs "http://localhost:$PORT/api/files" | grep -q "$NM.json" && ok "file list" || bad "file list"
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Origin: https://evil.example' --data "$FIG" "http://localhost:$PORT/$NM-evil.json")
[ "$code" = 403 ] && ok "refuses writes from other websites" || bad "accepted a cross-site write (HTTP $code)"
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST --data x "http://localhost:$PORT/figure-editor.html")
[ "$code" != 204 ] && ok "cannot overwrite the editor ($code)" || bad "editor file was writable"
# a second start on the same port must not crash: it reports the running editor and exits 0
if "$PY" "$ROOT/serve.py" --no-browser --port $PORT >"$TMP/second.log" 2>&1; then ok "second start reports the running editor"; else bad "second start failed: $(cat "$TMP/second.log")"; fi
kill "$SRV" 2>/dev/null; SRV=''
rm -rf "$ROOT/$NM.json" "$ROOT/$NM-evil.json" "$ROOT/history/$NM"

# the figures folder: in a copy of the server of its own, so a folder you chose is left alone
APP="$TMP/app"; CLOUD="$TMP/Sync folder/SiliCoDraw"; P2=$(free_port); B2="http://localhost:$P2"; mkdir -p "$APP"; cp "$ROOT/serve.py" "$APP/"
SYNC="$TMP/OneDrive - Test"; mkdir -p "$SYNC"   # a sync app's folder it must find
start_copy() { OneDrive="$SYNC" "$PY" "$APP/serve.py" --no-browser --port $P2 >"$TMP/server2.log" 2>&1 & SRV=$!; i=0; until curl -fs --max-time 5 "$B2/api/storage?brief=1" >/dev/null 2>&1; do i=$((i+1)); [ $i -gt 40 ] && return 1; sleep 0.25; done; }
stop_copy() { kill "$SRV" 2>/dev/null; wait "$SRV" 2>/dev/null; SRV=''; }
post() { curl -s -o /dev/null -w '%{http_code}' -X POST "$@"; }
ENC=$("$PY" -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$CLOUD")
start_copy && ok "figures folder: a server of its own" || { bad "figures folder: server did not start"; cat "$TMP/server2.log"; }
curl -fs "$B2/api/storage" | grep -q '"isDefault": true' && ok "figures folder: this folder by default" || bad "figures folder: api/storage"
curl -fs "$B2/api/storage" | "$PY" -c 'import json, sys; o = json.load(sys.stdin)["options"]; sys.exit(0 if any(x["name"] == "OneDrive" and x["path"] == sys.argv[1] for x in o) else 1)' "$SYNC" && ok "figures folder: a sync app's folder is found, as a name and a path" || bad "figures folder: the sync folders"
post --data "$FIG" "$B2/before.json" >/dev/null; post --data "$FIG" "$B2/before.json" >/dev/null
[ "$(post -H 'Origin: https://evil.example' "$B2/api/storage?dir=$ENC&copy=1")" = 403 ] && ok "figures folder: another website cannot change it" || bad "figures folder: changed from another website"
[ "$(post "$B2/api/storage?dir=relative/path")" = 400 ] && ok "figures folder: a partial path is refused" || bad "figures folder: partial path"
[ "$(post "$B2/api/storage?dir=$ENC&copy=1")" = 200 ] && [ -f "$CLOUD/before.json" ] && ok "figures folder: set, and the figures copied" || bad "figures folder: set and copy"
[ -f "$APP/before.json" ] && ok "figures folder: the old copy stays" || bad "figures folder: the old copy went"
post --data "$FIG" "$B2/after.json" >/dev/null
[ -f "$CLOUD/after.json" ] && [ ! -f "$APP/after.json" ] && ok "figures folder: saves go there" || bad "figures folder: saved in the wrong place"
post --data '{}' "$B2/assets/a.json" >/dev/null; [ -f "$CLOUD/assets/a.json" ] && ok "figures folder: its assets go there too" || bad "figures folder: assets in the wrong place"
[ "$(curl -s -o /dev/null -w '%{http_code}' "$B2/serve.py")" = 200 ] && ok "figures folder: program files stay served from the program folder" || bad "figures folder: program file"
stop_copy; start_copy; curl -fs "$B2/api/files" | grep -q 'after.json' && ok "figures folder: remembered after a restart" || bad "figures folder: forgotten after a restart"
[ "$(post -H 'Origin: http://localhost:1234' "$B2/api/storage?dir=$ENC")" = 403 ] && ok "figures folder: another page on this computer cannot change it" || bad "figures folder: changed from another local page"
[ "$(curl -s -o /dev/null -w '%{http_code}' "$B2/not-there.json")" = 404 ] && ok "figures folder: a figure not there: 404" || bad "figures folder: not there"
stop_copy; mv "$CLOUD" "$CLOUD-moved"; start_copy; curl -fs "$B2/api/storage" | grep -q '"missing": "/' && [ ! -d "$CLOUD" ] && ok "figures folder: gone at the start: says so, and no empty folder appears" || bad "figures folder: gone: not reported"
c1=$(curl -s -o /dev/null -w '%{http_code}' "$B2/before.json"); c2=$(post --data "$FIG" "$B2/before.json"); c3=$(post --data x "$B2/exports/a.png")
[ "$c1$c2$c3" = 503503503 ] && [ ! -d "$CLOUD" ] && ok "figures folder: while gone: figures wait (503), nothing goes elsewhere" || bad "figures folder: while gone: read $c1, save $c2, export $c3"
mv "$CLOUD-moved" "$CLOUD"; [ "$(curl -s -o /dev/null -w '%{http_code}' "$B2/before.json")" = 200 ] && ok "figures folder: back by itself, no restart" || bad "figures folder: not back"
: > "$CLOUD/.moved.json.icloud"; [ "$(curl -s -o /dev/null -w '%{http_code}' "$B2/moved.json")" = 503 ] && [ "$(post --data "$FIG" "$B2/moved.json")" = 503 ] && [ ! -f "$CLOUD/moved.json" ] && ok "figures folder: an iCloud figure away from this Mac is not treated as new" || bad "figures folder: an iCloud figure away"; rm -f "$CLOUD/.moved.json.icloud"
echo '{"objects":[]}' > "$CLOUD/my figure (conflicted copy).json"; OTHER="$TMP/Other [2026]"; ENC2=$("$PY" -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$OTHER")
curl -s -X POST "$B2/api/storage?dir=$ENC2&copy=1" | grep -q 'my figure (conflicted copy).json' && ok "figures folder: a file with no figure's name is reported as left behind" || bad "figures folder: left behind without a word"
curl -fs "$B2/api/files" | grep -q 'before.json' && ok "figures folder: a path with [ ] works" || bad "figures folder: a path with [ ] looks empty"
post --data "$FIG" "$B2/snap.json" >/dev/null; post --data "$FIG" "$B2/snap.json" >/dev/null; curl -fs "$B2/api/history?file=snap.json" | grep -q 'json' && ok "figures folder: its history is listed with [ ] in the path" || bad "figures folder: history with [ ] in the path"
[ "$(post --data "$FIG" "$B2/...json")" != 204 ] && ok "a name that is only dots is no figure" || bad "a name that is only dots was saved"
stop_copy; start_copy
[ "$(post "$B2/api/storage?dir=")" = 200 ] && curl -fs "$B2/api/storage" | grep -q '"isDefault": true' && [ ! -f "$APP/.silicodraw-folder" ] && ok "figures folder: back to the program folder" || bad "figures folder: back"
stop_copy

# 4. installer (into a temporary home) and the updater's dry run
if [ "${SILICODRAW_TEST_ONLINE:-1}" != 0 ] || [ -n "${SILICODRAW_TEST_ZIP:-}" ]; then
  if SILICODRAW_DIR="$TMP/inst/SiliCoDraw" SILICODRAW_ZIP_URL="${SILICODRAW_TEST_ZIP:-}" SILICODRAW_NO_START=1 HOME="$TMP/home" sh "$ROOT/install.sh" </dev/null; then
    [ -f "$TMP/inst/SiliCoDraw/figure-editor.html" ] && ok "installer: files in place" || bad "installer: editor missing"
    [ -x "$TMP/inst/SiliCoDraw/Start SiliCoDraw.command" ] && ok "installer: launcher executable" || bad "installer: launcher not executable"
    if [ "$(uname -s)" = Darwin ]; then xattr -p com.apple.quarantine "$TMP/inst/SiliCoDraw/start.sh" >/dev/null 2>&1 && bad "installer: files quarantined" || ok "installer: no quarantine flag"; fi
    echo '{"version":4,"objects":[]}' > "$TMP/inst/SiliCoDraw/my-figure.json"
    SILICODRAW_DIR="$TMP/inst/SiliCoDraw" SILICODRAW_ZIP_URL="${SILICODRAW_TEST_ZIP:-}" SILICODRAW_NO_START=1 HOME="$TMP/home" sh "$ROOT/install.sh" </dev/null >/dev/null 2>&1
    [ -f "$TMP/inst/SiliCoDraw/my-figure.json" ] && ok "installer: second run keeps the user's figures" || bad "installer: second run lost a figure"
  else bad "installer failed"; fi
fi
if [ "${SILICODRAW_TEST_ONLINE:-1}" != 0 ]; then
  if "$PY" "$ROOT/update.py" --check --yes --force </dev/null >"$TMP/upd.log" 2>&1; then ok "updater --check"; else bad "updater --check: $(tail -5 "$TMP/upd.log")"; fi
fi

[ $FAIL = 0 ] && echo "All checks passed." || echo "Some checks FAILED."
exit $FAIL
