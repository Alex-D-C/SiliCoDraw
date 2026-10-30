#!/bin/sh
# Browser test suite for macOS / Linux: runs tests/run.html (tests/editor-tests.js inside the editor) in a headless
# Chrome, Chromium, Edge or Firefox, or in Safari (macOS, through safaridriver), against a server of its own (serve.py)
# on a free port, prints the results, exit code 0 = all passed.
#   sh tests/browser.sh
#   sh tests/browser.sh --browser firefox            Firefox (headless); --browser safari: Safari (a window of its own; macOS only)
#   sh tests/browser.sh --only icons,examples       only the tests whose names start with these (icons, types, type <name>, examples, undo/redo, connectors, ...)
#   sh tests/browser.sh --editor dev/web/editor.html  another editor page in the folder (default: figure-editor.html)
#   sh tests/browser.sh --show                      a visible browser window instead of headless;  --timeout <seconds> (default 1800)
#   SILICODRAW_BROWSER=/path/to/chrome sh tests/browser.sh   use this browser (a path, or chrome / firefox / safari)
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(dirname "$HERE")
while [ "$ROOT" != / ] && [ ! -f "$ROOT/serve.py" ]; do ROOT=$(dirname "$ROOT"); done   # the nearest folder above with serve.py
[ -f "$ROOT/serve.py" ] || { echo "FAIL  no SiliCoDraw folder (serve.py) found above $HERE"; exit 1; }
ONLY=''; EDITOR=''; TIMEOUT=1800; SHOW=0; BR=${SILICODRAW_BROWSER:-}
while [ $# -gt 0 ]; do
  case "$1" in
    --browser) BR=$2; shift 2 ;;
    --only) ONLY=$2; shift 2 ;;
    --editor) EDITOR=$2; shift 2 ;;
    --timeout) TIMEOUT=$2; shift 2 ;;
    --show) SHOW=1; shift ;;
    *) echo "unknown option: $1"; exit 2 ;;
  esac
done
PY=$(command -v python3 || true)
[ -n "$PY" ] || { echo "FAIL  python3 not found"; exit 1; }
REL=${HERE#"$ROOT"/}

find_br() {   # the first of these names / paths that exists
  for c in "$@"; do
    if [ -x "$c" ]; then echo "$c"; return; fi
    p=$(command -v "$c" 2>/dev/null || true); if [ -n "$p" ]; then echo "$p"; return; fi
  done
}
WANT=$BR
case "$BR" in
  ''|chrome|chromium|edge) BR=$(find_br google-chrome google-chrome-stable chromium chromium-browser microsoft-edge microsoft-edge-stable \
           "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" "/Applications/Chromium.app/Contents/MacOS/Chromium" \
           "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge") ;;
  firefox) BR=$(find_br firefox firefox-esr "/Applications/Firefox.app/Contents/MacOS/firefox" \
           "/Applications/Firefox Developer Edition.app/Contents/MacOS/firefox" "/Applications/Firefox Nightly.app/Contents/MacOS/firefox") ;;
  safari) BR=$(find_br safaridriver /usr/bin/safaridriver) ;;
esac
[ -n "$BR" ] || { echo "FAIL  no ${WANT:-Chrome, Chromium or Edge} found (--browser chrome / firefox / safari, or SILICODRAW_BROWSER=/path/to/browser)"; exit 1; }
KIND=chrome
case "$(basename "$BR")" in firefox*) KIND=firefox ;; safaridriver) KIND=safari ;; esac

PORT=$("$PY" -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()')
ID="zz-tests-$(date +%Y%m%d%H%M%S)-$$"
FIG="zz-test-${ID#zz-tests-}"   # the scratch figure: named here, so it is removed even when the page never reports
REPORT="$ROOT/exports/$ID.json"
TMP=$(mktemp -d 2>/dev/null || mktemp -d -t silicodraw)
URL="http://localhost:$PORT/$REL/run.html?report=$ID&figure=$FIG"
[ -n "$EDITOR" ] && URL="$URL&editor=$EDITOR"
[ -n "$ONLY" ] && URL="$URL&only=$(printf '%s' "$ONLY" | sed 's/ /%20/g')"
SRV=''; BPID=''; WD=''; SID=''
cleanup() {
  [ -n "$SID" ] && curl -fs -X DELETE "$WD/session/$SID" >/dev/null 2>&1   # Safari: ends the automation window
  [ -n "$BPID" ] && kill "$BPID" 2>/dev/null
  command -v pkill >/dev/null 2>&1 && pkill -f "$TMP/profile" 2>/dev/null
  [ -n "$SRV" ] && kill "$SRV" 2>/dev/null
  sleep 1; rm -rf "$TMP"; rm -f "$REPORT"
  rm -f "$ROOT/$FIG.json" "$ROOT/trash/$FIG.json"; rm -rf "$ROOT/history/$FIG"   # also after a timeout or a browser crash
}
trap cleanup EXIT INT TERM

echo "SiliCoDraw browser tests, folder: $ROOT"
echo "  browser: $BR"
echo "  page:    $URL"
"$PY" "$ROOT/serve.py" --no-browser --port "$PORT" >"$TMP/server.log" 2>&1 &
SRV=$!
i=0; until curl -fs "http://localhost:$PORT/api/files" >/dev/null 2>&1; do i=$((i+1)); [ $i -gt 80 ] && { echo "  FAIL  the server did not start"; cat "$TMP/server.log"; exit 1; }; sleep 0.25; done

if [ "$KIND" = safari ]; then
  # Safari has no headless mode: safaridriver opens a separate automation window (needs Safari → Develop → Allow Remote
  # Automation once, or `sudo safaridriver --enable`)
  WPORT=$("$PY" -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()')
  WD="http://localhost:$WPORT"
  "$BR" -p "$WPORT" >"$TMP/browser.log" 2>&1 &
  BPID=$!
  i=0; until curl -fs "$WD/status" >/dev/null 2>&1; do i=$((i+1)); [ $i -gt 40 ] && { echo "  FAIL  safaridriver did not start"; cat "$TMP/browser.log"; exit 1; }; sleep 0.25; done
  ANS=$(curl -s -X POST -H 'Content-Type: application/json' -d '{"capabilities":{"alwaysMatch":{"browserName":"safari"}}}' "$WD/session")
  SID=$(printf '%s' "$ANS" | "$PY" -c 'import json, sys; print((json.load(sys.stdin).get("value") or {}).get("sessionId") or "")' 2>/dev/null)
  if [ -z "$SID" ]; then
    echo "  FAIL  Safari refused the automation session: $ANS"
    echo "  Turn it on once: Safari → Settings → Advanced → Show features for web developers, then Develop → Allow Remote Automation"
    echo "  (or run: sudo safaridriver --enable)"; echo 'Browser tests FAILED.'; exit 1
  fi
  curl -fs -X POST -H 'Content-Type: application/json' -d '{"width":1500,"height":1100}' "$WD/session/$SID/window/rect" >/dev/null 2>&1
  curl -fs -X POST -H 'Content-Type: application/json' -d "{\"url\":\"$URL\"}" "$WD/session/$SID/url" >/dev/null 2>&1 &   # returns when the page has loaded: the polling below starts at once
elif [ "$KIND" = firefox ]; then
  # Firefox: a fresh profile of its own (--no-remote: never hands the page to a Firefox window that is already open), no first-run pages
  mkdir -p "$TMP/profile"
  cat >"$TMP/profile/user.js" <<'EOF'
user_pref("browser.shell.checkDefaultBrowser", false);
user_pref("browser.aboutwelcome.enabled", false);
user_pref("datareporting.policy.dataSubmissionEnabled", false);
user_pref("toolkit.telemetry.reportingpolicy.firstRun", false);
user_pref("browser.startup.homepage_override.mstone", "ignore");
user_pref("app.update.disabledForTesting", true);
user_pref("dom.min_background_timeout_value", 4);
user_pref("dom.timeout.enable_budget_timer_throttling", false);
EOF
  set -- --no-remote --profile "$TMP/profile" --width 1500 --height 1100
  [ "$SHOW" = 1 ] || set -- --headless "$@"
  "$BR" "$@" "$URL" >"$TMP/browser.log" 2>&1 &
  BPID=$!
else
  set -- --no-first-run --no-default-browser-check --disable-extensions --disable-sync --disable-features=Translate \
    --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows \
    --window-size=1500,1100 "--user-data-dir=$TMP/profile"
  [ "$SHOW" = 1 ] || set -- --headless=new --disable-gpu --mute-audio "$@"
  [ "$(uname -s)" = Linux ] && set -- --no-sandbox --disable-dev-shm-usage "$@"   # CI containers have no user namespaces for Chrome's sandbox and a small /dev/shm
  "$BR" "$@" "$URL" >"$TMP/browser.log" 2>&1 &
  BPID=$!
fi

T0=$(date +%s); NEXT=30
while :; do
  sleep 0.5
  if [ -s "$REPORT" ] && "$PY" -c 'import json, sys; json.load(open(sys.argv[1], encoding="utf-8"))' "$REPORT" 2>/dev/null; then break; fi
  S=$(( $(date +%s) - T0 ))
  [ $S -ge $NEXT ] && { echo "  ... still running ($S s)"; NEXT=$((NEXT+30)); }
  if [ $S -gt "$TIMEOUT" ]; then echo "  FAIL  no results after $TIMEOUT s"; tail -20 "$TMP/browser.log"; echo 'Browser tests FAILED.'; exit 1; fi
  kill -0 "$SRV" 2>/dev/null || { echo "  FAIL  the server stopped"; cat "$TMP/server.log"; echo 'Browser tests FAILED.'; exit 1; }
done

# print the results (the scratch figure, if the page could not remove it, goes in cleanup)
PYTHONIOENCODING=utf-8 "$PY" - "$REPORT" <<'EOF'
import json, sys
r = json.load(open(sys.argv[1], encoding='utf-8'))
for t in r.get('tests', []):
    tag = 'skip' if t.get('skip') else 'ok  ' if t.get('ok') else 'FAIL'
    line = '  %s  %s' % (tag, t.get('name'))
    if t.get('msg'):
        line += ' -- ' + t['msg']
    if t.get('ms') is not None:
        line += ' (%s ms)' % t['ms']
    print(line)
env = r.get('env') or {}
print('%s passed, %s failed, %s skipped in %.1f s (%s%s)' % (r.get('passed'), r.get('failed'), r.get('skipped'), (r.get('ms') or 0) / 1000, env.get('ua'), ', web version' if env.get('web') else ''))
ok = r.get('ok') is True
print('All browser tests passed.' if ok else 'Browser tests FAILED.')
sys.exit(0 if ok else 1)
EOF
RC=$?
exit $RC
