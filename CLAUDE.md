# SiliCoDraw — guide for AI assistants

You are working in SiliCoDraw, a self-contained scientific figure editor (poster figures, graphical
abstracts, workflow diagrams) made for co-designing figures with an AI assistant. Everything lives in this folder; there is no build step and no dependencies.

## Start it

```bash
python3 serve.py            # macOS / Linux / Windows with Python  → http://localhost:8770/
```
Windows without Python: `powershell -NoProfile -ExecutionPolicy Bypass -File serve.ps1`
(or the user double-clicks `Start SiliCoDraw.bat`).

Open `http://localhost:8770/` for `figure.json`, or `http://localhost:8770/?file=<name>.json` for any
other figure in this folder. A name that does not exist yet starts a blank figure.

## Files

| Path | What it is |
|---|---|
| `figure-editor.html` | the whole editor (vanilla JS, single file) |
| `serve.py` / `serve.ps1` | tiny file server with the save / history / export API (identical behaviour) |
| `*.json` (root) | one figure per file; `figure.json` is the default |
| `history/<name>/` | automatic snapshots of a figure (at most one per 5 min, newest 60) |
| `exports/` | PNG / SVG exports written by the editor |
| `assets/` | images the user inserted (referenced as `assets/<file>` from the figure) |
| `examples/` | example figures to copy from |

## How to change a figure

Two ways; both are picked up by an open editor within ~1.5 s (it polls the file).

1. **Edit the JSON file** (`figure.json` etc.) and save it. Keep `id`s stable. If the user is editing at
   the same moment, their unsaved change wins and your file edit is overwritten, so prefer moments when
   they are not dragging things, or use the page API.
2. **In the browser page**, a global `window.fig` exists:
   `fig.get()`, `fig.set(scene)`, `fig.add(type, props)`, `fig.update(id, props)`, `fig.remove(id)`,
   `fig.selected()`, `fig.comments()`, `fig.reply(id, text, resolve)`, `fig.template()`.
   Helpers you may call: `bbox(id)` (rendered bounds), `render()`, `commit()` (push to undo + save).

Exports: in the page, `await svgString({transparent})` returns a standalone SVG; the Export dialog
writes PNG/SVG into `exports/`; you can POST bytes to `exports/<name>.png|svg` yourself.

## Figure file format

```json
{ "version": 4, "w": 1600, "h": 900, "bg": "#ffffff", "palette": ["#6f86c8", "..."],
  "objects": [ { "id": "o1", "type": "text", "x": 100, "y": 80, "s": 1, "r": 0, "text": "Title", "size": 24 } ] }
```
Objects are drawn in array order (last = in front). Common fields on every object except arrows:
`x, y` (anchor = element centre; text anchor = baseline-left/centre/right per `anchor`), `s` scale,
`r` rotation (deg), `op` opacity, `flip`, `locked`, `hidden`, `name` (layer name), `group` (shared id).
Defaults for every type are in `DEF` in figure-editor.html; the editable fields in `SCHEMA`.

| type | key props |
|---|---|
| `text` | `text` (`\n` = line break), `size`, `weight` 300–700, `italic`, `color`, `anchor` start/middle/end, `font`, `boxW` (wrap width, 0 = none) |
| `chip` | pill label: `text`, `size`, `fill`, `color` |
| `shape` | `kind` ellipse/circle/rect/triangle/diamond/hexagon/line, `w`, `h`, `fill`, `stroke`, `sw`, `rx`, `dash` |
| `box` | rounded panel: `w`, `h`, `rx`, `fill`, `stroke`, `sw`, `dash` |
| `arrow` | `x1,y1,x2,y2` (absolute), `bend`, `color`, `width`, `head` end/both/none, `dash` |
| `icon` | `kind` (see `ICONS`: cell, cells, neuron, mito, protein, receptor, antibody, bacterium, virus, chromosome, brain, heart, drop, mouse, human, fish, tube, flask, wellplate, pipette, syringe, microscope, laptop, chart, clock, magnifier, bolt, gear), `size`, `c1`, `c2`, `label` |
| `image` | `src` (`assets/...` or data URL), `w`, `h`, `rounded`, `border` |
| `legend` | `items` lines `kind|color|label` (kind circle/up/down/line/check/cross), `dir` v/h, `size` |
| `funnel` | `stages` lines `label|count|color|height`, `wTop`, `wBottom`, `band`, `gap`, `countAt` band/after, `topCount` |
| `qr` | `url` (QR is regenerated when it changes), `size` |
| `survival` | Kaplan-Meier-style sketch: `w`, `h`, `color`, `doses`, `effect`, `series` lines `name:#hex` (first = control) |
| `gradbar`, `capsule`, `worm`, `dna`, `plate`, `badge`, `sketch` | gradient arrow, pill, C. elegans, DNA helix, petri dish, check/cross, the user's pen sketch; see `DEF` |
| `comment` | a review note: `text`, `reply`, `resolved`, `x, y` where it points. **Never exported.** |

## Comments = the review loop

Users leave comments with the **+ Comment** button. When asked to "address the comments":
1. read them (`fig.comments()` or the `comment` objects in the file),
2. make the change,
3. write a short `reply` on the comment saying what you did (`fig.reply(id, text)`), leave `resolved`
   for the user to tick. Move a comment's `x, y` if the thing it refers to moved.

## Sketch → figure

A figure may contain a `sketch` element (`strokes: [{c, w, p: [[x, y], ...]}]`, the user's rough pen
drawing) plus text elements named `sketch note` (their labels), usually with a snapshot at
`exports/<name>-sketch.png`. The user made these with the editor's Sketch mode and expects you to
turn them into a real figure. When asked: look at the picture, read the notes and their positions,
recreate the layout with proper elements on the same canvas, keep the user's wording, then set
`hidden: true` on the sketch (or remove it) and delete the notes. Leave a `comment` wherever you had
to guess.

## Files: active, archived, trash

Figures in the root are active. `archive/` holds finished ones, `trash/` deleted ones (restorable);
the editor moves files between them (`api/move`, `api/delete`). Do not edit files in `trash/`.

## Conventions

- Species names (e.g. *C. elegans*) are italicised automatically by the renderer; type them plainly.
- Keep text as real `text` objects (never bake text into images); keep colours from `palette`.
- Check your layout: load the page and use `bbox(id)` to verify nothing overlaps or leaves the page.
- Do not touch `history/`; the editor manages it. Exports go to `exports/`.
- Figures contain the user's research; do not publish or upload their contents anywhere.
