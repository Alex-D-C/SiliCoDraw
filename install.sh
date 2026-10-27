#!/bin/sh
# Install SiliCoDraw on a Mac (or Linux) with one line in Terminal:
#
#   curl -fsSL https://raw.githubusercontent.com/Alex-D-C/SiliCoDraw/main/install.sh | sh
#
# It downloads SiliCoDraw into your home folder (~/SiliCoDraw), adds a "SiliCoDraw" app on a Mac (find it with
# Command+Space) and starts it. Running the line again just starts the installed copy; your figures are never touched.
# To update later, double-click "Update SiliCoDraw.command" in the SiliCoDraw folder.
#
# Options, as environment variables: SILICODRAW_DIR=<folder> (default ~/SiliCoDraw), SILICODRAW_ZIP_URL=<zip to install>,
# SILICODRAW_NO_START=1 (install and prepare, but do not start).
#
# Everything is inside main(), called on the very last line: if the download of this script is cut off, nothing runs.

main() {
  DEST=${SILICODRAW_DIR:-$HOME/SiliCoDraw}
  URL=${SILICODRAW_ZIP_URL:-https://github.com/Alex-D-C/SiliCoDraw/archive/refs/heads/main.zip}
  stop() { printf '\n'; printf '%s\n' "$@"; printf '\nIf this keeps happening, use the "Download ZIP" steps on https://github.com/Alex-D-C/SiliCoDraw\n'; exit 1; }

  if [ -f "$DEST/serve.py" ] && [ -f "$DEST/start.sh" ] && [ -f "$DEST/figure-editor.html" ]; then
    printf 'SiliCoDraw is already installed in %s, starting it.\n' "$DEST"
    printf '(To update it, double-click "Update SiliCoDraw.command" in that folder.)\n'
  else
    if [ -e "$DEST" ]; then                     # an earlier install that did not finish: keep it, never delete
      old="$DEST-incomplete-$(date +%Y%m%d-%H%M%S)"
      mv "$DEST" "$old" || stop "Could not move the unfinished folder $DEST out of the way."
      printf 'An unfinished earlier install was moved to %s\n' "$old"
    fi
    command -v curl >/dev/null 2>&1 || stop "curl is missing on this computer; it is needed to download SiliCoDraw."
    tmp=$(mktemp -d "${TMPDIR:-/tmp}/silicodraw-install.XXXXXX") || stop "Could not create a temporary folder."
    printf 'Downloading SiliCoDraw...\n'
    if ! curl -fsSL --retry 2 -o "$tmp/silicodraw.zip" "$URL"; then
      rm -rf "$tmp"; stop "Could not download SiliCoDraw (see the message above)." "Check your internet connection and paste the line again."
    fi
    if command -v unzip >/dev/null 2>&1; then unzip -q "$tmp/silicodraw.zip" -d "$tmp/x"
    elif command -v ditto >/dev/null 2>&1; then ditto -x -k "$tmp/silicodraw.zip" "$tmp/x"
    else python3 -m zipfile -e "$tmp/silicodraw.zip" "$tmp/x"; fi
    src=$(find "$tmp/x" -mindepth 1 -maxdepth 1 -type d | head -n 1)
    if [ -z "$src" ] || [ ! -f "$src/figure-editor.html" ] || [ ! -f "$src/serve.py" ] || [ ! -f "$src/start.sh" ]; then
      rm -rf "$tmp"; stop "The download was incomplete. Paste the line again."
    fi
    mkdir -p "$(dirname "$DEST")" && mv "$src" "$DEST" || { rm -rf "$tmp"; stop "Could not create $DEST."; }
    rm -rf "$tmp"
    printf 'Installed in %s\n' "$DEST"
  fi

  if [ "${SILICODRAW_NO_START:-0}" = 1 ]; then sh "$DEST/start.sh" --setup-only; return; fi
  # this script arrives through a pipe, so questions and Ctrl+C must use the keyboard (/dev/tty), not the pipe
  if (: </dev/tty) 2>/dev/null; then sh "$DEST/start.sh" </dev/tty; else sh "$DEST/start.sh"; fi
}

main "$@"
