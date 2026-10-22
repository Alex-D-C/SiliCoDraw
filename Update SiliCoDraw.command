#!/bin/sh
# macOS: double-click to update SiliCoDraw from GitHub (keeps your figures, history, exports and assets).
exec sh "$(dirname "$0")/update.sh" "$@"
