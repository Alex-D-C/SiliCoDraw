#!/bin/sh
# Start SiliCoDraw on macOS or Linux.
#   First time on a Mac after "Download ZIP": open Terminal, type  sh  and a space, drag this file (start.sh) into the
#   Terminal window and press Return. That also prepares the folder so that later double-clicks work.
#   After that: double-click "Start SiliCoDraw.command", or on a Mac press Command+Space, type SiliCoDraw, press Return.
#   Linux: sh start.sh
#   sh start.sh --setup-only   prepare the folder (permissions, Mac app shortcut) without starting the editor
#   Any other options go to serve.py, e.g.  sh start.sh --port 9000
DIR=$(cd "$(dirname "$0")" && pwd -P) || exit 1
cd "$DIR" || exit 1
MAC=0; [ "$(uname -s)" = Darwin ] && MAC=1

tty_ok() { [ -t 1 ] && (: </dev/tty) 2>/dev/null; }
pause() { if tty_ok; then printf '\nPress Return to close this window. '; read -r _ </dev/tty; fi; }
fail() { printf '\n'; printf '%s\n' "$@"; pause; exit 1; }

# Python: run each candidate (a Mac without the developer tools has a /usr/bin/python3 that only asks to install them)
clt_ok() { [ -x /Library/Developer/CommandLineTools/usr/bin/python3 ] || { d=$(xcode-select -p 2>/dev/null) && [ -x "$d/usr/bin/python3" ]; }; }
find_python() {
  for p in python3 /opt/homebrew/bin/python3 /usr/local/bin/python3 /Library/Frameworks/Python.framework/Versions/Current/bin/python3 python; do
    w=$(command -v "$p" 2>/dev/null) || continue
    if [ $MAC = 1 ] && [ "$w" = /usr/bin/python3 ] && ! clt_ok; then continue; fi
    if "$w" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 7) else 1)' >/dev/null 2>&1; then PY=$w; return 0; fi
  done
  return 1
}
no_python() {
  if [ $MAC = 1 ]; then
    clt_ok || xcode-select --install >/dev/null 2>&1
    fail "SiliCoDraw needs Python 3, which is not on this Mac yet." \
         "" \
         "A window should now ask to install the \"command line developer tools\":" \
         "  click Install, then Agree, and wait until it says the software was installed (5 to 20 minutes)." \
         "  Then start SiliCoDraw again exactly the way you just did." \
         "" \
         "If no window appears, or it says the software is not available:" \
         "  install Python 3 from https://www.python.org/downloads/ (the yellow Download button," \
         "  then open the downloaded file and click Continue / Agree / Install), then start SiliCoDraw again."
  fi
  fail "SiliCoDraw needs Python 3.7 or newer. Install it with your package manager," \
       "for example:  sudo apt install python3   (or https://www.python.org/downloads/), then run this again."
}

# Mac shortcut: ~/Applications/SiliCoDraw.app opens "Start SiliCoDraw.command" in this folder. It is rebuilt only when it
# is missing or points to another folder, and is made here (not downloaded), so Gatekeeper does not block it.
make_app() {
  [ "$KEEPAPP" = 1 ] && return 0                                     # a stray copy in Downloads: keep the app on the installed one
  command -v osacompile >/dev/null 2>&1 || return 0
  apps="$HOME/Applications"; app="$apps/SiliCoDraw.app"; mark="$app/Contents/Resources/silicodraw-folder.txt"
  [ -f "$mark" ] && [ "$(cat "$mark")" = "$DIR" ] && return 0
  cmd=$(printf '%s' "$DIR/Start SiliCoDraw.command" | sed 's/\\/\\\\/g; s/"/\\"/g')   # as an AppleScript string
  tmp=$(mktemp -d "${TMPDIR:-/tmp}/silicodraw.XXXXXX") || return 0
  if osacompile -o "$tmp/SiliCoDraw.app" \
      -e "set f to \"$cmd\"" \
      -e 'try' \
      -e '	do shell script "test -f " & quoted form of f' \
      -e 'on error' \
      -e '	display dialog "SiliCoDraw cannot find its folder any more (it was moved, renamed or deleted)." & return & return & "To repair this shortcut: open Terminal, type sh and a space, drag the file start.sh from the SiliCoDraw folder into the window, and press Return." buttons {"OK"} default button 1 with title "SiliCoDraw" with icon caution' \
      -e '	return' \
      -e 'end try' \
      -e 'do shell script "open " & quoted form of f' >/dev/null 2>&1; then
    printf '%s' "$DIR" > "$tmp/SiliCoDraw.app/Contents/Resources/silicodraw-folder.txt"
    codesign --force --deep --sign - "$tmp/SiliCoDraw.app" >/dev/null 2>&1
    xattr -cr "$tmp/SiliCoDraw.app" 2>/dev/null
    if mkdir -p "$apps" && rm -rf "$app" && mv "$tmp/SiliCoDraw.app" "$app"; then NEWAPP=1; fi
  fi
  rm -rf "$tmp"
}

setup() {
  chmod +x ./*.command ./*.sh serve.py update.py 2>/dev/null          # GitHub ZIPs of web-uploaded files are not executable
  if [ $MAC = 1 ]; then
    xattr -dr com.apple.quarantine . 2>/dev/null                       # downloaded files are quarantined: double-clicks are refused
    make_app
  fi
}

NEWAPP=0; KEEPAPP=0
if [ "${1:-}" = --setup-only ]; then setup; exit 0; fi

# A folder in Downloads gets deleted when Downloads is cleaned up: offer to move it to the home folder first.
case "$DIR" in
  "$HOME/Downloads/"*)
    if [ -f "$HOME/SiliCoDraw/start.sh" ]; then
      # already installed (with the user's figures): a second download must not quietly take over the app shortcut
      printf '\nSiliCoDraw is already installed in %s, and your figures are there.\n' "$HOME/SiliCoDraw"
      printf 'This is a second copy, in your Downloads folder. To update the installed copy, double-click\n"Update SiliCoDraw.command" in %s instead.\n' "$HOME/SiliCoDraw"
      KEEPAPP=1
      if tty_ok; then
        printf 'Start the installed copy now? [Y/n] '
        read -r ans </dev/tty
        case "$ans" in [nN]*) ;; *) exec sh "$HOME/SiliCoDraw/start.sh" "$@" ;; esac
      fi
    elif tty_ok && [ ! -e "$HOME/SiliCoDraw" ]; then
      printf '\nThis SiliCoDraw folder is in your Downloads folder, where it could be deleted by accident.\n'
      printf 'Move it to your home folder as "SiliCoDraw"? Your figures will be kept there. [Y/n] '
      read -r ans </dev/tty
      case "$ans" in
        [nN]*) ;;
        *) if mv "$DIR" "$HOME/SiliCoDraw"; then printf 'Moved to %s\n' "$HOME/SiliCoDraw"; exec sh "$HOME/SiliCoDraw/start.sh" "$@"; fi ;;
      esac
    fi ;;
esac

setup
find_python || no_python
printf 'Starting SiliCoDraw from %s\n' "$DIR"
if [ $NEWAPP = 1 ]; then
  printf '\nNext time, start it like any app: press Command+Space, type SiliCoDraw, press Return.\n(Tip: to put it in the Dock, open your home folder in Finder, then Applications, and drag SiliCoDraw onto the Dock.)\n\n'
fi
"$PY" serve.py "$@"
rc=$?
[ $rc = 0 ] || pause
exit $rc
