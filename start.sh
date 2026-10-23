#!/bin/sh
# Start the Figure Editor on macOS / Linux (double-click, or run ./start.sh). Needs Python 3.
cd "$(dirname "$0")" || exit 1
chmod +x ./*.command ./*.sh serve.py update.py 2>/dev/null   # so the double-click launchers work next time
# macOS marks downloaded files as "quarantined" and Gatekeeper then refuses to open the .command launchers
# ("from an unidentified developer" / "Apple could not verify"); clearing the flag here makes the double-click work
command -v xattr >/dev/null 2>&1 && xattr -dr com.apple.quarantine . 2>/dev/null
if command -v python3 >/dev/null 2>&1; then exec python3 serve.py "$@"; fi
if command -v python >/dev/null 2>&1; then exec python serve.py "$@"; fi
echo "Python 3 is needed to run the editor: https://www.python.org/downloads/"
read -r _
