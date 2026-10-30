# SiliCoDraw — guide for AI assistants

You are working in SiliCoDraw, a self-contained scientific figure editor (poster figures, graphical
abstracts, workflow diagrams) made for co-designing figures with an AI assistant. Everything lives in this folder; there is no build step and no dependencies.

## Start it

```bash
python3 serve.py            # macOS / Linux / Windows with Python  → http://localhost:8770/
```
Windows without Python: `powershell -NoProfile -ExecutionPolicy Bypass -File serve.ps1`
(or the user double-clicks `Start SiliCoDraw.bat`; macOS: `sh start.sh` or `Start SiliCoDraw.command`). The servers need Python 3.7 or newer (`serve.ps1` needs none).
Mac users usually install with the one-line installer (README, "Install and start"): it puts the folder in `~/SiliCoDraw`
and creates `~/Applications/SiliCoDraw.app`, so they start it with Command+Space, "SiliCoDraw".

Open `http://localhost:8770/` for `figure.json`, or `http://localhost:8770/?file=<name>.json` for any
other figure in this folder. A name that does not exist yet starts a blank figure (on the website it is saved only at
the first change). If there is no `figure.json` (on the website: or it is still blank), the plain address opens the figure last opened in this browser, else the
most recently changed one that is not a `*-example.json` copy, else a blank `figure.json`.

## Files

| Path | What it is |
|---|---|
| `figure-editor.html` | the whole editor (vanilla JS, single file) |
| `serve.py` / `serve.ps1` | tiny file server with the save / history / export API (identical behavior) |
| `update.py` / `update.ps1` | public release only: fetches the current version from GitHub and replaces the software files; never figures, `history/`, `exports/`, `assets/`, `archive/`, `trash/` (launchers `Update SiliCoDraw.bat` / `.command`, `update.sh`). It shows a notice and asks first (`--yes` / `-Yes` skips the question, `--check` / `-Check` only lists the changes), zips the figures into `updates/figures-backup-<date>.zip`, and puts everything back if it fails part-way. Never run it in a git clone (`git pull` there). |
| `install.sh` | public release only: the macOS / Linux one-line installer (`curl -fsSL https://raw.githubusercontent.com/Alex-D-C/SiliCoDraw/main/install.sh \| sh`) |
| `tests/` | public release only: `smoke.sh` / `smoke.ps1` (server, installer, updater) and the browser suite: `run.html` loads the editor in a frame and runs `editor-tests.js` in it (every element type, icon and example with SVG/PNG/PDF/PPTX export, undo/redo, connectors, off-page, rich text, save → reload); `browser.sh` / `browser.ps1` run it in headless Chrome/Edge (`--browser firefox` / `-Browser firefox`: headless Firefox; `--browser safari`: Safari through safaridriver on macOS), exit code 0/1; CI: `.github/workflows/test.yml`; see `tests/README.md`. Run the browser suite after changing the editor. |
| `*.json` (root) | one figure per file; `figure.json` is the default |
| `history/<name>/` | automatic snapshots of a figure (at most one per 5 min, newest 60) |
| `exports/` | PNG / PDF / TIFF / SVG / PPTX exports written by the editor |
| `assets/` | images the user inserted (referenced as `assets/<file>` from the figure) |
| `examples/` | example figures to copy from (signalling, immunology, chemistry, pathway, gantt, maths, data, icons, icon-library, workflow); they appear in File ▾ → New figure; `api/files?scope=examples` lists them |
| `lib/mathjax/` | MathJax 3.2.2 (Apache 2.0), loaded first so formulas typeset without internet; the editor falls back to the same version on a CDN when it is missing |
| (website) | silicodraw.com runs this same editor with a storage script (`window.SiliCoDrawWeb`): figures live in the browser (IndexedDB), exports are downloaded, and File ▾ → Back up all figures… / Restore from backup… move every figure as one .zip laid out like this folder (`name.json`, `archive/`, `trash/`, `assets/my-icons.json`) |

## How to change a figure

Two ways; both are picked up by an open editor within ~1.5 s (it polls the file; a tab in the background every 6 s
and at once when it is shown again).

1. **Edit the JSON file** (`figure.json` etc.) and save it. Keep `id`s stable (merging matches elements by
   id). If the user has an unsaved change at that moment, the editor merges your edit with it element by
   element and field by field (both kept; for a field you both changed, the user's value wins and the
   message's Details lists it) and saves the result; while they drag or type, your edit waits until they
   are done. The same happens between two tabs on one figure. The servers send a figure with an `ETag` (a
   hash of its content); a POST of the figure with `If-Match: <that ETag>` is refused with 409 and the
   current text when the file changed since, so a tool can merge instead of overwriting (no `If-Match`, or
   `If-Match: *`, writes without a check). A GET with `If-None-Match: <that ETag>` gets 304 (no body) while
   the file is unchanged.
   The editor writes figure files one element per line (`{"version":…,"objects":[` then one `{…}` per line), so you
   can search a file, read a range and edit one element; a file in another layout loads the same and is rewritten only
   at the next change. When the file you wrote is not valid JSON (a trailing comma) or has no `objects` list, the
   editor keeps showing the last good version, says so on the status line ("File has an error", with the parser's
   message) and in the console, and the user's next change saves over your file (closing or reloading the tab without a change does not; when the browser has no earlier version of the figure the canvas stays empty and nothing goes over the file until the user confirms on the status line): fix it right away. A valid edit taken
   in while the user has nothing unsaved is outlined on the canvas for a moment (green = added, amber = changed) with a
   toast ("Updated from the figure file: 2 added, 1 changed", Select, Ctrl+Z undoes it), and what looks wrong in the
   elements you added or changed (see `fig.check`) goes to the console.
2. **In the browser page**, a global `window.fig` exists:
   `fig.get()`, `fig.set(scene)`, `fig.add(type, props)`, `fig.update(id, props)`, `fig.remove(id or [ids])`,
   `fig.connect(a, b, props)` (an arrow attached to elements `a` and `b`, ids or `{id, side}`),
   `fig.connectMany(ids, {mode, ...props})` (mode `chain` / `star` = the first to each other / `fan` = each to the last; one step; returns the new ids), `fig.selected()`,
   `fig.comments()`, `fig.reply(id, text, resolve)`, `fig.template()` (returns the poster template scene, 2400 × 1700;
   `fig.set(fig.template())` loads it)
   (`fig.add` and `fig.connect` return the new element's id; each call is one undo step and is saved; an unknown id in
   `fig.update` / `fig.remove` throws, and nothing is removed then).
   **One step for many changes:** `fig.batch(() => { fig.add(…); fig.update(…); … }, label)` makes everything inside
   one undo step and one save (async functions too), with a toast "Assistant: N changes · Ctrl+Z undoes them"; it
   returns what the function returns; if the function throws, what it did so far is kept as that one step and the error
   is thrown on. The user's own input (a click or key), Undo/Redo or 60 s end a batch early: what it does after that is ordinary steps, so keep a batch short and do not wait inside it for the user. Use it whenever you build or change more than a couple of elements, so the user can undo your work
   with one Ctrl+Z (each separate call is its own step, and 300 steps push out the user's own history).
   **Checks:** `fig.check(ids?)` returns `[{id, level, msg}]` (level `error` / `warn` / `info`, errors first) for the
   whole figure or the given ids: unknown types, fields (with "did you mean", e.g. `colour` → `color`) and icon kinds
   (with suggestions), values not among a field's choices (arrow `head: 'triangle'`), values that are no number,
   elements entirely off the page (left out of exports), text over text, text printed below the size journals ask for
   (with a print size set), formula errors, missing pictures, and colors (`colorCheck()` → `{text, alike}`: text below
   4.5:1 contrast against what it sits on, 3:1 for large text = 18 pt or 14 pt bold; text on pictures is not checked;
   colors inside one chart, legend, network or Gantt chart closer than ΔE 10 in normal vision, deuteranopia or protanopia).
   The user sees the same in Page → **Check colors** and the Export dialog. **Colors:** `cvdPreview('deutan' |
   'protan' | 'tritan' | 'gray' | '')` shows the canvas as seen with that color-vision type (this tab only: never saved
   or exported; `cvdPreview()` returns the mode); `recolorFig({'#old': '#new', …})` swaps colors everywhere at once
   (then `commit()`); `PAL_PRESETS` holds the colorblind-safe palettes of Edit palette… (Okabe–Ito, Paul Tol, viridis, cividis). `fig.add` and `fig.update` check what they were given
   and `console.warn` it; `fig.update` returns that list (`[]` = fine).
   **Finding things:** `fig.list()` (one row per element: `{id, type, name, text, kind, bbox: [x, y, w, h], group,
   hidden, locked}`, comments also `status` and `on`), `fig.findIcon(word, n = 8)` (icon keys for a word, ranked like the
   Add panel's search: `fig.findIcon('mitochondria')` → `mito` first), `fig.schema(type)` (`{defaults, fields: [{key,
   kind, label, options}], common}`), `fig.select(ids)` (selects them and scrolls them into view, e.g. to show the user
   something or before align / group, which act on the selection; returns the selected ids).
   Multi-panel figures: `fig.labelPanels(ids, {style, size})` puts a bold letter above each panel's top-left corner in
   reading order (a group counts once; style `a`/`A`/`(a)`/`A.`, default the figure's own; 8 pt at the print size, else
   40 px; letters are text named `panel letter` with `panel` = the panel's id or `g:<group>`; running it again renumbers
   and re-places them), `fig.reletterPanels()` (a, b, c… again in reading order of where the letters are),
   `fig.arrange(ids, {cols, gap, gapMm, sameHeight})` (a grid in reading order, rows top-aligned, columns left-aligned,
   `gap` px or `gapMm` printed; letters move with their panels and a row with letters keeps at least their height from
   the row above; returns `{cols, rows, gap}`),
   `fig.printSize(size, mm)` (no argument: `{size, mm, ptPerPx}`; `size` = an `EXPORT_SIZES` key such as `"1.2"` for
   Nature double column, or `""` with `mm`), `fig.raiseText(pt)` (every text printed below `pt` raised to it, one step).
   Helpers you may call: `bbox(id)` (rendered bounds), `render()`, `commit()` (push to undo + save).
   `fig.prefs()` returns the editor's Appearance settings and `fig.prefs({theme: 'dark'})` changes them (theme
   light/dark/system, style classic/soft/flat/contrast, accent, layout std/swap/right, text, density, labels, motion).
   They live in the browser only, never in the figure, and never change exports.

Exports: in the page, `await svgString({transparent})` returns a standalone SVG,
`await makePng(W, dpi, {transparent})` returns `{bytes}` (W px wide, tagged with its dpi),
`await makePdf({mm, dpi, transparent, raster})` returns `{blob, notes}` (a vector PDF page `mm` wide: text stays text in
the standard PDF fonts Helvetica/Times/Courier at the widths it has on the canvas, Greek and math signs in Symbol;
characters no PDF font has (CJK, emoji) and filters or patterns become 600 dpi pictures; `raster: true` = the whole
page as one picture at `dpi`), `await makeTiff(W, dpi, {transparent, lzw})` returns `{blob}` (RGB, RGBA when
transparent, LZW unless `lzw: false`), and `await exportPptx()` returns `{blob, print}` for a PowerPoint slide with editable
objects (Google Slides opens the same `.pptx`). `copySelPng()` / `copySelSvg()` put the selection on the system clipboard as a PNG (2×, long side at most 4000 px, transparent) / SVG (right-click menu, Ctrl+Shift+C). The Export dialog (Ctrl+E) writes PNG/PDF/TIFF/SVG/PPTX into
`exports/`; its **Size** list (`EXPORT_SIZES`: journal columns such as Nature 89/120/183 mm, Cell Press 85/114/174,
Science 55/120/183, PNAS 87/114/178, PLOS 132/190, eLife 100/200, A0/A1 and US 36 × 48, 48 × 36, 44 × 44, 72 × 36 in posters) sets the print width and dpi and
checks the smallest text in pt, the thinnest line (`exportCheck()`) and pictures under 300 ppi at that width
(`picPpi(scene, mm)`; 150 for posters); the figure keeps the last choice as `exportMm`, `exportDpi`, `exportSize`, which
is also its **print size** (Page panel: font size fields then show their printed pt; **Text sizes…** lists every printed
size and raises everything below a size in one step; a poster or full-page sheet on a page of another shape says how much of the sheet stays empty, `sheetGap()`, and **Give the page the sheet's shape** fixes it, `sheetPage()`; the Export dialog offers it too for a sheet picked there, `sheetPage(sizeKey, dpi)`, which also makes that the print size). A poster print size (or a custom one of 300 mm or more) also sets the PowerPoint slide to the printed size (`pptxMm(scene)`, `pptxSetup(PptxGenJS, W, H, mm)`), so font sizes there are the printed ones; journal sizes keep 96 px = 1 in. On a page wider than 2000 px, or with a poster print size, elements added from the Add panel start scaled (`addScale()`: body text about 28 pt at a poster size); `fig.add`, paste and files keep their sizes. You can POST bytes to `exports/<name>.png|svg|pdf|tif|pptx` yourself (a server
started before PDF/TIFF existed refuses those two: restart it).
Several figures at once: File ▾ → "Export several figures…" (`batchExportDialog()`): PNG/PDF/TIFF/SVG per
figure, one PDF with a page per figure (`pdfStart` + `pdfAddPage` per rendered scene + `pdfFinish`), or one `.pptx`
with a slide per figure (`pptxSetup` + `pptxAddScene` per rendered scene).

## Figure file format

```json
{ "version": 4, "w": 1600, "h": 900, "bg": "#ffffff", "palette": ["#6f86c8", "..."],
  "objects": [ { "id": "o1", "type": "text", "x": 100, "y": 80, "s": 1, "r": 0, "text": "Title", "size": 24 } ] }
```
Optional `seriesPal` (`["#0072b2", …]`, set by Edit palette… → "use for chart series"): data series, curves, survival
lines and network modules without a color of their own take these colors in order (after the chart's own
`color`/`color2`; a plot, function plot or survival chart still in its default colors, or added afterwards from the Add
panel or with `fig.add`, gets `color`/`color2` = the first two); without it they use each type's built-in cycle.
Objects are drawn in array order (last = in front). Common fields on every object except arrows
(which use `x1,y1,x2,y2`):
`x, y` (anchor = element center; text anchor = baseline-left/center/right per `anchor`), `s` scale,
`r` rotation (deg), `flip`. On every object, arrows included: `op` opacity, `locked`, `hidden`, `name`
(layer name), `group` (shared id of the outermost group) and `pg` (nested groups: the ids of the groups
inside it that the element also belongs to, innermost first; Ungroup takes off one level).
Defaults for every type are in `DEF` in figure-editor.html; the editable fields in `SCHEMA`.

| type | key props |
|---|---|
| `text` | `text` (`\n` = line break; inline formatting in any text: `**bold**`, `*italic*`, `__underline__`, `~~strike~~`, `x^2` / `x^{2+}` superscript, `H_2O` / `CO_{2}` subscript (without braces only digits and signs: `x^{n}`, `x_{i}`), `{#hex\|colored}`; bold may hold italic and the reverse, `***x***` = both; `\*` `\_` `\~` `\^` `\{` type the mark itself; lone `*`, significance stars (`*p<0.05`, `***`) and snake_case are left alone, and so are sample names: a bare `_digits` after a word ending in two lowercase letters, or followed by `_`, stays as typed, e.g. `rep_1`, `ctrl_2`, `day_7_treated` (`log_2`, `t_0`, `C_6H_12O_6`, `x_1x_2` are subscripts; `rep_{1}` makes one)), `size`, `weight` 300–700, `italic`, `color`, `anchor` start/middle/end, `font` (a CSS font list; the panel offers Helvetica/Arial, Arial, Calibri, Segoe UI, Verdana, Georgia, Times, Courier monospace and lists any other font set in the file), `boxW` (wrap width, 0 = none; a word wider than it, such as a gene list, link or DOI, breaks after / - _ . , ; = & ? or else between characters; species names never break), `lh` (line spacing × size, blank = 1.25) |
| `chip` | pill label: `text` (`\n` = a second line; the pill grows), `size`, `fill`, `color` |
| `shape` | `kind` ellipse/circle/rect/triangle/diamond/hexagon/line, `w`, `h`, `fill`, `stroke`, `sw`, `rx`, `dash` |
| `box` | rounded panel: `w`, `h`, `rx`, `fill`, `stroke`, `sw`, `dash`. A **section box** also holds its own text: `text` (rich text, wraps to `w` minus `pad` on both sides and re-wraps when the width changes; the font size stays), `size`, `weight`, `anchor`, `valign` top/middle, `color`, `font`, `lh` (line spacing, blank = 1.25), `pad` (inner margin px, 16), `grow` (true: drawn as tall as its text needs, never shorter than `h`, growing downward: the top stays at `y` − `h`/2; `h` itself is not changed), and an optional header strip `title`, `titleSize`, `titleFill`, `titleColor`. Double-click (Enter / F2) edits the text in place; the side handles of a selected box (not turned) change `w`. PowerPoint gets one native shape holding the text (the header as a second shape with rounded top corners, and the outline as a third on top, grouped with it). A box without `text` and `title` draws as before. |
| `arrow` | `x1,y1,x2,y2` (absolute), `route` line/elbow/elbowH/elbowV, `bend` (line only), `head` and `tail` markers: arrow/open/bar (inhibition ⊣)/circle/diamond/none, `style` solid/dashed/dotted, `color`, `width`, `label` (`\n` = line break), `labelSize`, `labelPos` (0–1 along the drawn line; blank = the middle, on an elbow the middle of its longest leg), `labelOff` (px beside the line, + = left of the direction it runs), `labelBg` auto (the page color)/none/a color. `route: "elbow"` bends up to twice: ends on sides facing each other make a Z (`mid` = where the middle leg is, 0–1 of the way, default 0.5), sides facing the same way a loop (U, `loop` = px beyond the farther end, default 24; its own field, so a Z's `mid` never moves a loop), a target behind its side an S; one side across and one up/down an L; free ends face each other. The editor writes `dirs` (the two ends' sides, e.g. `"ew"`) for attached ends; leave it. `elbowH`/`elbowV` = one bend (across first / up/down first). Older `head: end/both` + `dash` still load. **Connectors:** `from` / `to` attach the start / end to an element so it follows it (moved, turned, resized, aligned, undone, edited in the file): `{"id": "o12"}` = auto (the side facing the other end; elbow routes pick matching sides, and elements side by side or one above the other get a straight line), or with `"side"`: `"n"`/`"e"`/`"s"`/`"w"` (that side's middle) or a number 0–1 (a point of the outline, clockwise from the top middle: 0.25 = right middle, 0.5 = bottom). The editor keeps that end's coordinates on the element's visible outline, `gap` px (default 4) outside it; leave them as they are when you edit the file (the file keeps the old coordinates until the next change made in the editor; `fig.get()` has the current ones). Both ends on the same element: only the start stays attached; an elbowH/elbowV whose fixed side it cannot meet at a right angle switches to the other one, or to `elbow` (right side → left side, loops). Several ends in the middle of one side of an element are spread along it in the order of their other ends (a straight connection through a stretch two elements share keeps its point; `spread: false` on an arrow keeps it at the middle). `fig.update` with `x1`/`y1` (or `x2`/`y2`) frees that end; an end whose element is deleted stays where it is, free. Users attach by dragging an end onto an element or with **Connect** (two or more selected: a chain; also "1 → each" and "each → last"; new arrows take the look of the arrow last selected). PowerPoint export: connectors glued to the shapes (`elbow` Z/U as bentConnector3, its label a separate text box). |
| `fplot` | function plot: `fns` (one expression of x per line, e.g. `sin(x)`, `a*exp(-b*x)`, `f(x) = x^2 - 2`; `#hex` sets the color), `params` (`a=1, b=0.5`), `xmin`, `xmax`, `ymin`/`ymax` (blank = auto), `w`, `h`, `axes` origin/box/none, `grid`, `legend`, `xlabel`, `ylabel`, `labelSize`, `sw`, `color`, `color2`. Parser: + − × ÷ ^, implicit multiplication, pi, e, sin cos tan asin acos atan sinh cosh tanh exp ln log log10 log2 sqrt cbrt abs floor ceil round sign min max pow atan2. |
| `geom` | live geometry: `kind` polygon/path/angle, `pts` `[[x,y],…]` in element coordinates (dragged by handles), `showAngles` (arcs + degrees, right-angle marker), `showSides` (lengths), `showArea`, `unit` (px per unit), `suffix`, `decimals`, `fill`, `stroke`, `sw`, `labelSize`, `color` |
| `vec` | vector from the origin: `vx`, `vy` (units), `unit` (px per unit), `label`, `showComp`, `showAxes`, `showValues` (components, magnitude, angle), `decimals`, `color` |
| `ucircle` | unit circle: `theta` (°), `rad` (radius px), `showSin`, `showCos`, `showTan`, `decimals`, `color` |
| `mgrid`, `numline` | coordinate grid (`w`, `h`, `step`, `axes`, `labels`); number line (`min`, `max`, `step`, `len`, `marks` lines `name: value`) |
| `gantt` | a whole Gantt chart; origin = top-left. `title`, `titleSize`, `titleStyle` bold/normal/italic, `cols` (`Nov\|Dec\|Jan…`), `colW`, `halves` (half-column dividers), `snap` (drag step in column units), `labelW` (label column), `rowH`, `barH`, `rx`, `labelSize`, `labelPos`, `colLabelSize`, `msSize`, `legend`, `legendSize`, `zebra`, `color`, `lineColor`, `today` (column units, red dashed line). Lists, one entry per line: `tasks` = `label\|start\|end\|phase[\|opacity]` (times in column units: 0 = start of first column, 1 = its end, 0.5 = half); `phases` = `key\|#fill\|legend label[\|flags[\|#stroke]]` (flags: `dashed`, `hidden` = not in the legend); `milestones` = `at\|row\|label` (row 1-based; `at` = a time, or `start`/`end` = attached to that row's bar so it moves with it); `deps` = `fromRow>toRow`. `labelPos` left/before/after/bar decides where task labels sit (before/after/bar travel with the bar). Users drag bars/ends/milestones on the canvas; you just edit the lists. |
| `icon` | `kind`: one of ~1500 flat icons in `ICONS` (cells & tissues, molecules & genetics, aging & hallmarks, immunology & infection, anatomy, organisms, chemistry, lab, techniques & assays, medicine, mind & behavior, statistics, AI & computing, mathematics, physics, engineering, energy & electronics, transport, earth & climate, ecology & agriculture, society & economics, food & sport, history & humanities, symbols; grouped in `ICON_GROUPS`; `Object.keys(ICONS)` lists them, e.g. cell, neuron, mito, receptor, gpcr, kinase, antibody, tcell, macrophage, bacterium, phage, virus, lungs, liver, colon, mouse, nematode, killifish, fly, yeast, molecule, atom, beaker, flask, pipette, microscope, westernblot, elisa, patchclamp, stethoscope, elder, rapamycin, metformin, mtor, sirtuin, sabgal, centenarian, gompertz, scatter, boxplot, heatmap, neuralnet, robot, sigma, matrix, magnet, bulb, wrench, car, satellite, volcano, wheat, solarpanel, survey, coin, headmind, apple, galaxy, scroll, target, warning), `size`, `c1` (main color), `c2` (accent), `label` (`\n` = line break), `labelColor` (blank = #374151). New icon: add `ICONS.key={n,t,c:[c1,c2],d:(a,b,o)=>svg}` drawn in a 100×100 box centered on 0 and list the key in `ICON_GROUPS`. |
| `formula` | a LaTeX formula typeset to vector paths: `tex` (LaTeX, e.g. `\frac{dN}{dt} = rN`), `size` (font size px), `color`, `display` (true = large Σ ∫). The editor typesets it with MathJax (`lib/mathjax/`, else a CDN) and stores the paths in `paths`/`vb`; just set `tex` and let the page render. Users edit it with the formula builder (double-click). |
| `plot` | a small chart from typed values: `kind` bar/line/scatter/box/pie, `data` (one line per item: bars `label: value ± err`, box `label: raw values`, line/scatter `name: x,y x,y …` or `name: y y y`, pie `label: value`; `#hex` at the end sets the color), `w`, `h` (plot area), `color`, `color2`, `xlabel`, `ylabel`, `labelSize`, `ymin`/`ymax` (blank = auto), `axes`, `legend` |
| `elem` | periodic-table tile: `symbol`, `number`, `mass`, `name`, `size`, `fill`, `stroke`, `color` |
| `membrane` | a bendable, extendable lipid bilayer (or monolayer, beads, tube): `pts` `[[x,y],…]` in element coordinates define a curve (Catmull-Rom through the points; `smooth:false` = straight stretches); `kind` open/closed (closed = vesicle or cell outline, filled with `fill` at `fillOp`); `style` bilayer/monolayer/beads/tube; `spacing` (px between lipids; the count follows the length automatically), `head` (radius), `tail` (length), `c1` head color, `c2` tail color, `sw`. Users drag the points: an end point extends it, a middle point bends it; panel buttons Add point / Remove point / Extend / Make circle / Straighten / Flip sides. |
| `chem` | a structural (skeletal) formula. Easiest: set `smiles` (e.g. `CCCC(=O)O`, `c1ccccc1`, `Cn1cnc2c1c(=O)n(C)c(=O)n2C`); the editor parses it (organic subset, bracket atoms with charge/H, ring closures, branches, aromatic atoms kekulized, `.` fragments) and lays it out (rings as regular polygons, fused rings, zigzag chains, substituents outward). Explicit model: `atoms` `[{x, y, el, q, h}]` in element coordinates, `bonds` `[{a, b, o:1|2|3, st:''|'wedge'|'hash'}]`; `applied` = the SMILES the atoms came from (set `applied:''` to force a re-layout). Also `bondLen` (40), `labelSize`, `sw`, `color`, `showC` (label carbons), `showH` (implicit H on heteroatoms). Users grow and edit structures on the canvas: click an atom → blue dots mark free bonds, type an element letter, 1/2/3 bond order, W/D wedge/hash, +/− charge, Del. Bridged ring systems are laid out approximately. |
| `netmed` | network-medicine diagram (STRING-like): `modules` lines `name\|dots\|#color\|gene,names` (one module per line, max 12), `bg` unassociated dots, `overlap` dots shared by neighboring modules, `pIn`/`pOut`/`pMB`/`pBB` link chances (inside a module / between modules / module dot to unassociated dot / among unassociated dots; a degree-corrected stochastic block model with a fixed random number per pair, so settings changes keep existing links), `hubs` 0–1 (heavy-tailed dot weights: a few hubs), `spacing` (module spacing in a fresh layout), `connect` (keep modules connected), `hideIsolated`, `drugs` lines `name\|targets\|#color\|spread\|A=0.9;B=0.2` (targets = number of target dots; spread 0–1 = targets close together vs spread across the network; per-module proximity 0–1 by module name or letter: 1 = targets inside the module, 0 = as far as the network allows, a module left out has no say; targets are picked by shortest-path distance to the modules; older `name\|module\|targets\|#color` lines still load; the panel has sliders per drug; `showStats` lists each drug's average target distance to every module (Guney 2016 "closest" proximity)), `seed`, `w`, `h` (layout area), display options (`showEdges`, `edgeFilter` all/within/between, `edgeColorMode`, `edgeColor`, `edgeW`, `edgeOp`, `curved`, `bridgeHi`, `bridgeColor`, `showBlobs`, `blobShape` hull/bubble, `blobStyle` fill/outline/dashed, `blobOp`, `blobPad`, `nodeR`, `sizeByDegree`, `nodeStyle` flat/ring/string, `bgColor`, `nodeStroke`, `nodeSW`, `showLabels`, `labelSize`, `showNodeLabels`, `nodeLabelSize`, `focus` (module names/letters to highlight), `showLegend`, `showStats` (largest connected piece per module and the network separation s(A,B))). State: `pos` `{dotKey:[x,y]}` (keys `m<id>:3` = dot 4 of the module with stable id `<id>` from `mids` (ids follow the module lines by name, also `dids` for drugs), `o<idA>-<idB>:1` shared, `b:7` unassociated, `d<id>` drug; delete `pos` to re-layout), `addE`/`delE` hand-edited links as `"key~key"`. Users drag dots on the canvas (Shift = whole module) and click two dots to add/remove the link. Panel **Scatter randomly** puts every dot at a random spot (links stay; `scattered: true`, the clustered positions kept in `posClustered`) and **Gather into modules** animates them back (page functions `nmScatter(o)` / `nmGather(o)`). |
| `scalebar` | microscopy scale bar: `len` (px), `label` (e.g. `50 µm`), `thick`, `size`, `color`, `pos` above/below |
| `image` | `src` (`assets/...` or data URL), `w`, `h`, `fit` crop/stretch, `fx`, `fy`, `rounded`, `border`. `fit: "crop"` (new pictures): `w` × `h` is a frame the picture fills without distortion, `fx`/`fy` 0–1 pick the part shown (0.5 = centered); `"stretch"` = drawn at exactly `w` × `h` (a file without `fit` loads as stretch, so older figures look the same; the panel keeps a stretched picture's proportions and has Original proportions). Same width/height/size scale a picture with `s`. PowerPoint gets the whole picture with its own crop. Pictures the user inserts in other formats (TIFF, HEIC, BMP, AVIF) are stored as PNG (HEIC as JPEG) first (`imgConvert`, TIFF through `tiffDecode`), so `src` is always PNG, JPEG, GIF, WebP or SVG. |
| `path` | one editable shape: `d` (SVG path data in element coordinates), `ox`/`oy` (offset so the anchor is the shape's center), `fill`, `stroke`, `sw`, `dash`. Right-click an icon (or any composite element) → **Convert to editable parts** turns it into independent `path`/`text` elements (not grouped, so each part is selected and moved on its own); the user then recolors, moves or deletes them and box-selects them to fuse. |
| `custom` | one element holding raw SVG: `svg` (fragment in element coordinates), `w`, `h`. Right-click several selected elements → **Fuse into one element** produces it (keeps figures fast); **Convert to editable parts** splits it again. Exports as a picture in PPTX. |
| user icons | **Save as icon…** (right-click, or the button in the side panel when several elements are selected) stores the selection as a new icon in the user's own library under a name the user types; the key is made from that name (`ICONS[key].user === true`; built-in icons are untouched). A selected group of ordinary elements stays in the figure; parts made with Convert to editable parts are replaced by the new icon. Definitions `{n, t, svg, k, c, from}` live in `assets/my-icons.json` (never replaced by the updater; written through `POST assets/my-icons.json`) and are embedded as `scene.icons` in every figure that uses them, so a figure renders anywhere. They appear under "My icons" in the Add panel; ✕ on an item removes it from the library (figures that still use it keep their copy). |
| `legend` | `items` lines `kind|color|label` (kind circle/up/down/line/check/cross), `dir` v/h, `size`, `gap` (between items when horizontal) |
| `funnel` | `stages` lines `label|count|color|height`, `wTop`, `wBottom`, `band`, `gap`, `size` (label size), `countSize`, `textColor` (label color), `labelDy`, `countAt` band/after, `topCount` |
| `qr` | `url` (QR is regenerated when it changes), `size`, `fg` (dark color), `bg` (background) |
| `survival` | Kaplan-Meier-style sketch: `w`, `h`, `color`, `doses`, `effect`, `series` lines `name` or `name:#hex` (first = control, drawn gray; a treated line without a color takes `color`, the next ones the figure's series palette `seriesPal` or else Okabe–Ito colors, so every line differs), `legend` + `legendA`/`legendB` (only without `series`), `xlabel`, `ylabel` |
| `gradbar` | gradient arrow: `w`, `h`, `c1` (left color), `c2` (right color), `labelL`, `labelM`, `labelR`, `labelSize` |
| `capsule` | pill: `w`, `h`, `parts` 2/3, `cl`, `cm`, `cr` (left / middle / right colors) |
| `worm` | C. elegans: `len`, `width`, `amp` (wiggle), `waves`, `phase`, `color`, `stroke`, `details` |
| `dna` | DNA helix: `len`, `width`, `turns`, `c1`, `c2` (strand colors) |
| `plate` | petri dish: `seed`, `worms` (count), `agar` (color), `ringOn`, `ring` (color), `status` none/pass/fail, `label` |
| `badge`, `sketch` | check/cross badge (`kind` check/cross, `size`); the user's pen sketch (`strokes`, see Sketch → figure) |
| `comment` | a review note: `text`, `reply`, `resolved`, `collapsed` (bubble closed with its ✕; selecting it opens it again), `x, y` where it points, `on` `{id, fx, fy}` = the element it is pinned to (the pin as fractions of that element's drawn bounds; it moves with the element; set `on: "<id>"` and the editor pins it there, on the element's top-right corner when the pin is not over it; a pin moved itself is pinned to what lies under it; when the element is deleted `on` goes and the pin stays), `replyTo` (the comment text your reply answered: `fig.reply` sets it; when you write a `reply` into the file, set `replyTo` to the comment's `text` or leave it out and the editor fills it in). `fig.comments()` adds `n` (pin number), `on`, `onName` and `status`: `new` (no reply), `answered`, `edited` (the text changed since your reply), `resolved`. A comment left without text and reply is removed by the editor. **Never exported.** |

## Comments = the review loop

Users leave comments with the **+ Comment** button. When asked to "address the comments":
1. read them (`fig.comments()` or the `comment` objects in the file); `on` / `onName` say which element a comment is
   pinned to, `status` which ones still need you (`new`, or `edited` after your reply),
2. make the change,
3. write a short `reply` on the comment saying what you did (`fig.reply(id, text)`), leave `resolved`
   for the user to tick. A pinned comment moves with its element by itself; move the `x, y` of one without `on`
   if the thing it refers to moved (or set `on` to that element's id).

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

- Species names are italicized automatically by the renderer (common binomials such as *Caenorhabditis elegans* or *Drosophila melanogaster*, genus names on their own, and abbreviated forms such as *C. elegans*, *E. coli*, *S. cerevisiae*); type them plainly.
- Keep text as real `text` objects (never bake text into images); keep colors from `palette`. For data with several
  series prefer a colorblind-safe palette (Okabe–Ito: `#0072b2 #e69f00 #009e73 #cc79a7 #56b4e9 #d55e00`); the default
  blue `#6f86c8` and purple `#b07cc6` look the same to protanopes.
- Charts, legends, icon labels and networks draw their own labels and axes light gray on a dark page or on a dark box
  or shape under them (and keep the old dark gray on light ones); text and arrows added there start light too (also with
  `fig.add`, unless the call sets `color`; geometry also gets a dark fill so its angle labels stay readable).
- Check your layout: load the page and run `fig.check()` after building (unknown fields and icons, off-page
  elements, text over text, small printed text, low contrast, look-alike chart colors); `bbox(id)` / `fig.list()` give the rendered bounds.
- Do not touch `history/`; the editor manages it. Exports go to `exports/`.
- Figures contain the user's research; do not publish or upload their contents anywhere.
