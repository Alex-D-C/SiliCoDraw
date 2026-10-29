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
other figure in this folder. A name that does not exist yet starts a blank figure. If there is no
`figure.json`, the plain address opens the first active figure instead.

## Files

| Path | What it is |
|---|---|
| `figure-editor.html` | the whole editor (vanilla JS, single file) |
| `serve.py` / `serve.ps1` | tiny file server with the save / history / export API (identical behavior) |
| `update.py` / `update.ps1` | public release only: fetches the current version from GitHub and replaces the software files; never figures, `history/`, `exports/`, `assets/`, `archive/`, `trash/` (launchers `Update SiliCoDraw.bat` / `.command`, `update.sh`). It shows a notice and asks first (`--yes` / `-Yes` skips the question, `--check` / `-Check` only lists the changes), zips the figures into `updates/figures-backup-<date>.zip`, and puts everything back if it fails part-way. Never run it in a git clone (`git pull` there). |
| `install.sh` | public release only: the macOS / Linux one-line installer (`curl -fsSL https://raw.githubusercontent.com/Alex-D-C/SiliCoDraw/main/install.sh \| sh`) |
| `*.json` (root) | one figure per file; `figure.json` is the default |
| `history/<name>/` | automatic snapshots of a figure (at most one per 5 min, newest 60) |
| `exports/` | PNG / SVG / PPTX exports written by the editor |
| `assets/` | images the user inserted (referenced as `assets/<file>` from the figure) |
| `examples/` | example figures to copy from (signalling, immunology, chemistry, pathway, gantt, maths, data, icons, icon-library, workflow); they appear in File ▾ → New figure; `api/files?scope=examples` lists them |

## How to change a figure

Two ways; both are picked up by an open editor within ~1.5 s (it polls the file).

1. **Edit the JSON file** (`figure.json` etc.) and save it. Keep `id`s stable. If the user is editing at
   the same moment, their unsaved change wins and your file edit is overwritten, so prefer moments when
   they are not dragging things, or use the page API.
2. **In the browser page**, a global `window.fig` exists:
   `fig.get()`, `fig.set(scene)`, `fig.add(type, props)`, `fig.update(id, props)`, `fig.remove(id)`,
   `fig.selected()`, `fig.comments()`, `fig.reply(id, text, resolve)`, `fig.template()`
   (`fig.add` returns the new element's id; each call is one undo step and is saved).
   Helpers you may call: `bbox(id)` (rendered bounds), `render()`, `commit()` (push to undo + save).
   `fig.prefs()` returns the editor's Appearance settings and `fig.prefs({theme: 'dark'})` changes them (theme
   light/dark/system, style classic/soft/flat/contrast, accent, layout std/swap/right, text, density, labels, motion).
   They live in the browser only, never in the figure, and never change exports.

Exports: in the page, `await svgString({transparent})` returns a standalone SVG and
`await exportPptx()` returns `{blob}` for a PowerPoint slide with editable objects (Google Slides opens
the same `.pptx`); the Export dialog
writes PNG/SVG/PPTX into `exports/`; you can POST bytes to `exports/<name>.png|svg|pptx` yourself.
Several figures at once: File ▾ → "Export several figures…" (`batchExportDialog()`): PNG/SVG per
figure, or one `.pptx` with a slide per figure (`pptxSetup` + `pptxAddScene` per rendered scene).

## Figure file format

```json
{ "version": 4, "w": 1600, "h": 900, "bg": "#ffffff", "palette": ["#6f86c8", "..."],
  "objects": [ { "id": "o1", "type": "text", "x": 100, "y": 80, "s": 1, "r": 0, "text": "Title", "size": 24 } ] }
```
Objects are drawn in array order (last = in front). Common fields on every object except arrows
(which use `x1,y1,x2,y2`):
`x, y` (anchor = element center; text anchor = baseline-left/center/right per `anchor`), `s` scale,
`r` rotation (deg), `flip`. On every object, arrows included: `op` opacity, `locked`, `hidden`, `name`
(layer name), `group` (shared id of the outermost group) and `pg` (nested groups: the ids of the groups
inside it that the element also belongs to, innermost first; Ungroup takes off one level).
Defaults for every type are in `DEF` in figure-editor.html; the editable fields in `SCHEMA`.

| type | key props |
|---|---|
| `text` | `text` (`\n` = line break; inline formatting in any text: `**bold**`, `*italic*`, `__underline__`, `~~strike~~`, `x^2` / `x^{2+}` superscript, `H_2O` / `CO_{2}` subscript (without braces only digits and signs: `x^{n}`, `x_{i}`), `{#hex\|colored}`; bold may hold italic and the reverse, `***x***` = both; `\*` `\_` `\~` `\^` `\{` type the mark itself; lone `*`, significance stars (`*p<0.05`, `***`) and snake_case are left alone), `size`, `weight` 300–700, `italic`, `color`, `anchor` start/middle/end, `font`, `boxW` (wrap width, 0 = none) |
| `chip` | pill label: `text`, `size`, `fill`, `color` |
| `shape` | `kind` ellipse/circle/rect/triangle/diamond/hexagon/line, `w`, `h`, `fill`, `stroke`, `sw`, `rx`, `dash` |
| `box` | rounded panel: `w`, `h`, `rx`, `fill`, `stroke`, `sw`, `dash` |
| `arrow` | `x1,y1,x2,y2` (absolute), `route` line/elbowH/elbowV, `bend` (line only), `head` and `tail` markers: arrow/open/bar (inhibition ⊣)/circle/diamond/none, `style` solid/dashed/dotted, `color`, `width`, `label` (text at the midpoint), `labelSize`. Older `head: end/both` + `dash` still load. |
| `fplot` | function plot: `fns` (one expression of x per line, e.g. `sin(x)`, `a*exp(-b*x)`, `f(x) = x^2 - 2`; `#hex` sets the color), `params` (`a=1, b=0.5`), `xmin`, `xmax`, `ymin`/`ymax` (blank = auto), `w`, `h`, `axes` origin/box/none, `grid`, `legend`, `xlabel`, `ylabel`, `labelSize`, `sw`, `color`, `color2`. Parser: + − × ÷ ^, implicit multiplication, pi, e, sin cos tan asin acos atan sinh cosh tanh exp ln log log10 log2 sqrt cbrt abs floor ceil round sign min max pow atan2. |
| `geom` | live geometry: `kind` polygon/path/angle, `pts` `[[x,y],…]` in element coordinates (dragged by handles), `showAngles` (arcs + degrees, right-angle marker), `showSides` (lengths), `showArea`, `unit` (px per unit), `suffix`, `decimals`, `fill`, `stroke`, `sw`, `labelSize`, `color` |
| `vec` | vector from the origin: `vx`, `vy` (units), `unit` (px per unit), `label`, `showComp`, `showAxes`, `showValues` (components, magnitude, angle), `decimals`, `color` |
| `ucircle` | unit circle: `theta` (°), `rad` (radius px), `showSin`, `showCos`, `showTan`, `decimals`, `color` |
| `mgrid`, `numline` | coordinate grid (`w`, `h`, `step`, `axes`, `labels`); number line (`min`, `max`, `step`, `len`, `marks` lines `name: value`) |
| `gantt` | a whole Gantt chart; origin = top-left. `title`, `titleSize`, `titleStyle` bold/normal/italic, `cols` (`Nov\|Dec\|Jan…`), `colW`, `halves` (half-column dividers), `snap` (drag step in column units), `labelW` (label column), `rowH`, `barH`, `rx`, `labelSize`, `labelPos`, `colLabelSize`, `msSize`, `legend`, `legendSize`, `zebra`, `color`, `lineColor`, `today` (column units, red dashed line). Lists, one entry per line: `tasks` = `label\|start\|end\|phase[\|opacity]` (times in column units: 0 = start of first column, 1 = its end, 0.5 = half); `phases` = `key\|#fill\|legend label[\|flags[\|#stroke]]` (flags: `dashed`, `hidden` = not in the legend); `milestones` = `at\|row\|label` (row 1-based; `at` = a time, or `start`/`end` = attached to that row's bar so it moves with it); `deps` = `fromRow>toRow`. `labelPos` left/before/after/bar decides where task labels sit (before/after/bar travel with the bar). Users drag bars/ends/milestones on the canvas; you just edit the lists. |
| `icon` | `kind`: one of ~1500 flat icons in `ICONS` (cells & tissues, molecules & genetics, aging & hallmarks, immunology & infection, anatomy, organisms, chemistry, lab, techniques & assays, medicine, mind & behavior, statistics, AI & computing, mathematics, physics, engineering, energy & electronics, transport, earth & climate, ecology & agriculture, society & economics, food & sport, history & humanities, symbols; grouped in `ICON_GROUPS`; `Object.keys(ICONS)` lists them, e.g. cell, neuron, mito, receptor, gpcr, kinase, antibody, tcell, macrophage, bacterium, phage, virus, lungs, liver, colon, mouse, nematode, killifish, fly, yeast, molecule, atom, beaker, flask, pipette, microscope, westernblot, elisa, patchclamp, stethoscope, elder, rapamycin, metformin, mtor, sirtuin, sabgal, centenarian, gompertz, scatter, boxplot, heatmap, neuralnet, robot, sigma, matrix, magnet, bulb, wrench, car, satellite, volcano, wheat, solarpanel, survey, coin, headmind, apple, galaxy, scroll, target, warning), `size`, `c1` (main color), `c2` (accent), `label`. New icon: add `ICONS.key={n,t,c:[c1,c2],d:(a,b,o)=>svg}` drawn in a 100×100 box centered on 0 and list the key in `ICON_GROUPS`. |
| `formula` | a LaTeX formula typeset to vector paths: `tex` (LaTeX, e.g. `\frac{dN}{dt} = rN`), `size` (font size px), `color`, `display` (true = large Σ ∫). The editor typesets it with MathJax (CDN, first use needs internet) and stores the paths in `paths`/`vb`; just set `tex` and let the page render. Users edit it with the formula builder (double-click). |
| `plot` | a small chart from typed values: `kind` bar/line/scatter/box/pie, `data` (one line per item: bars `label: value ± err`, box `label: raw values`, line/scatter `name: x,y x,y …` or `name: y y y`, pie `label: value`; `#hex` at the end sets the color), `w`, `h` (plot area), `color`, `color2`, `xlabel`, `ylabel`, `labelSize`, `ymin`/`ymax` (blank = auto), `axes`, `legend` |
| `elem` | periodic-table tile: `symbol`, `number`, `mass`, `name`, `size`, `fill`, `stroke`, `color` |
| `membrane` | a bendable, extendable lipid bilayer (or monolayer, beads, tube): `pts` `[[x,y],…]` in element coordinates define a curve (Catmull-Rom through the points; `smooth:false` = straight stretches); `kind` open/closed (closed = vesicle or cell outline, filled with `fill` at `fillOp`); `style` bilayer/monolayer/beads/tube; `spacing` (px between lipids; the count follows the length automatically), `head` (radius), `tail` (length), `c1` head color, `c2` tail color, `sw`. Users drag the points: an end point extends it, a middle point bends it; panel buttons Add point / Remove point / Extend / Make circle / Straighten / Flip sides. |
| `chem` | a structural (skeletal) formula. Easiest: set `smiles` (e.g. `CCCC(=O)O`, `c1ccccc1`, `Cn1cnc2c1c(=O)n(C)c(=O)n2C`); the editor parses it (organic subset, bracket atoms with charge/H, ring closures, branches, aromatic atoms kekulized, `.` fragments) and lays it out (rings as regular polygons, fused rings, zigzag chains, substituents outward). Explicit model: `atoms` `[{x, y, el, q, h}]` in element coordinates, `bonds` `[{a, b, o:1|2|3, st:''|'wedge'|'hash'}]`; `applied` = the SMILES the atoms came from (set `applied:''` to force a re-layout). Also `bondLen` (40), `labelSize`, `sw`, `color`, `showC` (label carbons), `showH` (implicit H on heteroatoms). Users grow and edit structures on the canvas: click an atom → blue dots mark free bonds, type an element letter, 1/2/3 bond order, W/D wedge/hash, +/− charge, Del. Bridged ring systems are laid out approximately. |
| `netmed` | network-medicine diagram (STRING-like): `modules` lines `name\|dots\|#color\|gene,names` (one module per line, max 12), `bg` unassociated dots, `overlap` dots shared by neighboring modules, `pIn`/`pOut`/`pMB`/`pBB` link chances (inside a module / between modules / module dot to unassociated dot / among unassociated dots; a degree-corrected stochastic block model with a fixed random number per pair, so settings changes keep existing links), `hubs` 0–1 (heavy-tailed dot weights: a few hubs), `spacing` (module spacing in a fresh layout), `connect` (keep modules connected), `hideIsolated`, `drugs` lines `name\|targets\|#color\|spread\|A=0.9;B=0.2` (targets = number of target dots; spread 0–1 = targets close together vs spread across the network; per-module proximity 0–1 by module name or letter: 1 = targets inside the module, 0 = as far as the network allows, a module left out has no say; targets are picked by shortest-path distance to the modules; older `name\|module\|targets\|#color` lines still load; the panel has sliders per drug; `showStats` lists each drug's average target distance to every module (Guney 2016 "closest" proximity)), `seed`, `w`, `h` (layout area), display options (`showEdges`, `edgeFilter` all/within/between, `edgeColorMode`, `edgeColor`, `edgeW`, `edgeOp`, `curved`, `bridgeHi`, `bridgeColor`, `showBlobs`, `blobShape` hull/bubble, `blobStyle` fill/outline/dashed, `blobOp`, `blobPad`, `nodeR`, `sizeByDegree`, `nodeStyle` flat/ring/string, `bgColor`, `nodeStroke`, `nodeSW`, `showLabels`, `labelSize`, `showNodeLabels`, `nodeLabelSize`, `focus` (module names/letters to highlight), `showLegend`, `showStats` (largest connected piece per module and the network separation s(A,B))). State: `pos` `{dotKey:[x,y]}` (keys `m<id>:3` = dot 4 of the module with stable id `<id>` from `mids` (ids follow the module lines by name, also `dids` for drugs), `o<idA>-<idB>:1` shared, `b:7` unassociated, `d<id>` drug; delete `pos` to re-layout), `addE`/`delE` hand-edited links as `"key~key"`. Users drag dots on the canvas (Shift = whole module) and click two dots to add/remove the link. Panel **Scatter randomly** puts every dot at a random spot (links stay; `scattered: true`, the clustered positions kept in `posClustered`) and **Gather into modules** animates them back (page functions `nmScatter(o)` / `nmGather(o)`). |
| `scalebar` | microscopy scale bar: `len` (px), `label` (e.g. `50 µm`), `thick`, `size`, `color`, `pos` above/below |
| `image` | `src` (`assets/...` or data URL), `w`, `h`, `rounded`, `border` |
| `path` | one editable shape: `d` (SVG path data in element coordinates), `ox`/`oy` (offset so the anchor is the shape's center), `fill`, `stroke`, `sw`, `dash`. Right-click an icon (or any composite element) → **Convert to editable parts** turns it into independent `path`/`text` elements (not grouped, so each part is selected and moved on its own); the user then recolors, moves or deletes them and box-selects them to fuse. |
| `custom` | one element holding raw SVG: `svg` (fragment in element coordinates), `w`, `h`. Right-click several selected elements → **Fuse into one element** produces it (keeps figures fast); **Convert to editable parts** splits it again. Exports as a picture in PPTX. |
| user icons | **Save as icon…** (right-click, or the button in the side panel when several elements are selected) stores the selection as a new icon in the user's own library under a name the user types; the key is made from that name (`ICONS[key].user === true`; built-in icons are untouched). A selected group of ordinary elements stays in the figure; parts made with Convert to editable parts are replaced by the new icon. Definitions `{n, t, svg, k, c, from}` live in `assets/my-icons.json` (never replaced by the updater; written through `POST assets/my-icons.json`) and are embedded as `scene.icons` in every figure that uses them, so a figure renders anywhere. They appear under "My icons" in the Add panel; ✕ on an item removes it from the library (figures that still use it keep their copy). |
| `legend` | `items` lines `kind|color|label` (kind circle/up/down/line/check/cross), `dir` v/h, `size` |
| `funnel` | `stages` lines `label|count|color|height`, `wTop`, `wBottom`, `band`, `gap`, `countAt` band/after, `topCount` |
| `qr` | `url` (QR is regenerated when it changes), `size` |
| `survival` | Kaplan-Meier-style sketch: `w`, `h`, `color`, `doses`, `effect`, `series` lines `name` or `name:#hex` (first = control; without a color the line takes `color`), `legend` + `legendA`/`legendB` (only without `series`), `xlabel`, `ylabel` |
| `gradbar`, `capsule`, `worm`, `dna`, `plate`, `badge`, `sketch` | gradient arrow, pill, C. elegans, DNA helix, petri dish, check/cross, the user's pen sketch; see `DEF` |
| `comment` | a review note: `text`, `reply`, `resolved`, `collapsed` (bubble closed with its ✕; selecting it opens it again), `x, y` where it points. A comment left without text and reply is removed by the editor. **Never exported.** |

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

- Species names are italicized automatically by the renderer (common binomials such as *Caenorhabditis elegans* or *Drosophila melanogaster*, genus names on their own, and abbreviated forms such as *C. elegans*, *E. coli*, *S. cerevisiae*); type them plainly.
- Keep text as real `text` objects (never bake text into images); keep colors from `palette`.
- Check your layout: load the page and use `bbox(id)` to verify nothing overlaps or leaves the page.
- Do not touch `history/`; the editor manages it. Exports go to `exports/`.
- Figures contain the user's research; do not publish or upload their contents anywhere.
