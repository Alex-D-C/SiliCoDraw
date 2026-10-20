#!/bin/sh
# Start the Figure Editor on macOS / Linux (double-click, or run ./start.sh). Needs Python 3.
cd "$(dirname "$0")" || exit 1
if command -v python3 >/dev/null 2>&1; then exec python3 serve.py "$@"; fi
if command -v python >/dev/null 2>&1; then exec python serve.py "$@"; fi
echo "Python 3 is needed to run the editor: https://www.python.org/downloads/"
read -r _
