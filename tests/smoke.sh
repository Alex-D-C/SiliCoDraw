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

# 3. the server
"$PY" "$ROOT/serve.py" --no-browser --port $PORT >"$TMP/server.log" 2>&1 &
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
