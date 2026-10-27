#!/bin/sh
# macOS: double-click to update SiliCoDraw from GitHub. It shows a notice and asks before changing anything; your figures,
# history, exports and assets are never touched. If a double-click is refused: open Terminal, type  sh  and a space,
# drag update.sh from this folder into the window, press Return.
exec sh "$(dirname "$0")/update.sh" "$@"
