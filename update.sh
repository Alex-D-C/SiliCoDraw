#!/bin/sh
# Update SiliCoDraw to the latest version from GitHub (macOS / Linux). Double-click "Update SiliCoDraw.command", or
# in Terminal: type  sh  and a space, drag this file (update.sh) into the window, press Return.
# It explains everything and asks before changing anything; your figures, history, exports and assets are never touched.
DIR=$(cd "$(dirname "$0")" && pwd -P) || exit 1
cd "$DIR" || exit 1
MAC=0; [ "$(uname -s)" = Darwin ] && MAC=1
tty_ok() { [ -t 1 ] && (: </dev/tty) 2>/dev/null; }
pause() { if tty_ok; then printf '\nPress Return to close this window. '; read -r _ </dev/tty; fi; }
clt_ok() { [ -x /Library/Developer/CommandLineTools/usr/bin/python3 ] || { d=$(xcode-select -p 2>/dev/null) && [ -x "$d/usr/bin/python3" ]; }; }
for p in python3 /opt/homebrew/bin/python3 /usr/local/bin/python3 /Library/Frameworks/Python.framework/Versions/Current/bin/python3 python; do
  w=$(command -v "$p" 2>/dev/null) || continue
  if [ $MAC = 1 ] && [ "$w" = /usr/bin/python3 ] && ! clt_ok; then continue; fi
  if "$w" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 6) else 1)' >/dev/null 2>&1; then
    if tty_ok; then exec "$w" update.py --pause "$@" </dev/tty; else exec "$w" update.py "$@"; fi
  fi
done
[ $MAC = 1 ] && { clt_ok || xcode-select --install >/dev/null 2>&1; }
printf '\nThe updater needs Python 3, which is not on this computer yet.\n'
[ $MAC = 1 ] && printf 'If a window asks to install the "command line developer tools", click Install, wait until it finishes,\nthen run the update again. Otherwise install Python 3 from https://www.python.org/downloads/\n'
[ $MAC = 1 ] || printf 'Install it with your package manager (for example: sudo apt install python3), then run this again.\n'
pause
exit 1
