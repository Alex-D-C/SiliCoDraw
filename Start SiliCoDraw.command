#!/bin/sh
# macOS: double-click to start SiliCoDraw (or press Command+Space and type SiliCoDraw, once it has run one time).
# The very first time after "Download ZIP" a double-click is refused (the file is not executable yet and macOS has not
# checked it). Instead: open Terminal, type  sh  and a space, drag start.sh from this folder into the window, press
# Return. That prepares the folder; from then on double-clicking this file works.
exec sh "$(dirname "$0")/start.sh" "$@"
