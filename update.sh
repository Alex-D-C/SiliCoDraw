#!/bin/sh
# Update SiliCoDraw to the latest version from GitHub (macOS / Linux): sh update.sh
# Your figures, history, exports and assets are never touched; nothing is deleted. Needs Python 3.
cd "$(dirname "$0")" || exit 1
if command -v python3 >/dev/null 2>&1; then exec python3 update.py --pause "$@"; fi
if command -v python >/dev/null 2>&1; then exec python update.py --pause "$@"; fi
echo "Python 3 is needed to update: https://www.python.org/downloads/"
read -r _
