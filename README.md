# SiliCoDraw

**Draw scientific figures in silico, together with your AI assistant.**

A small, local, open editor for scientific figures: poster figures, graphical abstracts, pathway
diagrams, workflow figures, timelines, teaching material. One HTML file plus a tiny server. Your
figures are plain JSON files in this folder, so an AI coding assistant can draw and revise them with
you, and you can drag things around by hand. Nothing leaves your computer.

![SiliCoDraw: icon library on the left, the figure in the middle, properties on the right](docs/editor.jpg)

## What you can make

<table>
<tr>
<td width="50%"><img src="docs/example-pathway.png" alt="A receptor signaling pathway with activation and inhibition arrows"><br><sub><b>Pathway figures</b> from the icon library and the new arrows: activation, inhibition ⊣, dashed feedback, elbow connectors, labels on arrows.</sub></td>
<td width="50%"><img src="docs/example-gantt.png" alt="A project Gantt chart"><br><sub><b>Gantt charts</b> as one editable element: drag a bar sideways to shift it, up or down to change its row, drag its ends to resize; milestones stay attached.</sub></td>
</tr>
<tr>
<td><img src="docs/example-signalling.png" alt="A ligand drawn from SMILES binding a GPCR in a bendable lipid bilayer, a kinase cascade and a bar chart"><br><sub><b>Signaling at a membrane</b>: the ligand is drawn from its SMILES, the bilayer bends and stretches with draggable points, the receptor and cascade are library icons, the chart is typed values.</sub></td>
<td><img src="docs/example-immunology.png" alt="Adaptive immune response from vaccine antigen to antibodies, with labeled arrows"><br><sub><b>Immunology schematics</b>: immune-cell icons, antigen presentation, cytokine labels on arrows, an inhibition arrow for neutralization, a legend.</sub></td>
</tr>
<tr>
<td><img src="docs/example-chemistry.png" alt="Drug structures laid out from SMILES and a Fischer esterification scheme"><br><sub><b>Chemistry</b>: structures typed as SMILES and laid out automatically, a reaction scheme with a labeled arrow, a periodic-table tile.</sub></td>
<td><img src="docs/example-maths.png" alt="Function plots, a triangle with live angles, a vector, a unit circle and typeset formulas"><br><sub><b>Working mathematics</b>: typed functions are plotted, shapes report their angles and lengths while you drag their corners, formulas are typeset from LaTeX.</sub></td>
</tr>
<tr>
<td><img src="docs/example-data.png" alt="Bar, box, line, scatter and pie charts drawn from typed values"><br><sub><b>Charts from typed values</b>: bars with error bars, box plots from raw numbers, lines, scatter, pie; plus a periodic-table tile and a scale bar.</sub></td>
<td><img src="docs/example-workflow.png" alt="A three-step workflow figure with numbered panels and arrows"><br><sub><b>Workflow figures</b>: numbered panels, library icons and arrows, made from the built-in parts in a few minutes (`examples/workflow.json`).</sub></td>
</tr>
</table>

![72 of the ~1500 icons](docs/example-icons.png)

All of these are in `examples/` and open from **File ▾ → New figure → Example: …**, so you can take
them apart.

## Install and start

SiliCoDraw runs on your own computer and opens in your web browser. It is free, and it does not need
an account.

### Mac

**The easy way: one line in Terminal (about one minute).**

1. Open **Terminal**: press **⌘ Command + Space**, type `Terminal` and press **Return**.
2. Copy this line, paste it into the Terminal window (**⌘ V**) and press **Return**:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/Alex-D-C/SiliCoDraw/main/install.sh | sh
   ```

3. SiliCoDraw is downloaded into a folder called **SiliCoDraw** in your home folder, and the editor
   opens in your browser. That folder is also where your figures are saved.
4. Leave the Terminal window open while you work (you can minimize it). To quit SiliCoDraw, close it
   (if macOS asks whether to terminate the running process, click **Terminate**).

**Next time**, start it like any app: press **⌘ Command + Space**, type `SiliCoDraw` and press
**Return**. You can also double-click **Start SiliCoDraw.command** in the SiliCoDraw folder.

**If Terminal says that SiliCoDraw needs Python 3**, a window also asks to install the "command line
developer tools". Click **Install**, wait until it says the software was installed (5 to 20 minutes),
then paste the same line into Terminal again. If no such window appears, install Python 3 from
[python.org/downloads](https://www.python.org/downloads/) and paste the line again.

**If a window asks whether Terminal may access a folder**, click **Allow**.

<details>
<summary><b>Plan B for a Mac: download the ZIP instead</b></summary>

1. On this page, click the green **Code** button, then **Download ZIP**. Safari unzips it into a folder
   called **SiliCoDraw-main** in your Downloads folder (otherwise double-click the ZIP file).
2. Open **Terminal** (**⌘ Command + Space**, type `Terminal`, press **Return**).
3. Type `sh` followed by a space. Do not press Return yet.
4. Drag the file **start.sh** from the SiliCoDraw-main folder into the Terminal window, then press
   **Return**. If macOS asks whether Terminal may access your Downloads folder, click **Allow**.
5. SiliCoDraw offers to move its folder out of Downloads into your home folder, where it is safe from
   clean-ups. Press **Return** to accept.

After that, start it with **⌘ Command + Space**, `SiliCoDraw`, **Return**, as above.

Why not just double-click a file in the ZIP? macOS blocks programs from the internet that are not from
the App Store, with a message such as *"Apple could not verify…"* or *"could not be executed because you
do not have appropriate access privileges"*. Starting SiliCoDraw once from Terminal as above removes
that block for this folder. If you already double-clicked and saw such a message, click **Done** or
**OK** (not *Move to Trash*) and continue with step 2.
</details>

### Windows

1. On this page, click the green **Code** button, then **Download ZIP**.
2. Open your Downloads folder, right-click the ZIP file and choose **Extract All…**, then **Extract**.
   SiliCoDraw does not run from inside the ZIP file. You can move the extracted folder to Documents.
3. Open the extracted folder (if it only contains another **SiliCoDraw-main** folder, open that one too)
   and double-click **Start SiliCoDraw.bat**.
4. If Windows shows *"Windows protected your PC"*, click **More info**, then **Run anyway**. Windows
   shows this once for files downloaded from the internet.
5. The editor opens in your browser. Leave the black window open while you work (you can minimize it).
   To quit SiliCoDraw, close it.

Python is not needed on Windows: the start file uses Python if it is installed and Windows' own
PowerShell otherwise.

### Linux

The Mac line works on Linux too, or download the folder and run `sh start.sh`. It needs Python 3.7 or
newer (`sudo apt install python3` on Ubuntu).

### Good to know

The editor lives at <http://localhost:8770/> while SiliCoDraw runs; bookmark it if you like. It works
in any current browser (Chrome, Edge, Firefox, Safari). On a Mac the shortcuts use ⌘ where this
README says Ctrl and ⌥ Option where it says Alt (Redo is ⌘⇧Z or ⌘Y). Tablets work too: one finger moves, two fingers zoom and pan, tap a text twice
to edit it, press and hold for the menu.

Phones get a layout of their own (in windows under 700 px wide, and on a phone held sideways): the
canvas fills the screen, a toolbar at the bottom holds Add, Layers, Select several, Sketch and Page
(with something selected: Edit, Style, Duplicate, Arrange, Lock, Delete), and the panels open as
sheets. A tap selects, a drag on a selected element moves it, a drag anywhere else pans (a flick goes
on for a moment), two fingers zoom, press and hold for the menu; a stylus works as a finger does, and
draws in Sketch. At a phone's opening zoom a small element simply moves when dragged (zoom in for its
ends and points). Export makes a PNG and **Share…** sends it to Photos, Files or a message; several
figures go into one .zip. A link opened inside an app (LinkedIn, Facebook…) lands in that app's built-in
browser, where exports may not save and figures may not last: the editor says so, and the page is better
opened in Safari or Chrome. **⋯ → Help** lists the gestures; **Appearance → Phone layout** turns it on or off (Off still keeps it
under 560 px wide, where the side panels would leave no canvas; `?phone=1` / `?phone=0` in the address
force it for one visit).

<details>
<summary><b>Something did not work?</b></summary>

| What you see | What to do |
|---|---|
| The page says **Server offline** | The Terminal window (Mac) or black window (Windows) was closed. Start SiliCoDraw again; your work was saved. |
| Mac: *"Apple could not verify…"*, *"cannot be opened"* or *"could not be executed because you do not have appropriate access privileges"* | Click **Done** or **OK**, then use Plan B above (steps 2 to 4). |
| Mac: *"Operation not permitted"* | Click **Allow** when macOS asks about folder access, or move the SiliCoDraw folder into your home folder and start it again. |
| Mac: Command + Space does not find SiliCoDraw | Start it once with the Terminal line or Plan B; that creates the app. Spotlight can take a minute to find a new app. |
| Mac: *SiliCoDraw cannot find its folder* | The folder was moved or renamed. Start it once from its new place with Plan B steps 2 to 4; that repairs the app. |
| Windows: *"cannot run from inside the ZIP file"* | Extract the ZIP first (step 2), then start SiliCoDraw from the extracted folder. |
| *"Could not start on port 8770"* | Another program uses that port. Restart the computer and start SiliCoDraw again. Or use another port. On a Mac, run `sh ~/SiliCoDraw/start.sh --port 8771` in Terminal. On Windows, open the SiliCoDraw folder, type `powershell -ExecutionPolicy Bypass -File serve.ps1 -port 8771` in the address bar of the folder window and press Enter. Then open <http://localhost:8771/>. |

Still stuck? Open an issue on the [issues page](https://github.com/Alex-D-C/SiliCoDraw/issues) and
say what you did and what you saw.
</details>

## Keeping it up to date

**Please read first: the updater is new and has not been tested by its author yet.** Before you
update, save your work, close SiliCoDraw, and copy your figures (the `.json` files in the SiliCoDraw
folder, and the `assets` folder) to a separate place, such as another folder or a USB stick. After
updating, please report how it went on the [issues page](https://github.com/Alex-D-C/SiliCoDraw/issues),
whether it worked or not. The updater prints a link that fills in the report for you; it contains no
personal information, and you need a free GitHub account to send it.

To update, open the SiliCoDraw folder and:

- **Mac**: double-click **Update SiliCoDraw.command** (a Terminal window opens).
- **Windows**: double-click **Update SiliCoDraw.bat**.
- **Linux**: run `sh update.sh`.

The updater shows the notice above and changes nothing until you type **Y** and press Return. Then it:

1. downloads the newest version and checks that the download is complete,
2. saves a copy of your figures in `updates/figures-backup-<date>.zip`,
3. replaces only the software files (the editor, servers, launchers, docs and examples), keeping the
   previous version of each in `updates/backup-<date>/` (the newest 5 are kept),
4. puts every file back as it was if anything goes wrong in the middle.

Your figures, `history/`, `exports/`, `assets/`, `archive/` and `trash/` are never touched. Start
SiliCoDraw again afterwards and reload the browser page. If you cloned the folder with git, use
`git pull` instead.

## Quickest start: hand the link to your AI

If you use an AI coding assistant that can run commands (Claude Code, Codex, Cursor or Copilot in
agent mode), paste this and you are done:

> Set up https://github.com/Alex-D-C/SiliCoDraw for me: clone it (or
> download and unzip the ZIP from the Code button), open the folder, read AGENTS.md, start the figure
> editor and open it in my browser.

Chat-only assistants cannot run anything on your computer; download the ZIP yourself and open the
folder in a coding assistant.

## Use it with an AI assistant

Open this folder in **Claude Code**, **Cursor**, **Codex**, **Copilot** or any assistant that reads
`AGENTS.md` / `CLAUDE.md`, and say, for example:

> Start the figure editor and build a graphical abstract of my paper: four steps, portrait format.

> Make a Gantt chart of my thesis plan: seven tasks from November to May, milestones at the end of
> each phase, a contingency strip underneath. Export it 16 cm wide at 300 dpi.

> Address the comments in `abstract.json`.

The assistant reads the figure files, edits them (the open editor updates live; when you are editing at
the same moment, its changes and yours are merged element by element; what it added or changed is
outlined for a moment, and one Ctrl+Z takes it back), replies on your comments, and exports
PNG/PDF/TIFF/SVG/PPTX into `exports/`. Figure files are written one element per line, so the assistant
can read and edit one element at a time; if it ever writes a broken file, the status line says
"File has an error" and the canvas keeps the last good version. `AGENTS.md` tells it everything about the file
format, every element type and the review loop.

## Features

**A library that covers most fields.** About 1500 flat, recolorable icons in 24 groups: cells &
tissues (organelles, cell types, bacteria, viruses, cell processes such as phagocytosis, endocytosis,
differentiation, migration, angiogenesis and metastasis, the cell cycle and spindle), molecules &
genetics (receptors, kinases, DNA replication, repair and transcription factors, CRISPR, RNAi,
vectors, small molecules), aging & hallmarks (plus sarcopenia, osteoporosis, healthspan, senolytics,
reprogramming, parabiosis), immunology & infection (immune cells, antibodies, antigen presentation,
complement, pathogens from coronavirus to helminths, antibiotics and resistance), anatomy (organs and
their functional units: alveoli, nephron, villi, islets, blood–brain barrier, retina, cochlea…),
organisms (from nematode and killifish to naked mole-rat, bat, whale and Arabidopsis), chemistry
(benzene, amino acid, polymer, titration, distillation, electrolysis…), lab equipment, techniques &
assays (western blot, ELISA, qPCR, patch clamp, optogenetics, nanopore, single-cell droplets,
behavioral mazes, organ-on-a-chip, xenografts, cohorts and randomization…), medicine & clinical
(imaging, vaccines, devices, risk factors), mind & behavior, statistics & data (volcano, Manhattan,
UMAP, ROC, forest and epidemic curves), AI & computing (transformer attention, GPU, qubit, confusion
matrix…), mathematics, physics (particles, projectile, double slit, fission…), engineering &
materials (graphene, nanotube, lattice, gears, robot arm…), energy & electronics, transport &
aerospace, earth & climate (carbon and water cycles, hurricane, global warming…), ecology &
agriculture, society & economics (scientist, doctor, family, poster, peer review, open access…),
food, sport & nutrition, history & humanities, symbols. Every icon has a main and an accent color you
can change. Search all ~1600 items by name or keyword (British or American spelling, plurals, common
synonyms and abbreviations such as *cardiac* or *ab*, and small typos all find it), jump to a group with the
chips, collapse groups, star favorites, and the things you used recently stay at the top. Missing something? Ask your assistant to draw it;
an icon is ten lines of SVG and `AGENTS.md` explains the format.

**Elements that do work, not just pictures.**
- **Rich text anywhere**: select part of a text and press the bar (or Ctrl+B / I / U) for **bold**,
  *italic*, underline, strikethrough, superscript and subscript (`x^2`, `Ca^{2+}`, `H_2O`, `CO_{2}`; letters need braces: `x^{n}`) or a
  colored run (`{#d64545|text}`). The same marks work in chips, arrow labels and legends, lone
  significance stars and sample names such as `rep_1` are left alone (type `\*` for a literal star), species names are italicized
  automatically, and every run survives the PowerPoint export as real formatting.
- **Symbols and typography**: the **Ω** button on the formatting bar (and beside label fields) types µ, Greek letters, ±, °, ≤,
  arrows and more; or type a LaTeX name and a space (`\alpha `, `\mu `, `\pm `, `\deg `). Icon, chip and arrow labels take a
  second line (Enter in the field), icon labels have their own color, texts and section boxes a line spacing, and the font list
  includes Verdana and Courier (monospace, for sequences). Long gene lists, links and DOIs wrap inside their box.
- **Find and replace** (Ctrl+F, or right-click empty canvas): renames "Drug A" to "Rapamycin" in every text, chip, label,
  chart, legend and Gantt list at once (match case, whole word), selects every element that has a word, and undoes in one step.
- **Formulas**: a LaTeX element with a builder (Greek letters, operators, fractions, roots, matrices,
  ready-made equations, live preview), typeset into real vector paths that export cleanly.
- **Charts from your data**: type values in the side panel and get bars with error bars, box plots
  computed from raw numbers, lines, scatter or a pie.
- **Function plots**: `sin(x)`, `a*exp(-b*x)`, `1/x`… with parameters, auto-ranged axes and gaps at
  poles. **Geometry** whose angles, side lengths and area update as you drag the corners, a
  **vector** with live components, a **unit circle** with sin/cos/tan, a coordinate grid and a number
  line.
- **Network medicine diagrams**: disease modules inside an interaction network, STRING-style.
  Choose how many modules, how many dots each has (with optional gene names), how many dots are not
  associated, how many are shared between modules, and how likely links are inside versus between
  modules; add drugs linked to their targets, with sliders for the number of targets, how spread out they are, and how close they lie to each module (the panel and the statistics show the resulting average distances). Drag single dots (Shift + drag moves a whole module) and
  the links and module areas follow; click two dots to add or remove the link between them. *Scatter randomly* spreads all dots at random so the modules are no longer clustered (the links stay), and *Gather into modules* brings them back, both as a short animation. Show or
  hide links, module areas (a smooth outline or a shape that hugs the dots), names, a legend, and
  module statistics including the network separation s(A,B). Presets are under *Diagrams* in the Add
  panel.
- **Gantt charts**: tasks, phases, milestones and dependencies as short lists; bars are dragged in
  time and across rows, resized at the ends, and milestones can be attached to a bar's start or end.
- **Bendable membranes and filaments**: a lipid bilayer drawn along a curve with draggable points.
  Drag an end to make it longer (lipids are added by themselves), drag a middle point to bend it, add
  points for more bends, or close the loop for a vesicle or a cell outline with a filled inside. The
  same element draws monolayers, bead filaments (actin-like) and tubes (microtubule-like).
- **Chemical structures**: a skeletal-formula editor. Type a SMILES string (`CCCC(=O)O`, `c1ccccc1`,
  caffeine, glucose…) and it is laid out: rings as regular polygons, fused rings, zigzag chains,
  substituents pointing outwards, heteroatoms labeled with their hydrogens, charges, double and
  triple bonds. Then build by hand: click an atom and blue dots show where a bond can go, click one
  to grow a carbon, type a letter to change the element (C N O S P F B I, L = Cl, R = Br), 1/2/3 for
  the bond order, W and D for wedge and hashed bonds, + and − for charges, Del to remove. Drag atoms
  to tidy (they snap to 30° and the bond length). Templates for common molecules are in the panel.
- A periodic-table tile, a microscopy scale bar, a funnel diagram, a Kaplan–Meier-style sketch, a QR
  code, legends, label chips.
- **Editable icons**: right-click an icon → *Convert to editable parts* turns it into plain shapes you
  can recolor, move, resize or delete. Select them and choose *Save as icon…* when you are done:
  you name it, the parts become one light element again, and it joins the Add panel under
  **My icons** (the built-in icon is untouched; ✕ on an item removes it). The same works for a
  **group of icons**: select several (or group them with Ctrl+G or the *Group* button in the side
  panel) and choose *Save as icon…*; the elements stay in the figure as they are. Your icons are kept in
  `assets/my-icons.json`, which updates never touch, and are embedded in the figures that use them.

**Arrows for pathways.** Arrow, open, inhibitor ⊣, circle and diamond ends at either end, straight,
curved or elbow routing (the automatic elbow bends up to twice, for side-to-side steps and loops back),
solid, dashed or dotted, and a label you can slide along the line, on a backdrop in the page color.
**Connectors**: drag an arrow end onto an element (or select elements and choose *Connect*: a chain,
one to many, or many into one) and the arrow stays attached: it follows when the element is moved,
turned, resized or aligned, elbows re-route, several arrows on one side spread out, and the
PowerPoint export keeps them as connectors glued to the shapes.

**Colors everyone can read.** About 1 in 12 men cannot tell red from green, and many journals ask
for colorblind-safe figures. Page panel → **Preview colors as** shows the canvas as seen with
deuteranopia, protanopia or tritanopia, or in grayscale (only on your screen: never saved or
exported). **Edit palette…** has colorblind-safe presets (Okabe–Ito, Paul Tol's bright, muted and
high-contrast sets, viridis, cividis, grayscale) with a preview of each set per vision type and the
closest pair named; it can recolor the whole figure in one step (undo takes it back) and give chart
series, survival lines and network modules these colors. **Check colors** (and the Export dialog)
lists text with too little contrast against what it sits on and chart colors that look alike for
colorblind readers. On a dark page, charts draw their labels and axes in light gray by themselves.

**Editing that stays out of the way.** Smart alignment guides and snapping, groups, align and
distribute, layers with lock and hide, right-click menu, in-place text editing, text boxes that
re-wrap when resized, a figure-wide color palette (its swatches under every color field) with "replace a color everywhere", templates,
resizable side panels, keyboard shortcuts (`?` shows them), undo of the last 300 steps, automatic version history,
archive and trash for finished or abandoned figures. A light and a dark theme, four interface styles
and three panel layouts let you make the editor your own.
**Keyboard and screen readers**: F6 moves between the toolbar, the panels and the canvas; on the canvas
Tab selects the next element and the arrow keys move it; screen readers hear what is selected, toggle
states and messages; the toolbar wraps onto a second row at high browser zoom; the High contrast style is
picked automatically when the system asks for more contrast, and Windows contrast themes leave the figure's
own colors alone.

**Built for the review loop with an AI.** Pin a **comment** on any element (it moves with that
element); the assistant (or a colleague) replies on it, and the Comments list shows when you edited a
comment after the reply. **Sketch mode**: draw a rough idea with a pen, add text notes, press
*Build it with my AI*, and paste the generated request into your assistant, which turns the sketch
into a real figure. A small page API (`window.fig`) lets the assistant read and change the figure
while you watch.

**Export for journals, print and slides.** A vector **PDF** whose text stays text (set in Helvetica,
Times or Courier, the fonts every PDF reader has, at the widths it has on the canvas; Greek letters and
math signs included; the fonts are not embedded, so for a submission system that requires embedded fonts
tick "rasterize"), with icons, formulas and charts as vector paths and inserted pictures at their own
resolution; a **TIFF** (LZW-compressed or uncompressed, with its dpi) for journals that ask for one;
PNG at any physical width and dpi (tagged so Word and PowerPoint place it at the right size); all
optionally transparent; SVG; and a PowerPoint slide in which text, shapes, chips, arrows, funnels and
legends stay native editable objects (Google Slides opens the same file, equally editable). **Journal
sizes**: pick Nature, Cell Press, Science, PNAS, PLOS or eLife column widths (or an A0/A1 poster) and
the dialog sets the print width and a suitable resolution (600 dpi for line art, 300 with photos) and
checks the smallest text, the thinnest line and the pictures' print resolution (ppi) at that size.
**Text sizes**: set the print size once in the Page panel and every font size field shows its printed
pt; *Text sizes…* lists all sizes in the figure and raises everything below, say, 6 pt in one step.
**Posters**: File ▾ → New figure has A0 portrait (3 columns) and A0 landscape (4 columns) posters with
the print size already set (title band with authors and affiliations, logo spots, section boxes,
take-home message, references, a contact QR code), plus graphical abstracts in the common shapes
(landscape 2.5 : 1 as Elsevier asks, square as Cell Press, a 3.25 × 1.75 in table-of-contents graphic
as ACS; check your journal's guide). The print size list also has US poster boards (36 × 48, 48 × 36,
44 × 44, 72 × 36 in). When the page has another shape than the poster sheet, the Page panel says how
much of the sheet would stay empty and *Give the page the sheet's shape* fixes it (the Export dialog has the same button for a sheet picked there). With a poster print
size the PowerPoint slide is the printed size, so its font sizes are the printed ones, and new elements
start large enough to read (body text about 28 pt). A **Section box** (Add panel) holds its own
wrapped text with an optional header: widen it with its side handles and the text re-wraps, type more and it grows downward.
**Several figures at once**: tick them in
a list with thumbnails and get one file each, one PDF with a page per figure, or one PowerPoint deck
with a slide per figure.

## Working in the editor

- **Add** panel: type to search all items, or pick a group with the chips at the top; click a group
  title to collapse it; items you used recently and favorites (☆ on an item, or F) stay at the top. Click
  or drag items onto the page, or press ↓ in the search field, walk the results with the arrow keys and
  press Enter (Shift+Enter also moves to the new element's fields).
  Drop or paste image files to insert them. A picture is never stretched: width and height set a frame
  it fills (crop), "part shown" picks what is visible; *Stretch* shows the whole picture at its own
  proportions. TIFF files (from a microscope, or the editor's own TIFF export) are stored as PNG, so they
  show in every browser, PowerPoint and PDF: uncompressed, LZW, PackBits or Deflate, 8/16/32-bit gray, RGB
  or RGBA, the first page of a stack; 16- and 32-bit pictures get their brightness stretched from the
  darkest to the brightest value, as ImageJ shows them. An iPhone HEIC photo is stored as JPEG where the
  browser can open it (Safari); in Chrome or Firefox export it as JPEG first (Photos or Preview).
- **Copy to other apps**: `Ctrl+Shift+C` (or right-click → *Copy as picture (PNG)*) copies the selection
  as a crisp picture for Keynote, PowerPoint, Google Slides, Word or Slack; *Copy as SVG* gives
  Illustrator or Inkscape the vector drawing. `Ctrl+C` copies elements for pasting into another figure.
  Right-click → *Paste from clipboard* takes a picture or text copied in another app (the browser may
  ask once whether the page may read the clipboard).
- **Multi-panel figures**: select the panels and press *Label panels* (bold a, b, c… above each panel
  in reading order, 8 pt at the print size) or *Grid…* (rows and columns with an even gap, optionally
  the same height per row; the letters move along). *Re-letter* renumbers them after a rearrange.
- Double-click text (or a section box) to edit it in place; double-click a formula for the builder. Right-click for the
  menu (it also has *Convert to editable parts* for icons and *Fuse into one element* for a
  selection). `?` shows all shortcuts.
- Text boxes: drag the side handles to set the width; the text re-wraps, the font size stays.
- `Ctrl+G` groups, `Ctrl+D` duplicates, `Ctrl+S` saves now (it also saves automatically),
  `Space`+drag pans, `Ctrl`+wheel / pinch zooms, `Shift+1` fits the page.
- A figure open in two windows or tabs, or edited by your assistant while you work, stays in one piece:
  changes made elsewhere are merged into yours element by element. Where both changed the same property,
  your window keeps its value (*Details* in the message lists them), and `Ctrl+Z` undoes the merge. A
  window closed before its last change could be merged leaves that change in the version history.
- Drag the edge of either side panel to make it wider or narrower (double-click the edge to reset).
- **Appearance** (the gear button, or **File ▾ → Appearance…**): a light or dark theme (or follow your
  computer), four interface styles (Classic, Soft, Flat, High contrast), five accent colors, three panel
  layouts (standard, swapped, or both panels on the right), larger text, compact spacing, words under
  the toolbar icons, and fewer animations. `Ctrl+\` hides both side panels (focus mode). These settings
  change only the editor and are saved in your browser: figures and exports always look the same.
- **File ▾**: new figure (from templates, the examples, or a copy), duplicate, rename, version
  history, export several figures, a .json copy. The archive-box and trash icons next to the figure
  switcher hold the archive (keeps the figure list short) and the trash (restorable; delete permanently
  from the trash).
- **Sketch mode** (pencil button, or File ▾ → New figure → "Sketch my idea first"): draw a rough idea
  with a pen and place text notes, then press **Build it with my AI**.
- **Export**: PNG, PDF or TIFF with print width + dpi (optionally transparent; **Size** offers journal
  columns and poster sheets and warns when text gets too small to print), SVG, or a PowerPoint `.pptx`,
  all written to `exports/`. For a PDF that looks exactly like the canvas in every detail, tick
  *rasterize*: the page is then one high-resolution picture. **File ▾ → Export several figures…** (or
  "Several figures…" in the Export dialog) exports a selection of figures in one go, as one PDF with a
  page per figure, or as one PowerPoint with a slide per figure.
- New figures start with a small gray "Made with SiliCoDraw.com" line in the bottom-left corner. It is an
  ordinary text element: move it, edit it, or delete it.

## Managing figures: active, archived, trash

Every figure is one `.json` file. The editor sorts them into three places:

| Where | What it means | How to get there |
|---|---|---|
| **Active** (the folder itself) | figures you are working on; these appear in the figure switcher in the toolbar | **File ▾ → New figure**, or bring one back from the archive or trash |
| **Archived** (`archive/`) | finished figures you want to keep but not see every day | the **archive-box icon** next to the figure switcher: *Archive “…”* at the bottom moves the open figure there; clicking an archived figure opens it (it becomes active again) |
| **Trash** (`trash/`) | figures you no longer want; still restorable | the **trash icon**: *Move “…” to trash* at the bottom; each trashed figure has **Restore** and **✕** (delete permanently) |

Nothing is deleted directly: a figure first goes to the trash, and only **✕** in the trash (or *Empty
trash*) removes it for good, together with its version history, after a confirmation. Everything is a
plain file move, so you can also do it in your file manager while the editor is closed.

**A figure file from someone else:** **File ▾ → Load from a .json file…**, or drop the `.json` on the
canvas. It opens as a new figure under its own name (`pathway.json` becomes "pathway", or "pathway-2"
when that name is taken), or, if you choose, replaces the open figure (Ctrl+Z brings that one back).
Several `.json` files or a backup `.zip` dropped on the canvas all come in beside the figures you have.
A copy of an example (`name-example.json`, as the website's example links make) has **File ▾ → Start the
example over…** to get the original back.

## Files

```
figure-editor.html   the editor
serve.py / serve.ps1 the server (same API; PowerShell one needs no Python on Windows)
update.py / update.ps1   the updater (see "Keeping it up to date")
install.sh           the one-line installer for macOS and Linux
Start SiliCoDraw.bat / .command, start.sh, Update SiliCoDraw.bat / .command, update.sh   launchers
updates/             figure backups and previous software versions made by the updater
figure.json, *.json  your figures (one file each)
examples/            example figures: signalling, immunology, chemistry, pathway, gantt, maths, data, icons, icon-library, workflow
docs/                the pictures in this README
lib/mathjax/         the formula typesetter (MathJax), so formulas work offline
tests/               automatic tests (server, installer, and the editor in a headless browser; see tests/README.md)
history/             automatic snapshots      exports/   PNG, PDF, TIFF, SVG, PPTX      assets/   inserted images + my-icons.json (your own icons)
```

## Privacy and network

The server listens on `localhost` only. `python3 serve.py --host 0.0.0.0` makes it reachable from
other devices on your network (e.g. a tablet) — there is no password, so do that only on a network
you trust. Writes (saving figures, exports, file operations) are accepted only from the editor itself and
from tools on your computer; a web page on another site cannot make your browser write into the figure
folder, because the server refuses cross-site requests.

## Status and contributing

Early but used daily by its author for real poster and thesis work; expect rough edges. It was built
together with an AI coding assistant, and that is also the intended way to extend it: open the folder
in your assistant and ask for the element or feature you need (`AGENTS.md` explains the structure).
Bug reports, new icons and example figures are welcome as issues or pull requests. Before sending a
change to the editor, run the browser tests (`sh tests/browser.sh`, or `tests\browser.ps1` on Windows;
add `--browser firefox` / `-Browser firefox` for Firefox, `--browser safari` on a Mac; see `tests/README.md`);
they also run on GitHub for every push, in Chrome, Edge, Firefox and Safari.

## Acknowledgements

All code, icons and example figures in this repository were written for it, except `lib/mathjax/`:
an unchanged copy of [MathJax](https://www.mathjax.org/) 3.2.2 (Apache 2.0, license in that folder),
which typesets formulas, so they work without internet (without the folder the editor fetches the
same version from a CDN). Two more permissively licensed libraries are fetched from a CDN only at the
moment you use the feature, and are not bundled here:
[qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (MIT, Kazuhiko Arase) for QR
codes and [PptxGenJS](https://github.com/gitbrent/PptxGenJS) (MIT, Brent Ely) for the PowerPoint
export. A typeset formula is stored as paths in your figure, so it renders anywhere afterwards.

## License

MIT — see `LICENSE`.
