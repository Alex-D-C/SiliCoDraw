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

Open `http://localhost:8770/?file=<name>.json` for a figure in this folder (`?file=figure.json` for the default one). A name
that does not exist yet starts a blank figure (on the website it is saved only at the first change).
**The plain address `http://localhost:8770/` is for the user: it opens where this browser left off** (Appearance → At start,
"Where I left off", the default): Home (the page of all figures, see "Home" below) when Home was showing when SiliCoDraw was
last used, over the figure last worked on; otherwise that figure, directly (the address goes on to `?file=<name>.json`), or
Home when that figure is no longer among the active ones (archived, trashed, renamed). Nothing remembered (the first start
in this browser): Home when there are two or more figures, else the figure. The browser remembers it in `localStorage`
(`fig.lastView:<folder path>` = `home` / `figure`, written by `noteFront()` whenever Home shows or closes, a figure is opened
and a tab is used again, so with several tabs the one used last wins; `fig.lastFile:<folder path>` = the figure); a tab on
the plain address that is loaded again shows what that tab showed (`sessionStorage` `fig.here:<folder path>`), and so does
Back or Forward to the plain address (`history.state.here`; a step through the history never goes on to another figure).
Any page that showed Home and is loaded again (reload, Back, restored tabs) shows Home again (`sessionStorage`
`fig.homeRe`, written at `pagehide`). At start = "Home page": Home whenever there is a figure to choose but the one open,
over the figure last worked on; "The last figure": the figure last worked on, never Home. `?phone=1` / `?phone=0` on the
plain address goes along to the figure it leads to. Without a remembered figure the plain address is `figure.json`, and if there is none (on the website: or it is still
blank) the most recently changed figure that is not a `*-example.json` copy, else a blank `figure.json`. The lists are read
first, under a plain cover (`html.home-boot`), so neither the editor, another figure nor a Home that goes again flashes by
(for 5 s at most: a list that takes longer leaves the page on the address's own figure, without touching what is remembered);
Home shows once the address is known to stay, so on a phone Back leaves the editor. **`?file=<name>.json` opens the
figure directly, without Home: use it** (tests and assistants do; `?home=0` on the plain address does the same for `figure.json`,
`?home` asks for Home, also beside `?file=`); `fig.home(false)` closes Home, and `window.fig` works under it anyway.

## Files

| Path | What it is |
|---|---|
| `figure-editor.html` | the whole editor (vanilla JS, single file) |
| `serve.py` / `serve.ps1` | tiny file server with the save / history / export API (identical behavior) |
| `update.py` / `update.ps1` | public release only: fetches the current version from GitHub and replaces the software files; never figures, `history/`, `exports/`, `assets/`, `archive/`, `trash/` (launchers `Update SiliCoDraw.bat` / `.command`, `update.sh`). It shows a notice and asks first (`--yes` / `-Yes` skips the question, `--check` / `-Check` only lists the changes), zips the figures into `updates/figures-backup-<date>.zip`, and puts everything back if it fails part-way. Never run it in a git clone (`git pull` there). |
| `install.sh` | public release only: the macOS / Linux one-line installer (`curl -fsSL https://raw.githubusercontent.com/Alex-D-C/SiliCoDraw/main/install.sh \| sh`) |
| `tests/` | public release only: `smoke.sh` / `smoke.ps1` (server, installer, updater) and the browser suite: `run.html` loads the editor in a frame and runs `editor-tests.js` in it (every element type, icon and example with SVG/PNG/PDF/PPTX export, undo/redo, connectors, off-page, rich text, citations, Home, the app icon, save → reload); `browser.sh` / `browser.ps1` run it in headless Chrome/Edge (`--browser firefox` / `-Browser firefox`: headless Firefox; `--browser safari`: Safari through safaridriver on macOS), exit code 0/1; CI: `.github/workflows/test.yml`; see `tests/README.md`. Run the browser suite after changing the editor. |
| `*.json` (root) | one figure per file; `figure.json` is the default |
| `history/<name>/` | automatic snapshots of a figure (at most one per 5 min, newest 60) |
| `exports/` | PNG / PDF / TIFF / SVG / PPTX exports written by the editor |
| `assets/` | images the user inserted (referenced as `assets/<file>` from the figure), the user's own icons (`my-icons.json`) and which icon packs were imported (`icon-packs.json`) |
| `icon-expansions/` | icon packs converted from open repositories (`scidraw/`, `biodraws/`, `nih-bioart/`), each under its own license, with `index.json`; see "Icon expansions" |
| `examples/` | example figures to copy from (signalling, immunology, chemistry, pathway, gantt, maths, data, icons, icon-library, workflow, environmental-microbiology); they appear in File ▾ → New figure; `api/files?scope=examples` lists them |
| `notices/` | the notice board on Home: `notices.json` (tips and what is new) and the small pictures it names; software, replaced by updates (see "Home") |
| `lib/mathjax/` | MathJax 3.2.2 (Apache 2.0), loaded first so formulas typeset without internet; the editor falls back to the same version on a CDN when it is missing |
| `brand/` | the app icon (software, published and updated like the editor; never user data): `icon.svg` (master, the cell of silicon), `icon-small.svg` (16–64 px, the Co mark alone), `icon-macos.svg`, `mark.svg` / `mark-dark.svg`, `lockup.svg` / `lockup-dark.svg` (tile + wordmark), PNGs 16–1024 (`icon-180.png` = apple-touch-icon), `icon.ico` (Windows), `SiliCoDraw.icns` (the Mac app made by `start.sh`), `social-preview.png`; see `brand/README.md`. Outlines only (no text, masks or external references). The editor carries `icon-small.svg` inline (top-bar logo, Home, the `rel="icon"` data URI, also in the presenter window), so it runs without these files|
| (website) | silicodraw.com runs this same editor with a storage script (`window.SiliCoDrawWeb`): figures live in the browser (IndexedDB), exports are downloaded |

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
   `fig.refs()`, `fig.addRef(text)`, `fig.cite(ids, {style})`, `fig.refList()` (references and citations: see "Citations"),
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
   (with a print size set), formula errors, missing pictures, icons from a repository that ask for attribution on a slide without a credit line (see "Icon expansions"), and colors (`colorCheck()` → `{text, alike}`: text below
   4.5:1 contrast against what it sits on, 3:1 for large text = 18 pt or 14 pt bold; text on pictures is not checked;
   colors inside one chart, legend, network or Gantt chart closer than ΔE 10 in normal vision, deuteranopia or protanopia).
   The user sees the same in Page → **Check colors** and the Export dialog. **Colors:** `cvdPreview('deutan' |
   'protan' | 'tritan' | 'gray' | '')` shows the canvas as seen with that color-vision type (this tab only: never saved
   or exported; `cvdPreview()` returns the mode); `recolorFig({'#old': '#new', …})` swaps colors everywhere at once
   (then `commit()`); `PAL_PRESETS` holds the colorblind-safe palettes of Edit palette… (Okabe–Ito, Paul Tol, viridis, cividis). `fig.add` and `fig.update` check what they were given
   and `console.warn` it; `fig.update` returns that list (`[]` = fine).
   **Finding things:** `fig.list()` (one row per element: `{id, type, name, text, kind, bbox: [x, y, w, h], group,
   hidden, locked}`, comments also `status` and `on`), `fig.findIcon(word, n = 8, {packs})` (icon keys for a word, ranked like the
   Add panel's search: `fig.findIcon('mitochondria')` → `mito` first; icons of imported icon packs that are shown come too, see "Icon expansions"), `fig.schema(type)` (`{defaults, fields: [{key,
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
   light/dark/system, style classic/soft/flat/contrast, accent, layout std/swap/right, text, density, labels, motion,
   phone auto/on/off, start last/home/figure = what the plain address opens: where the user left off / Home / the last figure). They live in the browser only, never in the figure, and never change exports.
   **Phones**: under 700 px wide (or a short touch screen, a phone held sideways) the editor uses its phone layout
   (`html.phone`, `html.ph-land` sideways; `PHONE()` in the page): a bottom toolbar, the side panels as sheets,
   full-screen dialogs, Share… after an export; a structure's selected atom or bond gets buttons on top of its properties
   sheet (what a keyboard types), a network a Drag whole modules toggle; what is small on screen moves as a whole (its
   handles sit beside it or wait for zooming in), and an arrow's bend handle sits beside its line. `phone: 'off'` still keeps it under 560 px wide
   (no room for the side panels). `?phone=1` / `?phone=0` in the address force it on / off for that page
   without saving anything (`&file=` still picks the figure); the figure file and the API are the same.

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
Optional `refs` (the file's references) and `text` elements with `cite` (citations) or `refList`: see "Citations" below.
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
**Crop** (every element but arrows and comments): `"crop": {"l": 0.1, "t": 0, "r": 0.25, "b": 0}` = the fractions (0 to below 1;
`l` + `r` < 1, `t` + `b` < 1) cut from the left / top / right / bottom of the element's own drawn bounds, in its own frame (before
rotation and flip: a turned element is cropped along its own sides, a flipped one has its own left on the right). No crop = no
field; one that is no such thing (no numbers, out of range, percent instead of fractions, on an arrow) is dropped when the file
is read (the console says what was wrong with it), and `fig.update` / `fig.crop` name it. `x, y` stay where they are, so what is left stays exactly where it was. A side
with 0 is not clipped at all (an outline or label past the bounds stays whole there). Everything that works with an element's
bounds uses the cropped ones: selection, `bbox(id)`, `fig.list()`, align, guides, connector ends (they meet the cropped outline),
pinned comments, `fig.arrange`, animations, the off-page check; a press on the cropped-away part goes to what is under it. A
picture keeps `fit` / `fx` / `fy` as they are (its panel calls them Fill the frame / Stretch), with `crop` on top of its frame. Drawn as a clip (`cropWrap`: an unseen
`.cropframe` rect, a `clipPath`, the drawing in `g.cropped`), so SVG, PNG and TIFF have it, the PDF as a real clip (text stays
text); PowerPoint gets a cropped picture with its own crop (`srcRect`, fit and crop together) and any other cropped element as a
picture of what is seen of it (not editable there; `exportPptx()` counts them as `cropped`; animations and groups stay).
Users: **Crop** in the side panel, the right-click menu or Shift+X (phones: on top of the element's sheet) shows the whole
element with the rest dimmed and handles on the frame's sides and corners (dark; white on a dark page); drag them (inside the frame: move it), arrow
keys move the side last touched, Shift on a corner keeps the proportions, the panel has the sides in percent, proportions
(Free, 1 : 1, 4 : 3, 16 : 9, Original) and Reset crop; Enter, Done, a press outside or changing slides applies (one undo step; a frame left as it was changes nothing, so a crop that came from the file meanwhile stays), Esc cancels (an open menu closes first); zooming, Fit, Help and Appearance keep crop mode; the right-click menu then has Apply crop and Cancel crop;
**Remove crop** takes it off. Several selected (a group): Crop says to select one element, or to fuse them first (the fused
element is cropped as a whole). Convert to editable parts gives each part the crop as its own (parts outside it are left out),
Fuse and Save as icon keep it inside the new element. `fig.crop(id)` → the crop or `null`, `fig.crop(id, {l, t, r, b})` sets it
(sides left out = 0; throws on a bad one), `fig.crop(id, null)` or `fig.update(id, {crop: null})` removes it; in the page
`cropStart(id)` / `cropEnd(apply)` enter and leave crop mode, `cropFrame(o)` = the cropped bounds in the element's own frame.
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
| `icon` | `kind`: one of ~1600 flat icons in `ICONS` (cells & tissues, molecules & genetics, aging & hallmarks, immunology & infection, anatomy, organisms, chemistry, lab, techniques & assays, medicine, mind & behavior, statistics, AI & computing, mathematics, physics, engineering, energy & electronics, transport, earth & climate, ecology & agriculture, environmental microbiology, society & economics, food & sport, history & humanities, symbols; grouped in `ICON_GROUPS`; `Object.keys(ICONS)` lists them, e.g. cell, neuron, mito, receptor, gpcr, kinase, antibody, tcell, macrophage, bacterium, phage, virus, lungs, liver, colon, mouse, nematode, killifish, fly, yeast, molecule, atom, beaker, flask, pipette, microscope, westernblot, elisa, patchclamp, stethoscope, elder, rapamycin, metformin, mtor, sirtuin, sabgal, centenarian, gompertz, methanogen, biofilm, soilprofile, nitrogencycle, wwtp, sedimentcorer, metagenome, scatter, boxplot, heatmap, neuralnet, robot, sigma, matrix, magnet, bulb, wrench, car, satellite, volcano, wheat, solarpanel, survey, coin, headmind, apple, galaxy, scroll, target, warning), `size`, `c1` (main color), `c2` (accent), `label` (`\n` = line break), `labelColor` (blank = #374151), `grp` (icons of a repository and the user's own: colored by groups of similar colors, see "Color groups" under "Icon expansions"; a built-in icon keeps its two colors). New icon: add `ICONS.key={n,t,c:[c1,c2],d:(a,b,o)=>svg}` drawn in a 100×100 box centered on 0 and list the key in `ICON_GROUPS`. |
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
| user icons | **Save as icon…** (right-click, or the button in the side panel when several elements are selected) stores the selection as a new icon in the user's own library under a name the user types; the key is made from that name (`ICONS[key].user === true`; built-in icons are untouched). A selected group of ordinary elements stays in the figure; parts made with Convert to editable parts are replaced by the new icon. Definitions `{n, t, svg, k, c, from}` live in `assets/my-icons.json` (never replaced by the updater; written through `POST assets/my-icons.json`) and are embedded as `scene.icons` in every figure that uses them, so a figure renders anywhere. They appear under "My icons" in the Add panel; ✕ on an item removes it from the library (figures that still use it keep their copy). A built-in icon always keeps its key: an own icon whose key a built-in icon has (a "Lake" saved before the library had `lake`) is moved to a free key (`lake2`) when the library or a figure carrying it is read, and that figure's elements and `scene.icons` follow (`userKey`, `builtinIcon`). |
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

## Slides (several pages in one figure file)

A file may hold several slides: `{"version": 4, "w": 1600, "h": 900, "bg": "#ffffff", "palette": [...], "slides": [{"id": "s1", "name": "Title", "notes": "speaker notes", "objects": [...]}, ...]}`
and then no top-level `objects`. The page size, background, palette, print size and own icons are the file's; each slide has
its elements (ids unique within a slide; two slides may reuse an id), an optional `name` and `notes`, and optionally a background color and a transition of its own (`bg`, `trans`, below). A file without `slides`
is a plain figure, exactly as before; a file with both gets its top-level elements as the first slide. The editor writes each
slide on its own line (`{"id":…,"name":…,"objects":[`) and its elements one per line after it. Keep slide ids stable: file
edits are merged slide by slide (added, removed and reordered slides included), and each slide's elements as usual.
In the editor a strip of thumbnails beside the canvas (a file with more than one slide; phones: the Slides dialog) switches,
adds, duplicates, renames, deletes and reorders (drag); PageUp / PageDown switch; File ▾ → Add a slide turns a plain figure
into a file with slides, File ▾ → Add slides from figures… brings other figure files in as slides; deleting down to one slide
makes it a plain figure again (unless that slide has animations). Undo/redo cover all slides and show the slide that changed. Which slide a tab shows is the
tab's own (never saved).
`window.fig`: every existing call acts on the slide shown (`fig.get()` is that slide as a plain figure, `fig.get({slides: true})`
the whole file; `fig.set(plain figure)` replaces the slide shown, `fig.set(file with slides)` everything).
`fig.slides()` → `[{n, id, name, notes, elements, comments, current, bg, trans}]`, `fig.slide(n or id)` shows a slide (numbers count from 1),
`fig.addSlide({name, notes, objects}, position)` → id (it is shown), `fig.duplicateSlide(n or id)`, `fig.removeSlide(n or id)`
(the last one stays), `fig.moveSlide(n or id, position)`, `fig.updateSlide(n or id, {name, notes, bg, trans})`,
`fig.comments({slides: true})` and `fig.check({slides: true})` (all slides, rows carry `slide`). To answer a comment on another
slide: `fig.slide(n)` first.
Exports: the Export dialog has Slides: all / only this one. `exportPptx(say, {current, numbers})` gives one PowerPoint slide per
slide with its speaker notes (`numbers`: slide numbers), `makePdf({…, current})` one page per slide; `svgString`, `makePng`,
`makeTiff` are the slide shown (`slideEach([0, 1, …], async i => …)` draws each slide in turn). Export several figures… takes
every slide of a file with slides.

**Animations** (only in a file with slides): a slide may hold `anims`, the list of its animations in the order they play, as
PowerPoint's animation pane has it: `{"id": "a1", "on": "o12", "kind": "in", "fx": "fly", "dir": "l", "start": "click", "dur": 0.5, "delay": 0}`.
`on` = an element's id, or `"g:<group>"` for a whole group (an element of a group always stands for its group); `kind` `in`
(entrance) / `out` (exit) / `path` (motion path); `fx` for in/out: `appear`, `fade`, `fly` (`dir` `b`/`l`/`r`/`t` = from, or to,
that side), `float` (`u` up / `d` down), `split` (`vo`/`vi`/`ho`/`hi` = vertical or horizontal, out or in), `wipe`
(`b`/`l`/`r`/`t`), `shape` (`ci`/`co` circle, `bi`/`bo` box, `di`/`do` diamond, in or out), `wheel` (`dir` = spokes
`1`/`2`/`3`/`4`/`8`); for a path: `line` or `custom` with `path` = `[[dx, dy], …]` in page px from where the element is (a custom path is
travelled as a smooth curve through its points at an even speed; `"smooth": false`, written before `path`, = straight from point to point),
or `back` = **Back to original position**: `{"id": "a3", "on": "o12", "kind": "path", "fx": "back", "start": "click", "dur": 2, "delay": 0}`, no `path`
(one written there is dropped): a straight line from where the element's earlier motion path on that slide left it, back to where the
element is. Every path is travelled from the element's own place (PowerPoint's too), so that start is the end of the last path
animation of the same element (or group) before it in the list; it is worked out whenever the slide is drawn, played, presented or
exported (`animLive(list)` in the page), so it follows that path, the order of the list and the element. With no path before it, or
after another `back`, it does nothing: the animation pane (a hollow bar, "does nothing yet") and `fig.check` (an info row) say so; it still takes its click and its time, and PowerPoint gets it as a path that stays in place (`M 0 0 L 0 0 E`), so the clicks count the same there;
`start` `click` / `with` (with the one before) / `after` (after it); `dur`, `delay` in seconds. Put `anims` before `objects` in
the slide. An animation whose element is deleted goes with it. **Copies keep their animations**: copy or cut and paste (the same
slide, another slide, another file with slides; also through the system clipboard), Duplicate (Ctrl+D) and Alt-drag give the
copies copies of the animations (new ids, `on` = the copy, a group's `g:<group>` = the copy's group), added after the slide's own
in the order they had; a row that started `with` / `after` keeps that only when the copied row before it was in the same click
step, else it starts on `click` (so does the first copied row). It is one undo step with the paste, with a toast ("Pasted with 2
animations"; an Alt-drag says it when the drag ends, an Alt+click without a drag makes no copy and says nothing). A plain figure takes
the elements without them (a paste from another figure never makes a figure a file with slides), except a copy made in that same
figure: a cut that took its last animations made the one slide a plain figure again, and the paste makes it a file with one slide
again, with the animations. The clipboard copy
carries them as `animRefs` on the first element of each target, with `animFrom` = the figure it was made in (`animCarry`, `animPaste`, `ANIM_HOME`; never fields of a figure). Users do everything in the
**animation sidebar** (the Animations button in the top bar, Shift+A; phones: ⋯ → Animations, a sheet; open or closed is the
browser's, never the figure's): playback on top (Play slide, From selected, Stop, "Play when I change something" = a changed
animation plays once, without its delay; a press on the canvas ends that preview and acts as usual, while during Play it only
stops), **Add animation** (a gallery of effects for the selection under Entrance / Exit / Motion path: Line, Custom path,
Draw…, Back to original position; its heading folds it away; it always adds, and says so when the element already has an entrance or exit), the
**animation pane** (the slide's animations in play order, grouped by click step, each row with its kind in words
("Entrance · Fade"), and a bar for its delay and duration within its step; a row selects what it animates and a selected
element its rows, Ctrl / Shift for several; drag rows or Alt+Up / Alt+Down to reorder, Delete removes, ⋯ or right-click:
start, play from here, move, remove) and the options of the chosen animation, pinned to the bottom (effect, direction as
pictures, start, duration, delay; a path: Draw it…, Straight line, Add / Remove point, Smooth curve; its points are dragged on
the canvas; Back to original position: one line saying what it does, no points, its way back drawn dashed on the canvas). The sidebar scrolls as one. Keys pressed in it never reach the canvas shortcuts: Delete removes the chosen
animations (not the element), the arrows go through the tabs and effects. The properties of a selection and the Page panel
only point there ("Animations…"). In a window too narrow for it beside the properties it lies over them (`html.anim-over`) and
says so, with Show properties; on phones the canvas gives up the room under the sheet, so the slide is fitted above it
(sideways: beside it). Focus mode hides it (it counts as closed there; opening it leaves focus mode). In a plain figure the
first animation (the gallery, or `fig.animate`) makes the figure a file with one slide, and removing a file's last animation
while it has one slide without a name makes it a plain figure again. Small numbered tags on the canvas show the click step
(green entrance, red exit, blue path; never exported).
`fig.anims()` → `[{n, id, on, kind, fx, dir, start, dur, delay, path, step, name}]` of the slide shown (a `back` row: `from` = `[dx, dy]`
where it starts, worked out now, and `path` = `[[0, 0]]`),
`fig.animate(id or [ids], {kind, fx, dir, start, dur, delay, path, smooth})` → new ids (several targets: the first as given, the others
with it; `{kind: 'path', fx: 'back'}` = Back to original position), `fig.updateAnim(id, props)`, `fig.removeAnim(id or [ids])`, `fig.moveAnim(id, position)`, `await fig.playAnims(ids?)`
(plays them on the canvas; changes nothing: the animated elements play as copies on layers over the page, on one clock, with
PowerPoint's easing, and Escape, a press on the canvas or any change stops it; `animStop()` too; `animStats` = the last run's frame
times), `fig.animPane(show?)` (the sidebar: `true` / `false` shows / hides it, no argument: whether it is open). The PowerPoint export writes them as PowerPoint's own animations (`pptxTiming`;
a grouped or multi-shape element is animated as its group; a smooth custom path as the same Bézier curves the canvas plays; Back to original
position as an ordinary straight motion path from its offset to the shape's place, `path="M 0.125 0.3 L 0 0 E"`, which PowerPoint shows and edits as a line path); PNG, PDF, TIFF and SVG show the slide as it is on the canvas.
Google Slides, opening that `.pptx`, has Appear, Fade and Fly; other effects are replaced (usually by a fade) or left out,
and motion paths and delays are not kept there.

**A slide's own background and transition** (only in a file with slides; put both before `anims` and `objects`): `"bg": "#0f172a"` on a
slide overrides the file's `bg` for that slide (same rules as the file's: no quotes, `<`, `>`, `&`); everything that draws or judges
the slide uses it (`pageBg()` in the page: canvas, thumbnails, every export, the light/dark choice for labels, `labelBg: "auto"`,
`fig.check` / `colorCheck`, the slideshow). `"trans": {"fx": "fade" | "push" | "none", "dir": "u" | "d" | "l" | "r", "dur": 0.7, "advance": 5}`
is the transition played when the show arrives at the slide (PowerPoint's meaning): `dir` (push only) is the way the slides move,
`"u"` = PowerPoint's From Bottom (the default), `"r"` From Left, `"l"` From Right, `"d"` From Top; `dur` in seconds (default: fade 0.7,
push 1, as PowerPoint); `advance` (optional) = the show moves on by itself that many seconds after the slide, or one of its animation
steps, has appeared (`"fx": "none"` with `advance` = no transition, only the timing). No `trans` = a cut. An unknown `fx` or `dir`
written into the file is kept, plays as none (or from the bottom) and is named by `fig.check`. Users set both in the Page panel
(nothing selected): the tick box **Different background color for this slide** with a color field and **Use for all slides**
(`bgAll(i)`: the file's `bg` becomes that color, no slide keeps its own), and **Transition to this slide** (None / Fade / Push, direction,
duration, advance after, **Preview** = `transPreview(i)`, **Apply to all slides** = `transAll(i)`); a slide with a transition has a small
mark on its thumbnail. `fig.updateSlide(n or id, {bg, trans})` sets them (`null` removes; an unknown `fx` / `dir`, or a `bg` that is not text or holds quotes, `<`, `>` or `&`, throws; a `bg` equal to the file's is kept as the slide's own),
`fig.slides()` rows carry `bg` (the slide's own color or `null`) and `trans`. `fig.get()` hands the slide out with the background it shows;
`fig.set(plain figure)` on a slide makes a `bg` other than the file's that slide's own (the file's color and the other slides stay), and
one equal to the file's removes the slide's own. A figure brought in with Add slides from figures… keeps another background as its
slide's own; `recolorFig` recolors slide backgrounds too; the last slide left with a `bg` becomes a plain figure of that color, one
with a `trans` stays a file with slides. PowerPoint export: the slide's background, and the transition as PowerPoint's own
(`pptxTrans`: `<p:fade/>` / `<p:push dir>` with `spd`, `p14:dur` and `advTm`); PNG, PDF, TIFF and SVG have the background and no transitions.

## Presenting

The **Present** button in the top bar (menu: From the beginning / From this slide / Presenter view), **F5** (from the beginning) and
**Shift+F5** (from this slide) show the slides as a slideshow in this window: full screen when the browser allows it, black around
the slide, the slide a vector drawing scaled to fit, without comments, handles, animation tags or anything off the page. A plain
figure presents as one slide. The editor takes F5 only while it has the keyboard (the browser's reload stays on Ctrl+R / Cmd+R).
Keys in the show: click, Space, Enter, →, ↓, PageDown, N = the next animation step (a slide's animations play by click step, exactly
as `fig.playAnims` plays them), then the next slide with its transition; ←, ↑, PageUp, Backspace, P = back one step (the state
before, shown at once); Home / End; a number then Enter = that slide; B or . = black screen, W or , = white; F = full screen;
V = presenter view; Esc ends (the editor is then on the slide last shown). Touch: tap the right / left half, swipe; every touch shows the bar for 4 s, and a tap on the bottom edge while it is hidden only shows it. A small bar
(back, slide n / N, next, presenter view, full screen, end) shows while the mouse moves; the cursor hides after 2 s. A click on a button of the bar or the presenter view leaves the keyboard with the show (Space still goes on); Ctrl+V pastes nothing during a show. After the
last slide: "End of slideshow, click to exit". The **presenter view** is a second window (written by the show window itself, so it
needs no extra file and works on the website too): the slide showing in its animation state, what the next click brings, the
slide's `notes` (A− / A+), a timer (Pause, Reset), a clock, Back / Next / End show; its keys and buttons drive the show. A show
started with the presenter view stays in its window until F is pressed (a browser gives one click either a new window or full
screen); a blocked pop-up is said in the show. Presenting never changes or saves the figure and adds no undo step; the figure
file is not read while a show runs (an edit from outside is merged when it ends).
`await fig.present({from, view, fullscreen})` starts (`from`: `"current"`, a slide number from 1 or an id, default the first;
`view: true` = with the presenter view; `fullscreen: false` = stay in the window) and resolves to `fig.presenting()`;
`fig.present(false)` ends; `fig.presenting()` → `{slide, step, slides, steps, end, blank, view}` or `null`. In the page: `showNext()`,
`showPrev()`, `showJump(n)`, `showBlank('b' | 'w')`, `showView(true | false)`, `showEnd()`.

## Citations (references kept in the file, citations as text that follows them)

A file may hold its references: `"refs": [{"id": "r1", "type": "article", "authors": [{"family": "Carlsson", "given": "Alexander B."}, {"literal": "Aging Atlas Consortium"}], "year": 2025, "title": "…", "container": "Nature Medicine", "short": "Nat Med", "volume": "5", "issue": "3", "pages": "123–130", "publisher": "…", "doi": "10.1038/…", "url": "https://…", "pmid": "…"}]`
(file level, shared by all slides, written one per line; `type` article / preprint / book / chapter / conference / thesis / report / web / other; an author may carry
`suffix` ("Jr"); `"etal": true` after `authors` = the source named only the first authors ("et al.", BibTeX "and others"): every style then writes "et al." after them; `container` = the journal, book, proceedings or website, `short` = the journal's abbreviation; plain strings and numbers only: the editor drops anything
else, clips long values and gives a missing or repeated id a new one). Keep ids stable: edits are merged by id (a reference added in two windows under one id is kept twice,
and the other window's citations follow its new id; a reference removed in one window while the other went on citing it is kept, and the merge message lists it).
A **citation** is an ordinary `text` element that also has `cite: ["r1", "r3"]` and `citeStyle`: `short` (the default) "Carlsson et al., *Nat Med* 2025" (two authors
joined by "&", "et al." from three, the journal abbreviated when the reference has `short`, else its full name, in italics; a book shows its title), `authoryear`
"(Carlsson et al., 2025)", `num` "[1]" / "[1, 3–5]", `sup` (the numbers as a superscript), `vancouver` and `apa` (the whole reference; an unknown `citeStyle` is a warning of `fig.update` / `fig.check`, draws as the default and is dropped). `citeDoi` and `citeTitle` (true / false)
add or drop the DOI and the title (default: both in the full styles, neither in `short`; the numbered styles and `authoryear` have none). Several references are joined with
"; ". **The editor writes the element's `text`** from the references, on every change and when it reads the file (the file keeps the old words until the next change made in
the editor, as with connector ends): to change a citation, edit the reference, `cite` or `citeStyle`, not `text`; `text` may be `""` when you add one in the file. Titles and
names are escaped for the rich-text marks, so `p_53`, `H_2O` or `*` in a title stay as written. Numbers follow the first appearance over the whole file (slide by slide, on a
slide from the top, then from the left) and are renumbered when a slide or a citation moves. A `text` changed by hand (typed on the canvas or in the panel, Find and replace,
`fig.update(id, {text})`) makes the element plain text: `cite` goes, the words stay, a message says so, and Undo links it again (no question is asked, so typing is never
interrupted; `cite: null` does the same on purpose). An id in `cite` that the file does not have is drawn as "?" and is an error in `fig.check`; a reference without authors
or year is an info row there.
A **reference list** is a text element with `refList: true` (`citeStyle` `vancouver` or `apa`; `refAll: true` = every reference of the file, else the cited ones; `citeDoi`):
numbered in the citations' order when any citation is numbered, else alphabetical, and rewritten like a citation. `refCols` / `refCol` (2, and 1 or 2) make two such
elements the two columns of one list: style, DOI, `refAll`, size, font and color are shared (taken from the column that is selected, else the first; the panel says "column 1 of
2"), a column whose partner was deleted shows the whole list again, and a list that got too short for its second column becomes one element.
**Copies:** a copied citation carries its references (`citeRefs` on the clipboard copy, never in a figure): pasted into another figure they are found again there or added, and
the citation follows the ids they have there (every file numbers its references r1, r2…, so the same id is another paper elsewhere); a pasted citation without them keeps its
words as plain text. `fig.set(plain figure)` on a slide of a file with slides never replaces the file's references: the given `refs` are merged into them in the same way.
Users: **Add citation…** (the **Cite** button with the quotation marks in the top bar, `#bCite`; Add panel → Text → Citation, File ▾, Shift+C; phones: ⋯ → Add citation…; `citeDialog()`) has a paste box that detects the format by itself: RIS (Zotero, EndNote,
Mendeley, Papers, journal sites), BibTeX / BibLaTeX, EndNote tagged `.enw` and EndNote XML, CSL JSON, PubMed `.nbib`, DOIs, DOI links, PMIDs or arXiv ids (one per line, or separated by commas, semicolons or spaces), or a formatted
reference (APA, Vancouver / AMA and Nature patterns: a best effort, to be checked with Edit). Many references at once are the normal case (several items exported or copied together, several files): each gets a tick box. Also: Choose files…, files dropped on the dialog or on the canvas (`.ris`,
`.bib`, `.enw`, `.nbib`, `.xml`, a CSL `.json`), and an export pasted on the canvas. Several references come with tick boxes (**Tick all** / **Untick all** from four on); **Edit** opens a form for every field (an emptied field is removed; a last author line
"et al." sets `etal`). A text longer than 200,000 characters is read whole while the box shows only its beginning (read-only, with **Clear**). An
identifier is filled in only when the user presses **Look up**: only the identifier is sent, a DOI to Crossref (`api.crossref.org`), or to DataCite (`api.datacite.org`) when
Crossref does not have it, a PMID to PubMed (`eutils.ncbi.nlm.nih.gov`), an arXiv id to arXiv (`export.arxiv.org`), or as arXiv's DOI to DataCite when arXiv does not answer;
no key, no cookies, nothing of the figure, one request per service and no retry; offline it says so and the form takes over. The tab **In this file** lists the file's
references (search, Edit, Remove with a warning when cited, Copy all as RIS / as BibTeX). The style is chosen from cards with a live preview of the ticked references. The
citation lands at the bottom left of the slide in a small muted size (16 px × `addScale()`, never below the smallest text the print size asks for, light on a dark slide),
above a text already there, or below the selected element, left-aligned with it, while there is room for it on the page (never below a selected citation or reference list:
one citation after another is stacked at the bottom left); it is dragged like any text. **Insert reference list…** offers, in a file with slides, a new
last slide named "References"; a list taller than the page is set in two columns, and then in a smaller size (never below the smallest readable one). The side panel of a
citation lists its references (Add reference…, take out, reorder, Edit), the style, Title / DOI and **Make plain text**. Slides brought in with Add slides from figures… bring
their references. There is no "Pick in Zotero": Zotero's local server (`localhost:23119`) does not answer requests from a web page.
`fig.refs()` → the list; `fig.parseRefs(text)` → what a text holds, nothing added (an identifier gives a reference that holds only the identifier: nothing is fetched);
`fig.addRef(text, an object or a list)` → `[ids]` (the existing id for a reference the file already has: the same DOI or PMID, or the same first author, year and title; what
that one lacks is filled in; `{authors: ["Family, Given"], year, title, container, …}` or a CSL object); `fig.updateRef(id, props)`; `fig.removeRef(id)` (its citations lose
it, a citation of nothing else is removed); `fig.cite(id or [ids], {style, doi, title, x, y, on})` → the citation's element id (`x, y` = the left end of its first line, `on`
= an element to put it under, while it fits on the page below it, else at the bottom); `fig.refList({style, cited: false, doi, slide: true})` → the list's element id. Each is one undo step. In the page: `refParse(text)` →
`{format, refs, ids}`, `await refLookup({kind: "doi" | "pmid" | "arxiv", id})`, `refsRis(refs)`, `refsBib(refs)`, `citeSync()` (writes every citation again; `commit()` calls it).

## Icon expansions (more icons from open repositories)

`icon-expansions/` holds **icon packs** converted from open repositories; `index.json` lists them. Shipped: `scidraw`
(SciDraw, 367 icons, CC BY 4.0 or CC0 per drawing, credited per icon with its authors and DOI), `biodraws` (BioDraws, 162,
CC BY-SA 4.0, one sentence of credit, share-alike), `nih-bioart` (NIH BioArt Source, 559, the entries labeled Public
Domain, no credit required). They are third-party art under their own licenses (never SiliCoDraw's MIT): every pack
folder has `LICENSE.txt` (license, the repository's terms as retrieved, legal text) and `ATTRIBUTION.md` (who made it,
how they ask to be credited in their own words, what was changed, credits per icon). The folder is software: the servers
serve it from the program folder, the updater replaces it, `dev/make-web.ps1` and `publish.ps1` copy it.

**Pack format** (`icon-expansions/<id>/`): `pack.json` = `{id, name, by, url, site, mark, license, licenseUrl, attribution:
"required" | "none" | "mixed" (per icon, by its lic), shareAlike, perIcon, credit (the line printed on the page), plain,
ask, askFrom, how, shareAlikeText, changes, each (a full-credit line per icon with `{by}`, `{n}`, `{doi}`, `{page}` and
an optional `({y}).`), retrieved, version, count, bytes, names, preview, chunks: [{file, cat, count, bytes}]}`;
`names.json` = `{"<id>:<key>": {n, t, c, f (index of its part), by?, src?, doi?, lic?, cat?, title?, y?}}`;
`icons-<category>.json` (a second part of the same category `icons-<category>-2.json`) = `{"<id>:<key>": {n, t, svg, k, c, b, by?, src?, doi?, lic?, cat?, title?, y?, kt?, fixed?}}`, the format of
the user's own icons (`svg` drawn in the 100 × 100 box around 0, `k` = the two colors the editor swaps for `c1` / `c2`,
`c` = their defaults) plus `b` = `[width, height]` of what is seen (the icon is measured by it: shapes cut off by a clip
path may reach further) and the credits the repository gives: `by` = every author it names, joined with ", "; `title` =
the name as the repository has it where the library name `n` got a number to tell two "Mouse" apart (credits print the
title); `y` = a year of publication, only when the repository states one (none of the shipped packs does). `kt` = the
shades of a shaded drawing: `[[shades of k[0]], [shades of k[1]]]`, at most 256 per key; when `c1` / `c2` differs
from its default (any CSS color: `#2a4` and `red` are read as `#rrggbb` first, `hex6`), each shade is recolored as it
stood to its key (`toneOf`: the hue turns with it, lightness and saturation scale toward white or black), so the shading
stays, and the defaults draw it exactly as made. Outline inks (near-black, dark gray) and near-white highlights are never
keys of a shaded drawing; `fixed: true` = no color key (a white animal drawn in outline: `c1` / `c2` alone change
nothing). This is how an element without `grp` is colored; the side panel colors pack icons by their groups instead
(see "Color groups" below), which works for `fixed` icons too. In the Add panel a pack drawing over 8 KB is shown as a small cached picture once it
is drawn (`thumbPut`, `thumbRaster`), so thousands of thumbnails keep a few KB each in the page. `preview.json` = a few icons for the animated preview. Parts stay under a few MB, load only when needed and
are kept by the browser's cache (`cache: "no-cache"`: only asked whether they changed). An import fetches the names and
every part (a missing file shows at once), except for a pack over 20 MB (`PACK_EAGER`): its names and first
part only, the other parts when their icons are shown or placed. Left out on purpose: the repositories' own logos and
drawings of identifiable real people (a license covers the drawing, not that person's rights).


**In the editor.** Nothing of a pack is used before the user imported it: **Import more icons** at the top of the Add
panel (`#packBtn`, `packMenu()`) lists the packs with license badge, count, size, "Imported ✓" and a looping preview
(a cross-fade through `preview.json` about every 1.2 s; four still icons with reduced motion). A pack opens a pop-up
(`packDialog(id)`): who makes it, the license in plain words with links, whether and how to credit (their own wording),
share-alike consequences, what was changed, count and size, and a box that must be ticked before **Import** works ("I
take full responsibility for correctly attributing this repository"; "I have read these terms" when none is required);
imported packs have **Remove from library** there. The list closes with a press outside it, a click elsewhere in the
Add panel, typing in the search field or Esc; on a phone held sideways it takes the sheet while it is open. What was
imported (date, version) is kept with the figures in `assets/icon-packs.json` (website: the same path in its storage),
so it holds for every browser of that installation; the file is read again before it is written (only this tab's own
import or removal is changed, `packSaveState(id)`), and other tabs follow (`{packs}` on the `silicodraw-files` channel,
and when the window gets the focus back: `packRefresh()`). A search that finds nothing while a source is unticked says
how many matches the hidden sources have, with **Show all sources**.
Imported icons are ordinary `icon` elements with `kind: "<id>:<key>"`; in the Add panel they have their own groups
("SciDraw · Mouse"), one chip per pack, a small mark (`mark`) and a tooltip (name, from, creator, license; also the
item's title, and a long press on touch screens). **Show icons from:** (a row of boxes once a pack is imported: SiliCoDraw,
My icons, each pack; `localStorage` `fig.iconShow`) picks which sources the groups and the search list. Pack icons are
recolored with `c1` / `c2` like any icon; a shaded pack icon (`kt`) recolors its shades with them; `fig.add('icon', {kind})` keeps a pack icon's own colors unless `c1` / `c2` are
given. A figure embeds the pack icons it uses in `scene.icons` **with their credits** (`pack`, `packName`, `packSite`,
`packCredit`, `packLicUrl`, `perIcon`, `by`, `src`, `doi`, `lic`, `title`, `req` = attribution asked), so it draws,
recolors and can be credited where the pack is not imported (there the icon is registered from the figure, never added
to My icons or the Add panel). Where the pack **is** imported, the library entry is always the pack's own: a copy that
a figure carries (opened, pasted, or drawn as a Home thumbnail) never takes its place, and the icon's license, creator
and whether it asks for credit are read from the pack, not from the figure (`packLib(key)`; `ICONS[key].lib`).
Parts made with Convert to editable parts keep `from: "<id>:<key>"`, a fused element and an own icon made of them keep
`att: ["<id>:<key>", …]`; their credits travel in the file as `iconAtt: {"<id>:<key>": {pack, packName, n, by, …, req}}`,
on the clipboard with the copied elements (`attRefs`, never kept in a figure), with slides brought in from other
figures, and with `fig.set(plain figure)` on a slide (added to the file's, never replacing them).
An icon's drawing arrives with its part: until then (after a reload) it is a dashed circle. The export functions wait
for it; **`await fig.iconsReady()`** does the same for you (→ the kinds that could not be loaded, `[]` = fine): call it
after `fig.add` of pack icons and before `bbox`, `fig.check` or closing the page. Ids inside an icon (gradients, clip
paths) get an ending of their own wherever it is drawn (`iconIds`: the element's id on the canvas, a counter in
thumbnails), so two drawings of one icon never share an id. `svgScrub` (every icon definition, `custom` element and
thumbnail passes it) also removes `<style>`, references of `<image>` / `<use>` to other hosts and `url(…)` that does not
point into the drawing.

**The credit line.** When an icon whose license asks for attribution is put on a slide (Add panel, `fig.add`, paste, a
file edit followed by any change) and the slide has no line that covered that repository before, the editor adds one: an
ordinary text element named `icon credits` with `iconCredit: true`, in the look of the "Made with SiliCoDraw" line and
stacked above it (and above a citation) at the bottom left; movable, editable, removable. While `iconCredit` is true its
text is written again at every change (`iconCredSync`, like citations): a repository with one sentence for all prints
that sentence (`credit`, e.g. "Images are obtained from BioDraws.com (CC BY-SA 4.0), adapted"), a repository credited
per icon prints "Icons: Zebrafish by A. Name (doi:10.5281/zenodo.…), scidraw.io, CC BY 4.0, adapted" ("adapted": CC BY
asks to say that a work was changed) and, with more than three such icons, only the repository ("Icons: SciDraw
(scidraw.io), CC BY 4.0, adapted"): the Page panel, the Export dialog and an info row of `fig.check()` then say that
each creator and DOI still needs credit in the legend or the acknowledgments (never "credited by the line on the
page"). Several repositories are joined with " · "; icons that need no credit (CC0, public domain) are left out. The
line never runs off the page: when its text gets longer it is wrapped to the page (`boxW`) and grows upward
(`iconCredFit`; on a slide that is not shown its place and wrap are estimated from the text, `iconCredEst`, so it does
not land on the "Made with SiliCoDraw" line there); `fig.check()` warns when a credit line reaches outside the page. A
text changed by hand becomes plain text (the flag goes, a toast says so, Undo brings it back) and is no longer
rewritten. The elements a line has covered are marked `cred: 1`, so a line the user **deleted** is not put back for
those repositories; `fig.check()` ("uses icons from … that ask for attribution; no credit line on the page"; with
`{slides: true}` for every slide, rows carry `slide`), the Page panel and the Export dialog (Slides: all → every slide,
"Slide 2 uses icons from … and has no credit line") remind instead, and only an icon from a repository new to the slide
brings a line back. The line goes by itself when nothing on the slide asks for credit any more (the icons were deleted
or hidden); the marks go with it then, so an icon shown again gets its line again. In a file with slides every slide
has its own line. Exports contain it like any text. Page panel (nothing selected) and the Export dialog: **Copy full
icon credits** (every icon with its authors, title, DOI or page and license, one per line, the license with its link,
also the icons that need no credit) and, when the line is missing, **Add the credit line**. When you edit a figure
file yourself: do not write the line; add the icon elements and it appears at the user's next change (or call
`fig.iconCredits({add: true})` in the page).

**Color groups** (icons of a pack and the user's own icons; `grpOf(kind)` in the page). The editor finds the colors a
drawing paints (fill, stroke, gradient stops, style properties; not the contents of a mask, clip path or filter, nor a
gradient only those use: `grpHide`) and how much of the icon each covers, by painting the drawing once on a 96 × 96
offscreen canvas (`grpPaint`: canvas paths, no layout; every visible pixel counts for the nearest color of the drawing; a
gradient in user space is painted as one, so its stops share what it covers; a `<use>` leading back round a circle is not
followed, and past 50,000 elements it gives up), then clusters them in OKLab (`grpCluster`, thresholds in `GRP_K`):
shades of one material (a red organ from dark red to pale pink) are one group, other hues are not, a clear color is never
merged into a gray group, a group under about 2 % of the icon joins its nearest neighbor of its kind, near-black outline
ink and near-white highlights are groups of their own, listed after the others (a dark gray right beside a color of the
drawing belongs to that material, so a black mouse's fur stays one group; a dark gray group under a quarter of the icon
counts as outline). Each group has a main color (its largest member) and its shades (`shades`, dark to light). Computed
only for an icon that is selected or drawn with `grp`, kept for the last 300 kinds (`GRP_MEMO`); about 1 ms for a typical drawing, ~10 ms for the largest. **The field:** an icon element with `grp` (an object, `{}` too) is colored by
groups: `grp` = `{"<a color of the drawing>": "#rrggbb", "=<a color of the drawing>": "#rrggbb"}`. A plain key names the
group that color is in (the editor writes each group's main color as the drawing has it, and always the two largest
groups), and that group follows it: the key color becomes the new color and every other color of the group keeps its
difference to it in OKLCH (`grpShift`: lightness scaled toward white or black so the order of the shades never flips,
chroma by the same ratio (by the same difference for a pale or gray main, blended smoothly between the two, so a faint
pink with red shading does not turn glaring), hue by the same offset (a gray main has no hue to keep an offset from: its
members take the new hue); a gray new color keeps the lightness steps; out of the sRGB gamut chroma gives way, never
lightness). A key `"=#color"` sets that one color exactly: the editor writes these when an icon recolored with `c1` /
`c2` starts to be colored by groups, so it looks exactly as before; a change to that group drops them. `c1` / `c2` in
group mode repeat the colors of the two largest groups (so the fields and `recolorFig` keep working); a `c1` / `c2` that
is no value of `grp` and not the library's own color (set on its own in the file, or in the fields of a mixed
selection) colors the largest / second group, and `fig.update` with `c1` / `c2` sets those groups. The groups are found
by the colors `grp` names, not by their rank, so two groups of nearly the same size that rank the other way in another
browser change nothing. The drawing itself is never changed, and a group at its own color is not touched, so the
defaults draw it exactly as made. **Without `grp`** an icon draws exactly as before: `c1` / `c2` through the color keys
`k` and their shades `kt`; older files are unchanged. The editor adds `grp` at the first change in the side panel's
**Colors in this icon** (the look stays as it was) and takes it off again when every group is back at its own color
(Reset colors). `grp` given by `fig.add` or `fig.update` to an icon without it starts from the icon's look too (then
takes the entries); `fig.update(id, {grp: null})` puts `c1` / `c2` back to the library's. A `grp` written into a file
next to the library's `c1` / `c2` draws as made except for its entries. `grp` is written one per element like any
field, merged as one field, checked when a file is read (a key that is no `#rrggbb` or `=#rrggbb`, a value that is no
color, more than 256 entries: dropped with a console note; `null` takes it off) and by `fig.check` / `fig.update` (a key
that is no color of the icon, with the nearest group as "did you mean"). Copies carry it (with the drawing in `iconDef`
/ `scene.icons`, so a figure where the pack is not imported draws the same), and so do every export, thumbnails, the
slideshow, Convert to editable parts, Fuse and Save as icon (the parts keep the new colors). Another kind (`fig.update`
with `kind`, or a built-in kind from the panel's list; `fig.update` needs both drawings loaded, `await fig.iconsReady()`
first, else it throws and changes nothing): the two largest groups (`c1`, `c2`) keep the colors they had unless those
were their own, the rest starts as made (a kind with one group leaves `c2` as it was, unused). `recolorFig` changes
`c1`, `c2` and the values of `grp`; the color check names two groups of a recolored icon that look alike now (normal
vision, deuteranopia, protanopia) while they were told apart as made.
**Panel:** one swatch per group, largest first (up to six of those covering at least about 2 % of the icon; **More**
for the rest, tiny highlights or outline included), each with a strip of its shades and a name ("Color 1: #c0392b,
46 % of the icon, 4 shades"; Outline, Highlights); a click opens its color below (the color field, the recent colors
(`localStorage` `fig.recentColors`) and the figure's palette, **Reset this color**; Esc closes it, back on its swatch);
← → move between the swatches; under the pointer, with the keyboard focus, and for 2.5 s after a click or tap a swatch
shows its group on the canvas, the rest of the icon dimmed toward the page (`ICON_HL`, never saved, exported or in a
thumbnail); **One color** = the whole icon in shades of one color (each group's main at its own lightness, the same hue;
outline ink and white highlights stay as made); **Reset colors**. What is open is kept while the same selection is drawn
again, not for the next selection. Several icons of one kind selected: the row sets all of them; icons of different
kinds: c1 / c2 as before (they set the two largest groups of an icon in group mode). Phones: the same row in the
properties sheet, larger swatches; the sheet's quick color row is Color 1 of the row. Icons marked `fixed` (no color key)
are recolored by their groups too. A built-in icon shows no row: it draws from two colors only, which its main and
accent fields already are.
`fig.iconColors(id)` → `{mode: 'groups' | 'c1/c2', groups: [{n, main, color, kind: color | ink | white, share, shades,
field: c1 | c2 | grp}]}` (`null` for a built-in icon); `fig.iconColors(id, {"#main" or group number: "#new" (null = as
made)})`, `fig.iconColors(id, "#hex")` (One color) and `fig.iconColors(id, null)` (Reset colors) change them (one undo
step each). Development: `dev/icon-import/color-groups.js` (`grpHarness()`) groups a sample of every pack and draws
contact sheets (as made, then the largest group in blue, green, orange and gray) into `exports/`.


`window.fig`: `fig.iconPacks()` → `[{id, name, license, count, imported, shown, attribution, shareAlike, perIcon, credit,
how, url, bytes}]`; `await fig.importIconPack(id, {accept: true})` (throws without `accept: true`, which says the terms
were read and the responsibility for attribution taken: only pass it when the user agreed) → `{id, name, count}`;
`await fig.removeIconPack(id)`; `fig.showIconPacks({builtin, my, <id>: bool})` → what is shown; `fig.findIcon(word, n,
{packs})` (`packs`: left out = the imported packs that are shown, `true` = every imported pack, `false` = none, `[ids]`);
`fig.add('icon', {kind: 'scidraw:…'})` works when the pack is imported or the figure already embeds that icon, else it
throws and says how to import (also after an import that was canceled or failed: nothing of it stays registered);
`await fig.iconsReady()` (above); `fig.iconCredits()` → the line's text for the slide shown, `fig.iconCredits({full: true})`
→ the complete credits, `fig.iconCredits({add: true})` puts a deleted line back. In the page: `packInit()` (a promise:
the packs are known), `packSource(folder)` (a pack folder elsewhere on this server, for trying a converted pack and for
the tests), `iconCreditText(attList(scene.objects), full)`, `iconCredMissing(objects)`, `iconCredShort(objects)` (the
repositories whose line names only the repository), `await packSettle()` (what `fig.iconsReady` waits for).

## Home (the page of all figures)

Home is an overlay inside the editor (`#home`, never a second page, never saved in a figure, never exported): a navigation
column of sections and a main area. It opens with the house button or the logo at the top left, File ▾ → Home, Ctrl/⌘+O,
`?home` in the address (also beside `?file=`), and at the start of the plain address (see "Start it"); Esc or
"Back to <figure>" closes it. The figure underneath stays loaded, so `window.fig` keeps working while Home shows.
`fig.home()` → whether it shows, `fig.home(true)` / `fig.home(false)` shows / hides it, `fig.home('archive')` shows a section
(`figures`, `archive`, `trash`, `templates`).

- **Figures / Archive / Trash**: one card per figure (thumbnail drawn from its JSON with `sceneSvg`, lazily, at most four
  files read at a time, in a 16 : 9 frame: the whole page when it is square or wider, up to 3 : 1, else the top 4 : 3 of a
  portrait page and the left part of a wider one, `hmFit`; name, date as "Today 17:31" / "Yesterday 09:05" / "Nov 3" /
  "Nov 3, 2025" (`hmDate`, the full date in the tooltip), "N slides", "Open" on the figure of this tab, which is the first
  card when sorted by date), a search box, sort (last changed / name) and grid / list (kept in `localStorage` `fig.home`).
  Figures has three buttons in its bar: **New figure** (opens File ▾ → New figure), **New presentation** (the same dialog asking
  only for a name, `menuActs.new('slides', true)`: a 16 : 9 file with slides, 1600 × 900, a title slide and a title + content
  slide, opened on slide 1 with the slide strip showing; `newTemplate('slides')`, also "Presentation" under Basics in New figure
  and on Templates) and **Import…** (`openFolderDialog('Import figures')`, what File ▾ → Open a folder of figures… opens: .json
  figures, a folder, a .zip), and a + card for each of the first two. Figure files (.json, one or several), a folder or a .zip
  dropped anywhere on Home come in the same way (`webRestore`); after an import the Figures list is read again and shows the
  figures that came in selected, the first one in sight with the keyboard focus on it, and a toast says how many were added, were
  already there or were skipped (`imported(names)` of the Figures section; a figure that was already there is selected too, and a
  single one is named: "“name” is already here", with "(in the archive)" / "(in the trash)" when it is there). The three buttons
  always show their words (in a narrow window the bar wraps them onto a row of their own). On a phone they are a row of their own
  under the search, and the two + cards are left out. An empty list says so in the
  middle of the page (`hmEmpty`): no figures yet (with New figure, New presentation, Import… and Browse templates), nothing archived, the trash empty,
  or no figure with the searched words in its name (with Clear search). A click or Enter opens (Archive: makes it active first; Trash: a click
  only selects). Several are selected with the boxes, Ctrl/⌘+click, Shift+click (range), Ctrl+A (all shown); with a selection
  a plain click selects too; Esc clears the selection first, then closes Home. The selection outlasts a search (the bar then
  says "3 selected (2 not shown)" and an action takes those too) and is forgotten, with the search, when Home closes. The bar
  of the selection: Figures → Archive,
  Move to trash, Duplicate, Export… (opens Export several figures with them ticked); Archive → Make active, Move to trash;
  Trash → Restore, Delete permanently… (always asks, naming the figures), and Empty trash…. Moving to the archive or trash asks nothing and says
  how many moved (only the figure open in this tab asks before it goes to the trash, as the toolbar does); what could not be
  moved is named. Delete (Mac: ⌘+Backspace) on a card moves it to the trash, F2 renames. Each card has a ⋯ menu (also
  right-click, menu key): in Figures Open (Back to this figure for the one that is open), Open in a new tab, Rename…,
  Duplicate…, Export…, Archive, Move to trash; in Archive Open (makes it active), Make active, Move to trash; in Trash Restore,
  Restore and open, Delete permanently… (rename, duplicate and export only for active figures). A file whose name the editor
  cannot open (a space…, made outside it) shows as a card that cannot be opened or selected ("rename this file in the folder").
  Everything goes through `api/files`, `api/move`, `api/delete`,
  `api/rename` and the figure files (`archive/<name>` and `trash/<name>` are read for thumbnails), so the website works the same.
  Thumbnails draw files nobody opened: `sceneSvg` escapes what it writes into attributes and passes the result through
  `svgScrub`. `api/delete` keeps the version history when an active or archived figure has the trashed one's name.
- **Templates** ("Start from a template"): the choices of File ▾ → New figure (`NEW_TPLS`) as cards with a thumbnail,
  grouped as that dialog groups them (Basics, Posters, Graphical abstracts), then the examples; a card opens that dialog
  with the choice made, for the name.
- **The notice board** (Figures only, in its bar between the search box and the sort list; `nbMount` from that section's
  render, so a redraw keeps its place): one item at a time, a tip or a "New" item of the latest big update with a small
  picture, changing every 9 s (`NB_EVERY`) with a soft fade; ‹ › step (← / → inside it), it pauses while the pointer is
  over it or the keyboard focus is in it (`:focus-visible`: a button clicked or tapped keeps the focus without stopping it), and with reduced motion (the system's, or Appearance → motion Fewer) it neither
  fades nor moves on by itself. The rotating words are not announced (`aria-live="off"`); a step the user takes is said
  once. ✕ folds it into a small **Tips** button; **What's new** lists every news item with its picture, the ones not seen
  yet first with a "New" mark (opening it marks them seen; the board is drawn again when it closes), and under **All tips**
  every tip; the item's whole words are its tooltip. Kept in this browser only (`localStorage` `fig.notices`:
  `folded`, `at` = the item shown last, so the next visit goes on from there, `seen` = news ids), never in a figure; a write
  keeps what another tab wrote meanwhile (`nbSave(own)`: seen ids are joined) and other tabs follow a change (`storage`
  event). Every item is shown whole, never with an ellipsis or clipped: its words wrap (a news title on its own line, its
  words under it), and all items are drawn on top of each other in one grid cell (`.nbstack`, only `.nbit.cur` visible), so
  the board is as tall as the tallest item at the current width (72 px at least; 64 with compact spacing, 80 with large
  text) and keeps that height while the items turn, and already while they load (`NB_FALLBACK` laid out hidden under "Loading tips…"), so the cards below never move. It sits in the bar beside its controls
  only when the inside of #hmMain (without its 24 px padding) is 1900 px or wider (a window of about 2165 px), where its words need two or three lines; narrower, it
  has a row of its own under the bar's controls (with the buttons kept at the right when it reaches its widest); under
  620 px of main area the Tip / New mark and the What's new label give their room to the words, and (without the phone layout) the picture goes, a news title runs on in its words and the four buttons sit two by two at its right, as on a phone, in 12.5 px text. Phones: a strip under the
  three buttons without picture or mark, its Back, Next, What's new and Hide buttons two by two at its right (sideways: in
  a row, without Back), growing a line where the words need it (12 px text on a 320 px phone, 12.5 px otherwise). Tips with `"desk": true` (they name
  keys or right-click) are left out on a phone or a touch screen (`nbTouch()`). Archive, Trash and Templates do not show it (tidying up and picking a template
  are tasks of their own; the board is for the page people start from).
  **Content:** `notices/notices.json` (a software file in its own folder, since every `.json` in the root is a figure;
  read with no-cache; replaced by updates; `NB_FALLBACK` in the page is the same content, used when the file is missing
  or holds nothing usable, and a test keeps the two equal): `{"version": 1, "tips": [{"id", "text", "icon"?, "action"?, "desk"?}],
  "news": [{"id", "title", "text", "picture"?, "icon"?, "action"?, "since"?}]}`. Text takes `**bold**`, `*italic*`,
  `` `key` `` and `{mod}` / `{alt}` (Ctrl / Alt, ⌘ / ⌥ Option on a Mac); it is escaped first (`nbRich`). `icon` = a glyph
  of `NB_GLYPH` (cite, copy, home, anim, present, chem, picture, eye, export, parts, star, connect, crop, search, text,
  zoom, hand, comment, panels, history, gear, keyboard, sketch, bulb, sparkle) or an icon key of `ICONS` (drawn by
  `iconBody`). `picture` = a path inside `notices/` or `brand/` (svg, png, jpg, webp, gif) or an inline `<svg>` that
  `svgScrub` leaves unchanged and that refers to nothing; it is drawn as an `<img>` (a picture that does not load shows
  the glyph). `action` = one name of `NB_ACTS`: `cite`, `anims` (the animation sidebar), `iconPacks` (Import more icons),
  `envmicro` (that icon group in the Add panel), `newFigure`, `newPresentation`, `import`, `templates`, `prefs`
  (Appearance), `whatsnew`, `help:home` / `help:present` / `help:anim` / `help:crop` / `help:cite` / `help:colors` (Help scrolled to that
  row, `helpRow`); a feature of the editor closes Home first. Anything else in the file (unknown fields, actions, code,
  addresses, pictures from elsewhere) is dropped (`nbClean`); a news item without an action opens What's new at it. To
  add a tip: one line in `tips` with a new id, then copy the lists into `NB_FALLBACK`.
  **Providers:** the board's items come from `NB_PROVIDERS` (async functions returning `{tips, news}`, cleaned the same
  way); the built-in one reads `notices/notices.json`. The website could add one later (for example for ads); ads would
  first need a privacy policy and a consent banner, and there is no ad code, tracking or request to another host now.
  `fig.notices()` → `{items: [{kind, id, title, text, action, icon, picture, seen}], current, item, folded, shown,
  rotating, still, paused, every}`; `fig.notices('next' | 'prev' | 'fold' | 'unfold' | 'whatsnew')` (an unknown word
  throws). In the page: `nbLoad(force)`, `nbStep(±1, user)`, `nbTick(ms)` (the clock, called every 500 ms; tests call it
  with a whole turn), `nbFold(on)`, `nbWhatsNew(id?)`.
- **A new feature on Home = one more entry in `HOME_SECTIONS`** (figure-editor.html; the frame `homeShow` / `homeDraw` /
  `homeNav` / `homeKey` assumes nothing about files): `{id, label, icon (the inside of a 24 × 24 stroked SVG), count?(ctx) →
  number | null, render(main, ctx) → optional clean-up function, key?(e, ctx, typing) → true when it used the key,
  lists?: true, reset?()}`;
  `ctx` = `{lists: {active, archive, trash}, reload(), go(id), close(), say(text)}`. `HOME_SECTIONS.push({…})` at run time
  works too (`fig.home('<id>')` then shows it). `lists: true` = the section shows `ctx.lists` (the three file sections): it
  is drawn again whenever the lists changed (read again when the window gets the focus back), and Home does not open on it
  when the figures cannot be listed or, at the start, when there is nothing to choose. A section without it is drawn when
  it is opened and after `ctx.reload()` only, so a form or typed text in it stays while files change (only the numbers in
  the navigation follow). `reset()` is called when Home closes (the file sections forget search and selection). Home loaded
  anew (the open figure moved or renamed) comes back on the section it showed.
- Moving the figure that is open in this tab from Home takes the same path as Archive / Move to trash in the toolbar
  (`flushSave(true)`, `moveAway`), then the tab goes on to another active figure with Home showing again; for every other
  figure moved or renamed, tabs that have it open are told (`{moving}`, `{gone}` on the `silicodraw-files` channel) and stop
  saving it. Before the move they write a change not saved yet: `tellMoving(names)` posts `{moving}` and waits for their
  `{held, pending}` / `{flushed}` answers (120 ms, at most 1.5 s), in the toolbar's Archive, Move to trash and Rename too.

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

The **figures folder** may be elsewhere: File ▾ → Where figures are kept… (`api/storage`; the choice is in `.silicodraw-folder` beside the
servers; `--data <folder>` / `-data <folder>` for one run) keeps figures, `archive/`, `trash/`, `history/`, `assets/` and `exports/` in any folder, such as
one a sync app keeps; the program's files stay here. `GET api/storage` says where (`dir`). The website (`window.SiliCoDrawWeb.storage`) keeps them in the
browser, a linked folder (Chrome and Edge) or Dropbox, Google Drive or OneDrive, called directly from the browser, in the same layout. **By hand, on every platform:** File ▾ → Save all figures to a folder… (`saveAllDialog()`: a folder chosen in Chrome/Edge (`wsToFolder`), the share sheet on phones, or one .zip (`webBackup`)) writes every figure as `name.json` in that layout (`archive/`, `trash/`, `assets/my-icons.json` and the pictures in `assets/` the figures name), and File ▾ → Open a folder of figures… (`openFolderDialog()`, `webRestore(files)`; a folder, .json files or a .zip, also dropped on the canvas) adds them: the same figure is skipped, a different one of that name comes in as `name-restored.json`; pictures go to `assets/` (on the website into the figure).

## Conventions

- Species names are italicized automatically by the renderer (common binomials such as *Caenorhabditis elegans* or *Drosophila melanogaster*, genus names on their own, and abbreviated forms such as *C. elegans*, *E. coli*, *S. cerevisiae*); type them plainly.
- A source is cited with `fig.addRef(…)` + `fig.cite(…)` (or `refs` and `cite` in the file), not typed as loose text: the citation then follows its reference, is numbered, and appears in the reference list.
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
