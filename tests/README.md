# SiliCoDraw tests

Two kinds of tests run on every push to GitHub (`.github/workflows/test.yml`, results in the repository's **Actions** tab)
on macOS, Linux and Windows; the browser tests run in Chrome / Edge everywhere, in Firefox on Linux and Windows, and in
Safari on macOS. You can run them on your own computer too; each prints one line per check and ends with exit code 0 when
everything passed.

| Script | What it checks | Needs |
|---|---|---|
| `smoke.sh` / `smoke.ps1` | the server (page, save, 304 for an unchanged figure, history, file list, refusal of writes from other websites, the app icon files of `brand/` with their content types, the notice board's `notices/`), the first-start setup and installer (macOS / Linux), the updater's dry run | Python 3.7+ (macOS / Linux); nothing on Windows |
| `browser.sh` / `browser.ps1` | the editor itself, in a headless browser: every element type (add, draw, side panel, bounds), every icon (and the environmental microbiology group: both colors used, drawn inside the box, found by the words of the field, older words still finding their old icon first, compound names on pills; an own icon named like a built-in one kept under a free key), every example (loads; SVG, PNG, PDF and PowerPoint export), TIFF export and import, copy as picture / paste from clipboard (with the clipboard stubbed), undo/redo, connectors, elements parked off the page, colors (chart series, ink on dark pages, the color check, recoloring; the color groups of icons from repositories, see "Icon colors" below), rich-text parsing, repairing broken files, `fig` API errors, figure files with several slides (the strip, undo across slides, merging a file edited outside, a PDF page and a PowerPoint slide per slide) and their animations (adding, order, motion paths at an even speed, playing on layers and stopping, PowerPoint timing; Back to original position: its start worked out from the path before it on the canvas, in the show and in PowerPoint's XML, an idle one named by the pane (marked, its note not cut off) and `fig.check` and written to PowerPoint as a path that stays in place; copies that keep their animations: Duplicate, paste, another slide, groups, the start of a row whose partner was not copied, an Alt+click that copies nothing and says nothing and an Alt-drag that says it when it ends, cut and paste in a figure whose one slide came from its first animation, a plain figure that takes none from another figure, pasted JSON repaired) with the animation sidebar (the button, Shift+A and `fig.animPane`, the gallery, the options, the pane's order, reordering and selection, playback, Stop, the preview of a change and a canvas press during it, keys that stay in the sidebar, the focus after Tab and Remove, undo keeping the chosen row, focus mode, a plain figure), a slide's own background color (canvas, every export, light labels on a dark slide, the Page panel, merging, undo), slide transitions (the model and its checks, the thumbnail mark, the Page panel, Preview, PowerPoint's own transition XML) and presenting (start, click steps, going back, jumping, black and white screens, the end screen, keys, clicks, touch and the control bar, transitions on two layers, the presenter view with a frame standing in for its window, nothing changed or saved, also by a paste; a blocked pop-up, full screen lost to the presenter window, a slide that moves on by itself after a black screen or a resize, F5 while typing in place; no real full screen or pop-up is needed), the phone layout (the editor in phone-sized frames, upright and sideways: toolbar, Add and properties sheets, dialogs, menus, Back, finger and stylus gestures, small elements at the opening zoom, exports and app browsers; the desktop and tablet layout unchanged), citations (each parser on samples in the formats Zotero, EndNote, Mendeley and PubMed export, duplicates, every style for one, two and more authors and the edge cases, marks in titles kept as text, numbers across slides and after a slide move, the reference list in step and in columns, the dialog from paste to insert, a look-up with the network stubbed and offline, dropped files, RIS and BibTeX out and back, saving, merging, the citation as text in SVG and PowerPoint, a citation pasted into another figure, a hand edit after undo, several citations in a row staying on the page, emptied form fields, a 200 kB export read whole, "et al." in the source, two columns kept as one list, the keyboard staying where it was), Home (the page of all figures: opening and closing, the list with search, sort and view, selecting several and archiving, restoring and deleting them, the card menu, a section added to its registry, New presentation (button, card, template, the file with slides it makes), Import… and figures dropped on Home (shown selected with the keyboard focus on the first, a repeat skipped, named and pointed at), the Cite button of the top bar (filled quotation marks, never squeezed), the phone layout, a search that hides selected figures, the focus kept in the search box and the navigation, a section without file lists keeping its state, thumbnails free of script from the file, other tabs saving before a move, the start on the plain address (where the browser left off: Home, the last figure, Home when that figure is gone or nothing is remembered, each "At start" setting, a page loaded again, Back and Forward to the plain address, `?phone=1` kept; in a frame: it reads the folder's figures, changes none but the tests' own (a `figure.json` is made for the Back test when the folder has none, and deleted again), and puts back what the browser remembered), friendly dates, empty lists, the template cards, the open figure archived from Home), the notice board on Home (tips and what is new, see "Notice board" below), the app icon (the top-bar logo and Home's, the tab icon as a data URI, the presenter window's, all drawn from `brand/icon-small.svg` and left alone by `svgScrub`; the browser bar in the top bar's color and no logo shadow in the flat style, in every style and theme; every file of `brand/` with its content type, the `.ico` and `.icns` structure), and a save → reload round trip | Chrome, Chromium, Edge, Firefox or Safari; Python 3 on macOS / Linux |

## Run them

macOS / Linux, in the SiliCoDraw folder:

```sh
sh tests/smoke.sh
sh tests/browser.sh
```

Windows (PowerShell):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tests\smoke.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File tests\browser.ps1
```

The browser tests start a server of their own on a free port (the editor you work with is not touched), open
`tests/run.html` in a headless browser, and take 2–3 minutes (most of it is the PowerPoint export of the icon library
example). They work on a scratch figure called `zz-test-….json` (and `zz-test-…-phone.json` for the phone layout) and on figures named `zz-test-…-ws-….json` they make for the folder and Home tests (never on your own figures: every action on several figures runs with only those in sight);
all of them are removed at the end.

Options for the browser tests:

| `browser.sh` | `browser.ps1` | |
|---|---|---|
| `--only icons,examples` | `-Only icons,examples` | only the tests whose names start with these words |
| `--show` | `-Show` | a visible browser window instead of headless |
| `--timeout 600` | `-Timeout 600` | give up after this many seconds (default 1800). A run also stops as soon as the browser has exited or the page has shown no progress for 720 s, and says which test it was at |
| `--browser firefox` | `-Browser firefox` | Firefox (headless, with a fresh profile of its own; your open Firefox windows are not touched) |
| `--browser safari` | | Safari on macOS, through `safaridriver`: it opens a separate automation window (Safari has no headless mode). Turn it on once: Safari → Settings → Advanced → Show features for web developers, then Develop → Allow Remote Automation (or `sudo safaridriver --enable`) |
| `SILICODRAW_BROWSER=/path/to/chrome` | `-Browser C:\path\to\msedge.exe` | use this browser: a path, or `chrome` / `edge` / `firefox` (default: Chrome, then Chromium, then Edge on macOS / Linux; Edge, then Chrome, then Firefox on Windows) |

## Icon packs

Six tests named `icon packs: …` cover the icon expansions (Import more icons). Four of them use `icon-pack-test/`, a
pack of three made-up icons beside the tests (not art from any repository): the list of packs, the pop-up whose Import
button works only after its box is ticked, the import, the pack's own groups, Show icons from (groups and search),
the tooltip, the credit line (added once, following the icons, remembered when deleted, plain text when edited, kept
by converted parts and fused elements, one per slide), `fig.check`, the Page panel and the Export dialog reminding of a
missing line, the credits embedded in the figure, a figure opened where the pack is not installed, undo / redo, exports
and what the API refuses. The test pack is taken out of the library again at the end (`assets/icon-packs.json` no longer
names it). One of the four covers the cases a review found: the line comes back when a hidden icon is shown again
(and stays away when the user deleted it), a line that gets longer is wrapped inside the page, more than three icons
credited one by one (the page line names the repository; `fig.check` and the Page panel say that the creators still
need their credit), ids of their own for every drawing of an icon, an export right after placing an icon whose part
has not come yet (`fig.iconsReady()`), a figure's own copy that never replaces a library icon or its credits, a
canceled import, a pack imported in another tab meanwhile (`assets/icon-packs.json` keeps both), the message when a
search finds nothing in the sources shown, lines made on slides that are not shown, the reminders for every slide
(`fig.check({slides: true})`, the Export dialog), credits carried on the clipboard into a figure where the pack is
unknown, links of a pack (http(s) only), `svgScrub` (no style sheet, nothing from another host), and the keyboard
focus after Remove from library. The fifth reads every icon of the packs shipped in `icon-expansions/`: each passes
the editor's `svgScrub` unchanged, has a name, a key in its pack's namespace, colors to swap, a visible box that fits,
ids that are used once and references that point to the right kind of element; `pack.json` is complete (its links
https), `LICENSE.txt` and `ATTRIBUTION.md` are there, a pack credited per icon names page and license for each, and
SciDraw names every author, keeps the title of a numbered name and has neither its own logo nor a real person's likeness.
`smoke.sh` / `smoke.ps1` check that the servers serve the packs with their license files.

## Icon colors

Two tests named `icon colors: …` cover the color groups of icons from repositories (and the user's own): OKLab / OKLCH
round trips for 4,000 colors and reference values; a group's shades keeping their hue offset, chroma ratio and
lightness order after a recolor, also when a very saturated color is clamped into sRGB, a gray new color keeping the
lightness steps and a gray main's colored member keeping its hue; the same groups twice, the red shades of a made-up
shaded drawing as one group, its blue part as another, outline ink and white highlights listed last, and a gradient's
stops sharing what it covers; a dark gray beside a gray material in that material's group, a small clear blue never folded into a gray cell, a color only a mask uses not a group and a mask left alone when the icon is recolored (its own contents still black), a `<use>` circle done at once; a gray main whose members take the new hue, and no jump at the gray threshold. The second test: an icon without `grp` drawn exactly as before (byte for byte, c1 through
the color key only) and with every group at its own color drawn exactly as made; `fig.iconColors` (a group by its main
color or number, One color, Reset, an unknown group refused); `fig.update` / `fig.check` naming a key that is no color
of the icon (with "did you mean"), a key of the second group coloring it, values that are no color dropped, a file's `grp`
repaired when it is read, `fig.schema`; the panel (a swatch per group big enough to see, the tiny ones behind More, each with a name and a strip of shades, no main /
accent fields beside it, the group shown on the canvas under the pointer or with the focus without changing or saving
anything, an export meanwhile showing the icon as it is, the color field live while dragging and one undo step when
done, recent colors, a quick pick, Reset this color, undo / redo, the arrow keys, Reset colors taking the field off);
several icons of one kind sharing the row, different kinds and built-in icons keeping c1 / c2; another kind keeping the
largest group's color (refused while the new drawing is still loading); `grp` given by `fig.add` / `fig.update` keeping the look and `grp: null` putting the library's c1 / c2 back; an icon recolored with c1 / c2 keeping every other color exactly when one group changes (exact `=#color` entries, dropped when their group changes); the same targets when the two largest groups rank the other way; Esc in a group's color keeping the selection, a click showing the group, a new selection starting closed, the phone sheet's quick row as Color 1; the color check naming two groups that look alike after recoloring; save (the field and the
embedded drawing in the file), a copy pasted and a figure opened where the icon is unknown drawing the same, SVG, PNG,
PDF, a Home thumbnail, Convert to editable parts and the PowerPoint picture with the new colors; an icon without color
keys (`fixed`) recolored by its groups. `dev/icon-import/color-groups.js` (private copy) is the
quality check behind the thresholds: it groups 330 icons of the packs and 20 own icons and draws contact sheets.

## Crop

Six tests named `crop: …` cover cropping: every type that can be cropped draws a clip path and gets the smaller bounds
(arrows and comments refuse); the cropped bounds for a turned, flipped and scaled element, `fig.list()`, align, a
connector's end, a press on the cropped-away part, a pinned comment, the off-page rule and animations; crop mode
(the eight handles and the frame dragged with pointer events, nothing committed until Enter, one undo step, redo, Esc,
the arrow keys, Shift on a corner, the proportions, the panel's fields, Done, Reset crop, a press outside, a turned and
mirrored element, Remove crop, Shift+X); the exports (SVG clip paths, the pixels of the PNG, a real clip and text that
stays text in the PDF, PowerPoint's `srcRect` for a picture with fit and crop together, other cropped elements as
pictures, an animation that still finds its shape) with clip ids of their own in thumbnails and the slideshow; and
duplicate, paste, Convert to editable parts, Fuse, the repairs of a bad crop, the warnings, `fig.crop`, text editing,
and save → load (a figure without crops is the same, byte for byte, after load → save); and crop mode with other things
happening: PageDown and `fig.slide` apply the crop on its own slide (slides that share an element id), an untouched frame
leaves a crop that came from the file alone, the right-click menu offers Apply crop / Cancel crop and Esc closes it
first, zoom keys and Fit keep crop mode, the left / right fields of a flipped element mean the sides as seen, a field
shows the value used after leaving it, Done and Remove crop leave the focus on the canvas, `fig.schema` lists `crop` only
for what can be cropped, and a picture's panel has one button called Crop.

## Notice board

Four tests named `notice board: …` cover the board of tips and news on Home: its place in the bar of Figures (between
the search box and the sort list, a region with a name, buttons with names, no overlap, only on Figures),
`notices/notices.json` (25+ tips, the news, American spelling) and the built-in copy being the same, the light marks
(escaped words, bold, italic, keys), the clock moving it on with a fade (`nbTick` with a whole turn instead of waiting),
a step by the user being said once, the pauses while the pointer is over it or the focus is in it, reduced motion (no
fade, no turn of the clock), folding into the Tips button and back (remembered in this browser, never in the figure),
What's new with the news not seen first and their seen-state (its count and the Tips button's dot drawn again when it closes, the focus
back on What's new), All tips, the whole item as a tooltip, a redraw of Home during the fade (the board goes on turning, its
buttons work), another tab's fold and seen news kept and followed, `fig.notices`; a missing or broken file falling back to
the built-in copy and an unsafe one neutralized (markup in words, `javascript:` and unknown actions, pictures from
another host, a drawing with script), every action name doing what it says, a click on an item, no request to another
host (every `fetch` recorded to the end of the test, and every resource loaded meanwhile); and the layout in frames from 320 to 2560 px wide: in the bar's row from about 2165 px (with room for two or three lines of its words), on a row of its own
when not (2000 px included), the bar's buttons at the right edge at 2560 px folded or not, a strip on a phone with its four buttons two by two
(sideways: in a row) without the tips that name keys or right-click, nothing off the screen. The fourth draws every item (every tip and news item; on a phone the
items a phone shows) at 560 to 2560 px (at most three lines from 560 to 700 px without the phone layout, four with large text), on phones 320 to 430 px upright and 667 and 844 px sideways, with large text, compact spacing, every style
and light / dark, and checks that it is shown whole: no ellipsis or clamped lines, the words' boxes neither scroll nor leave the board (1 px
allowed), nothing under the picture or the buttons, text never under 12 px, the board overlapping none of the bar's controls, and the board's
height the same for every item at one width (so the cards below do not move while the items turn), and the same while the items are still loading; the fade (words and picture
at opacity 0) and the buttons' layout; about 72 px tall on a wide screen (46 px before). The smoke tests also check, in a git checkout, that
`notices/notices.json` and the other software JSON files are not ignored by `.gitignore`. `smoke.sh` / `smoke.ps1` check that
the servers serve `notices/notices.json` and its pictures.

## In a browser

With SiliCoDraw running, open <http://localhost:8770/tests/run.html>. It shows each test as it runs and the editor
under test below. `?only=icons,undo` runs only some of them.

Inside an open editor tab on a scratch figure (`?file=zz-mytest.json`; the tests replace that figure's content and put
it back at the end), from the browser's developer console:

```js
eval(await (await fetch('tests/editor-tests.js')).text()); await runEditorTests({only: ['rich text']})
```

PowerPoint export loads its library from the internet the first time; without a connection those checks are reported
as skipped, not failed.
