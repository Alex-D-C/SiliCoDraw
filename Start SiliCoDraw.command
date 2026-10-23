#!/bin/sh
# macOS: double-click to start SiliCoDraw. If macOS refuses to open it ("unidentified developer" / "Apple could not verify"):
# run "sh start.sh" in Terminal once (it clears the download quarantine flag), or System Settings > Privacy & Security > Open Anyway.
exec sh "$(dirname "$0")/start.sh" "$@"
