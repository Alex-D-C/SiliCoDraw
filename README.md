# Figure Editor

A small, local, open editor for scientific figures: poster figures, graphical abstracts, workflow
diagrams. One HTML file plus a tiny server. Your figures are plain JSON files in this folder, so an
AI coding assistant can draw and revise them with you, and you can drag things around by hand.

![The editor: icon library on the left, the figure in the middle, properties on the right](docs/editor.jpg)

- Vector output: export **SVG** (opens in any vector editor or slide software) or print-ready **PNG**
  at any size and dpi (tagged so it prints at the right physical size).
- A library of flat, recolourable biology & lab icons, shapes, arrows, text boxes that re-wrap when
  resized, images (drop in your plots), legends, funnels, QR codes, survival-curve sketches.
- Grouping, alignment, smart guides, layers with lock/hide, a figure-wide colour palette, templates.
- **Comments**: pin a note to any spot in the figure; an AI assistant (or a colleague) replies on it.
- Automatic version history; nothing leaves your computer.

A figure made from the built-in parts in a few minutes (`examples/workflow.json`):

![Example: a three-step workflow figure](docs/example-workflow.png)

## Quick start

**Windows:** double-click `Start Figure Editor.bat`. (Nothing to install; uses Python if you have it,
otherwise the built-in PowerShell server.)

**macOS / Linux:** `python3 serve.py` (or `sh start.sh`). Python 3 is all you need; no packages.

Then the editor opens at <http://localhost:8770/>. Keep the server window open while you work.
Works in any current browser (Chrome, Edge, Firefox, Safari); touchscreens are supported.

## Quickest start: hand the link to your AI

If you use an AI coding assistant that can run commands (Claude Code, Codex, Cursor or Copilot in
agent mode), paste this and you are done:

> Set up https://github.com/AlexDoesStuff-openaccess/openaccessfiguremaker for me: clone it (or
> download and unzip the ZIP from the Code button), open the folder, read AGENTS.md, start the figure
> editor and open it in my browser.

Chat-only assistants cannot run anything on your computer; download the ZIP yourself and open the
folder in a coding assistant.

## Use it with an AI assistant

Open this folder in **Claude Code**, **Cursor**, **Codex**, **Copilot** or any assistant that reads
`AGENTS.md` / `CLAUDE.md`, and say, for example:

> Start the figure editor and build a graphical abstract of my paper: four steps, portrait format.

> Address the comments in `abstract.json`.

> Make the lifespan panel bigger and move the legend under it.

The assistant reads the figure files, edits them (the open editor updates live), replies on your
comments, and exports PNG/SVG into `exports/`. See `AGENTS.md` for everything it knows.

## Working in the editor

- **Add** panel: search, click or drag items onto the page. Drop or paste image files to insert them.
- Double-click text to edit it in place. Right-click for the menu. `?` shows all shortcuts.
- Text boxes: drag the side handles to set the width; the text re-wraps, the font size stays.
- `Ctrl+G` groups, `Ctrl+D` duplicates, `Ctrl+S` saves now (it also saves automatically),
  `Space`+drag pans, `Ctrl`+wheel / pinch zooms, `Shift+1` fits the page.
- **File ▾**: new figure (from templates or a copy), duplicate, rename, version history, archive
  (keeps the figure list short), trash (restorable; delete permanently from the trash).
- **Sketch mode** (pencil button, or File ▾ → New figure → "Sketch my idea first"): draw a rough
  idea with a pen and place text notes, then press **Build it with my AI** — it saves a snapshot and
  gives you a ready-made request to paste into your assistant, which turns the sketch into a figure.
- **Export**: PNG with print width + dpi (optionally transparent) or SVG, written to `exports/`.

## Managing figures: active, archived, trash

Every figure is one `.json` file. The editor sorts them into three places:

| Where | What it means | How to get there |
|---|---|---|
| **Active** (the folder itself) | figures you are working on; these appear in the figure switcher in the toolbar | **File ▾ → New figure**, or bring one back from the archive or trash |
| **Archived** (`archive/`) | finished figures you want to keep but not see every day | the **archive-box icon** next to the figure switcher: *Archive “…”* at the bottom moves the open figure there; clicking an archived figure opens it (it becomes active again) |
| **Trash** (`trash/`) | figures you no longer want; still restorable | the **trash icon**: *Move “…” to trash* at the bottom; each trashed figure has **Restore** and **✕** (delete permanently) |

Nothing is deleted directly: a figure first goes to the trash, and only **✕** in the trash (or *Empty
trash*) removes it for good, together with its version history, after a confirmation. Archiving or
trashing the figure you have open takes you to the next active figure. Everything is a plain file
move, so you can also do it in your file manager while the editor is closed. Renaming and
duplicating are in **File ▾**.

## Files

```
figure-editor.html   the editor
serve.py / serve.ps1 the server (same API; PowerShell one needs no Python on Windows)
figure.json, *.json  your figures (one file each)
examples/            example figures (File ▾ → New figure → "Example: …")
history/             automatic snapshots      exports/   PNG & SVG      assets/   inserted images
```

## Privacy and network

The server listens on `localhost` only. `python3 serve.py --host 0.0.0.0` makes it reachable from
other devices on your network (e.g. a tablet) — there is no password, so do that only on a network
you trust.

## Status and contributing

Early but used daily by its author for real poster work; expect rough edges. It was built together
with an AI coding assistant, and that is also the intended way to extend it: open the folder in
your assistant and ask for the element or feature you need (`AGENTS.md` explains the structure).
Bug reports, new icons and example figures are welcome as issues or pull requests.

## Acknowledgements

All code, icons and example figures in this repository were written for it. QR codes are generated
with [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (MIT licence, Kazuhiko
Arase), fetched from a CDN at the moment you insert one; it is not bundled here.

## License

MIT — see `LICENSE`.
