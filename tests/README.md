# SiliCoDraw tests

Two kinds of tests run on every push to GitHub (`.github/workflows/test.yml`, results in the repository's **Actions** tab)
on macOS, Linux and Windows; the browser tests run in Chrome / Edge everywhere, in Firefox on Linux and Windows, and in
Safari on macOS. You can run them on your own computer too; each prints one line per check and ends with exit code 0 when
everything passed.

| Script | What it checks | Needs |
|---|---|---|
| `smoke.sh` / `smoke.ps1` | the server (page, save, 304 for an unchanged figure, history, file list, which writes are accepted (see "Writes and Quit" below), the app icon files of `brand/` with their content types, the notice board's `notices/`, `api/quit`), the first-start setup and installer (macOS / Linux; on Linux the applications-menu entry), the launcher `Start SiliCoDraw.bat` and a PowerShell restricted by IT policy (Windows), the updater's dry run | Python 3.7+ (macOS / Linux); nothing on Windows |
| `browser.sh` / `browser.ps1` | the editor itself, in a headless browser: every element type (add, draw, side panel, bounds), every icon (and the environmental microbiology group: both colors used, drawn inside the box, found by the words of the field, older words still finding their old icon first, compound names on pills; an own icon named like a built-in one kept under a free key), every example (loads; SVG, PNG, PDF and PowerPoint export), TIFF export and import, copy as picture / paste from clipboard (with the clipboard stubbed), undo/redo, connectors, elements parked off the page, colors (chart series, ink on dark pages, the color check, recoloring; the color groups of icons from repositories, see "Icon colors" below), rich-text parsing, repairing broken files, `fig` API errors, figure files with several slides (the strip, undo across slides, merging a file edited outside, a PDF page and a PowerPoint slide per slide) and their animations (adding, order, motion paths at an even speed, playing on layers and stopping, PowerPoint timing; Back to original position: its start worked out from the path before it on the canvas, in the show and in PowerPoint's XML, an idle one named by the pane (marked, its note not cut off) and `fig.check` and written to PowerPoint as a path that stays in place; copies that keep their animations: Duplicate, paste, another slide, groups, the start of a row whose partner was not copied, an Alt+click that copies nothing and says nothing and an Alt-drag that says it when it ends, cut and paste in a figure whose one slide came from its first animation, a plain figure that takes none from another figure, pasted JSON repaired) with the animation sidebar (the button, Shift+A and `fig.animPane`, the gallery, the options, the pane's order, reordering and selection, playback, Stop, the preview of a change and a canvas press during it, keys that stay in the sidebar, the focus after Tab and Remove, undo keeping the chosen row, focus mode, a plain figure), a slide's own background color (canvas, every export, light labels on a dark slide, the Page panel, merging, undo), slide transitions (the model and its checks, the thumbnail mark, the Page panel, Preview, PowerPoint's own transition XML) and presenting (start, click steps, going back, jumping, black and white screens, the end screen, keys, clicks, touch and the control bar, transitions on two layers, the presenter view with a frame standing in for its window, nothing changed or saved, also by a paste; a blocked pop-up, full screen lost to the presenter window, a slide that moves on by itself after a black screen or a resize, F5 while typing in place; no real full screen or pop-up is needed), the phone layout (the editor in phone-sized frames, upright and sideways: toolbar, Add and properties sheets, dialogs, menus, Back, finger and stylus gestures, small elements at the opening zoom, exports and app browsers; the desktop and tablet layout unchanged), citations (each parser on samples in the formats Zotero, EndNote, Mendeley and PubMed export, duplicates, every style for one, two and more authors and the edge cases, marks in titles kept as text, numbers across slides and after a slide move, the reference list in step and in columns, the dialog from paste to insert, a look-up with the network stubbed and offline, dropped files, RIS and BibTeX out and back, saving, merging, the citation as text in SVG and PowerPoint, a citation pasted into another figure, a hand edit after undo, several citations in a row staying on the page, emptied form fields, a 200 kB export read whole, "et al." in the source, two columns kept as one list, the keyboard staying where it was), Home (the page of all figures: opening and closing, the list with search, sort and view, selecting several and archiving, restoring and deleting them, the card menu, a section added to its registry, New presentation (button, card, template, the file with slides it makes), Import… and figures dropped on Home (shown selected with the keyboard focus on the first, a repeat skipped, named and pointed at), the Cite button of the top bar (filled quotation marks, never squeezed), the phone layout, a search that hides selected figures, the focus kept in the search box and the navigation, a section without file lists keeping its state, thumbnails free of script from the file, other tabs saving before a move, the start on the plain address (where the browser left off: Home, the last figure, Home when that figure is gone or nothing is remembered, each "At start" setting, a page loaded again, Back and Forward to the plain address, `?phone=1` kept; in a frame: it reads the folder's figures, changes none but the tests' own (a `figure.json` is made for the Back test when the folder has none, and deleted again), and puts back what the browser remembered), friendly dates, empty lists, the template cards, the open figure archived from Home), the notice board on Home (tips and what is new, see "Notice board" below), the app icon (the top-bar logo and Home's, the tab icon as a data URI, the presenter window's, all drawn from `brand/icon-small.svg` and left alone by `svgScrub`; the browser bar in the top bar's color and no logo shadow in the flat style, in every style and theme; every file of `brand/` with its content type, the `.ico` and `.icns` structure),, File ▾ → Quit SiliCoDraw (saved first, `api/quit` asked once, the stopped page, no key reaching the figure under it; neither the item nor the ⋯ menu entry on the website), the libraries in `lib/` (QR codes and PowerPoint load from there, and the SHA-384 in each CDN fallback's `integrity` is the hash of that same copy), and a save → reload round trip | Chrome, Chromium, Edge, Firefox or Safari; Python 3 on macOS / Linux |

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

## Writes and Quit

`smoke.sh` / `smoke.ps1` check the rule both servers share for writes (every POST): a request from the editor's own page
(`Origin: http://localhost:<the server's port>`, `Sec-Fetch-Site: same-origin`) is accepted; one whose `Origin` is another
port of this computer (a dev server, another app), another site, or `Sec-Fetch-Site: same-site` is refused with 403, for a
figure, `api/move` and `api/quit` alike, and leaves no file; a request with no `Origin` (a tool: curl, a script, an agent,
these tests) is accepted as before; a foreign `Host` is refused (`serve.ps1`: 400 from HttpListener, `serve.py`: 403); PUT
answers 405. Files of the figures folder (a figure, an SVG posted to `assets/`) must come with `Content-Security-Policy:
sandbox; …` and `X-Content-Type-Options: nosniff`, and the editor page without that policy. Then `api/quit` from the editor's own page answers 204 and the server ends. On Windows `smoke.ps1` also runs
`Start SiliCoDraw.bat` on a free port with `SILICODRAW_PORT` and `SILICODRAW_NO_BROWSER=1` (no browser opens, the Start-menu
shortcut is not touched): it must wait until the server answers and end with 0, and its server must stop with `api/quit`;
and it starts `serve.ps1` in a PowerShell switched to ConstrainedLanguage, which must say that IT policy blocks the local
server and point to silicodraw.com. The Start-menu shortcut itself (`shortcut.ps1`) is not run by the tests: it would change
the Start menu of the computer running them.
## Icon packs

Nineteen tests named `icon packs: …` (twenty with Servier Medical Art) cover the icon expansions (Import more icons). Four of them use `icon-pack-test/`, a
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
https, one to three known `fields`, the same in `index.json`), `LICENSE.txt` and `ATTRIBUTION.md` are there, a pack credited per icon names page and license for each, and
SciDraw names every author, keeps the title of a numbered name and has neither its own logo nor a real person's likeness.
NIH BioArt Source may have drawings up to 300 KB (a filter, of a drop shadow or glow, is a reference too); it is Public
Domain only with creator and page for every icon, keeps keys of its first version, has neither a color version among its
drawings (`-grey`, `-bw`, `-red-hue`) nor the other colors the site keeps as entries of their own (their words find the
icon kept; the male outline's skin tones are colorways), nor the atlas drawings and shipping canes with labels drawn in, keeps a stained
smear (found by "stained") and a plain plasmid as icons of their own, names the outlines' own colors Type I and Type II, has names in American spelling, keeps a pattern fill, and white
or light parts that show on a dark page. Arcadia Science is CC0 and asks for no credit, names Arcadia Science, the library's DOI and
the file's page for every icon (and the PhyloPic uploader of each of the ten drawings adapted from PhyloPic), has each organism as its
three-color drawing and as its silhouette, and no name cut short; a test of its own imports it, finds its icons by common and scientific name, places one (no credit line, nothing
for `fig.check` to remind of) and reads Copy full icon credits. Reactome is CC BY 4.0, credited per icon with its designer, may have drawings up to 300 KB, names the
designer and the icon's file in Reactome's GitHub repository for every icon, keeps names as Reactome writes them (mRNA), leaves
out the label badges (a name written into a pill or hexagon), the arrows and backgrounds and the drawings with a label written in,
keeps the drawings the label rule must not take, and lets the name of a drawing left out as another color find the one kept (also each member of a family drawn alike, such as the
SLC and ABC transporters), and keeps a drawing whose color or detail tells what it is as an icon of its own that the icon it was once folded into is not found by (lyxose, fructose, the generic nucleotides, sugars and damaged bases, the T cell stages and subtypes, the regulatory B cell, CTLA4, COPI and COPII vesicles, preNOTCH, uridylated mRNA); a test
of its own reads the import pop-up, imports it, finds its icons by name (and each of those kept apart first by its own name: COPII vesicle, regulatory T cell, lyxose, CTLA4), places one (the credit line names the icon and its designer),
then four (the line names only the library and `fig.check` says that each creator still needs credit), recolors an icon painted
with gradients only by its color groups, and checks the SVG. Bioicons has per icon CC0, CC BY 4.0, CC BY-SA 4.0 or MIT (the folder it is
filed in) with its creator and its file in Bioicons' GitHub repository, may have drawings up to 300 KB, has no logo, brand or drawing of a library
it re-hosts, has drawings traced from a picture without the picture's white page behind them, keeps the file's own name as the title where
the library gives another, and lets the names of other colors (a pill, an antibody)
and of the hazard pictograms drawn a second time find the one kept (the same pictogram: toxic finds the skull, acute the exclamation mark, chronic the health hazard), while the fluorescent bead in five colors (the color is the fluorophore) and the second transporter drawing are icons of their own; a test of its own reads the import pop-up (credit for some icons,
share-alike), imports it, finds its icons by name, places a CC0 icon (no credit line), then icons under CC BY 4.0, CC BY-SA 4.0 and MIT (the
line names each with its creator and all three licenses), reads Copy full icon credits, then a fourth (the line names only Bioicons and
`fig.check` says that each creator still needs credit). PhyloPic has per icon Public Domain Mark, CC0, CC BY 3.0 or CC BY 4.0
(never NonCommercial or ShareAlike) with its image page and, under CC BY, the creator PhyloPic names; one icon per taxon and one taxon per genus in a group (a subgenus counts as its genus), a group of PhyloPic's
clades for every part, no human figure, no public-domain tracing of another person's recent work, the model organisms, names by taxon with
the vernacular names as search words, and parts fetched as they are used; a test of its own reads the import pop-up (credit for
some icons, no share-alike), imports it, finds its icons by common and scientific name, places a CC0 and a public-domain icon (no
credit line), then a CC BY 4.0 and a CC BY 3.0 icon (the line names each with its creator and both licenses), reads Copy full icon
credits, then a fourth (the line names only PhyloPic and `fig.check` says that each creator still needs credit), and recolors a
silhouette (its one group is its color, not an outline). Health Icons is CC0 with no credit asked and no creator per icon:
every icon CC0 from the 48 px filled style, in one color, with its file on GitHub; no letters, digits, plain shapes, logos, trademarks or
user-interface glyphs, no brand names or DHIS2 ids among the search words, names in American spelling and the rapid tests named by result, a drawing the source has twice kept once (its words finding it),
small enough to load at once; a test of its own reads the import pop-up (no credit, nothing share-alike), imports it, finds its icons
by name (also by the British spelling and the source's own title), places two icons (no credit line, nothing for `fig.check` to
remind of), reads the tooltip and Copy full icon credits, and recolors a pictogram (Color 1, not an outline). OCHA Humanitarian Icons is public domain (CC0) with no credit asked: every icon CC0, a black file of the repository, in one color, in SiliCoDraw's own groups; no user-interface or file symbols, status marks, lettering, conflict, violence, military, religious buildings or UN lettering among the icons or names, nothing in the pack's texts that suggests UN endorsement and OCHA's disclaimer in the pop-up, names in American spelling with the source's own as the title, no page clip on a drawing that only reaches its page edge, small enough to load at once; a test of its own reads the import pop-up, imports it, finds its icons by name and by common words (hurricane, bacterium, skull), places two icons (no credit line, nothing for `fig.check` to remind of), reads the tooltip and Copy full icon credits, and recolors a pictogram. Inkscape Electric Symbols is public domain (CC0) with no credit asked and no words of its own to quote: every icon CC0, from the symbol sheet at a pinned commit, in SiliCoDraw's own groups; no marker or live text left in a drawing (arrowheads drawn as shapes, letters as outlines, both there), every drawing recolorable with its black line as Color 1, the sheet's titles kept as the title, small letters kept (abc to dq transformation), names that say what differs (no bare "2", the s block not called 1/s), no USB trident, logo or repeat left out on purpose, small enough to load at once; a test of its own reads the import pop-up, imports it, finds its icons by name and by common words (zigzag, rheostat, opamp, Park and Clarke transformation, GND, gallium nitride, opener), places two icons (no credit line, nothing for `fig.check` to remind of), reads the tooltip and Copy full icon credits, and recolors line art with its letter (Color 1, not an outline). WMO WorldWeatherSymbols is CC BY 4.0, credited with one line for the pack (the repository gives no wording, so its LICENSE is what the pop-up quotes): every icon CC BY 4.0 with the creator its file's metadata names and its file at a pinned commit, in black, in groups by the WMO code tables; no marker or live text left (arrowheads drawn as shapes, there on the tornado, wall of dust, ship and snow cover symbols), every symbol recolorable with black as Color 1, named by code and description (no footnote, French, capitals, source typo or name over 72 characters or cut after a small word; "at time of observation" left off; the file's title kept), a symbol another code table repeats (or draws again with a hair of difference: w1w1 69b, wawa 92b, the calm wind circle) kept once and found by that table's code, no stray dot of the drawing program and no symbol cut off at its page (the automatic station triangle and the tropical cyclones whole), no Southern Hemisphere mirror image, w1w1 rate of fall or E 9, small enough to load at once; a test of its own reads the import pop-up (attribution required, the LICENSE quoted, not endorsed by the WMO, ICAO or the OGC, nothing share-alike), imports it, finds its symbols by code (ww 95, ww95, a wawa code that a ww symbol stands for) and by words (cold front, cumulonimbus, wind barb, hurricane, oktas, SIGWX, calm wind), places two (one credit line in the pack's words, nothing for `fig.check` to remind of), places three more (still one line, the same words), reads the tooltip and Copy full icon credits, recolors a symbol with its arrowhead (Color 1) and exports the line with the SVG. SBOL Visual is CC0 for its glyphs (the exception in the repository's otherwise CC BY 4.0 LICENSE.html, quoted in the pop-up) with no credit asked: every icon CC0, a glyph file of the GitHub repository at a pinned commit (never sbolstandard.org, whose content is CC BY-NC-ND, and no specification, example or deprecated drawing), in black, in groups by the repository's folders; no marker or live text left (the characters ?, [ ], ..., AAA and the asterisks set as outlines and drawn, the arrowhead of Origin of transfer a shape), every glyph recolorable with black as Color 1, the two files with a zero-width view box drawn as their glyphs, the open wave of the single-stranded nucleic acid not filled white (the Process node keeps its white interior), a glyph filed in several glyph sets kept once and found by the other sets' names, names after the glyph sets with the SO / SBO terms as search words, small enough to load at once; a test of its own reads the import pop-up (no credit asked, the website not used, not endorsed), imports it, finds its glyphs by name and term (promoter, RBS, coding sequence, loxP, polyadenylation, stop codon, repression, SO:0000167, genetic circuit), places two (no credit line, nothing for `fig.check` to remind of), reads the tooltip and Copy full icon credits, and recolors a glyph with its letters (Color 1, not an outline). Open Crop Icons is CC0 (its README and package.json; no LICENSE file) with no credit asked (one welcomed, in its words in the pop-up): every icon CC0 with no creator, the one drawing of its crop at a pinned commit, in SiliCoDraw's own groups; misspelled folder names corrected in the names (Artichoke, Yukon Gold Potato, Brussels Sprout, Jalapeño) and still search words, no cannabis or psilocybin, a drawing the repository has again in other colors kept once and found by those names (purple carrot, red cabbage, wax bean), while another ripeness or species is an icon of its own named for it (the green, red, orange and yellow bell peppers, the Tabasco and serrano peppers, the oyster mushrooms, salsify, Japanese yam, nectarine), the cantaloupe that failed the comparison with its original not back unseen, small enough to load at once; a test of its own reads the import pop-up, imports it, finds its icons by name, by corrected and original spellings and by a folded color, finds each pepper, mushroom or fruit kept apart first by its own name (red bell pepper, pink oyster mushroom, nectarine), places two (no credit line, nothing for `fig.check` to remind of), places a WMO symbol beside them (one line, which does not name Open Crop Icons), reads the tooltip and Copy full icon credits, and recolors a drawing (c1, color groups). The Expression Atlas anatomograms are CC BY 4.0 (the README; the Expression Atlas licence page names the species anatomograms), credited with one line for the pack that cites the article EMBL-EBI asks for: every icon CC BY 4.0 with its file at a pinned commit, only the male body naming creators (the authors of its public-domain Wikimedia Commons outline: Vsion, Sjef, tsaitgaist), in the groups Human, Animals, Plants and Plant parts; no EBI logo left (its green mark), every drawing (but the anole, with too little tissue) with the outline gray and the tissue red as its two colors, the tissues drawn under the outline, named by common name and species with the tissues it shows as search words, the three drawings over 700 KB not back unseen, small enough to load at once (drawings up to 700 KB, the only pack above 300 KB); a test of its own reads the import pop-up (attribution required, EMBL-EBI's own words with the licence page and the article's DOI, the public-domain outline, not endorsed by EMBL-EBI, nothing share-alike), imports it, finds its drawings by species (human body, Mus musculus, maize, corn, Arabidopsis) and by tissue (uterus, prostate, hippocampus; not by skin, a tissue left unfilled), places two (one credit line in the pack's words, nothing for `fig.check` to remind of), places three more (still one line), reads the tooltips (the male body's names its public-domain outline) and Copy full icon credits, recolors the tissue group with the outline kept (and the anole's small tissues by their group), and exports the line with the SVG. The first test also covers a pack imported while it asked for no credit that
an update made ask for some: not imported until its terms are accepted again. One more test covers many packs side by side
(it imports every shipped pack and puts back what was imported before): the Import more icons list with its search and
field chips (rows shown per field and per search word, the license and the pack's categories found too, "No pack matches" and
Show all packs, the filter kept when the list is drawn again, the keyboard, the list taking the panel's height with a strip of
icons below and its top staying while it scrolls), Show icons from folded behind one line (what it says for all, none, one and
a few hidden, All and None, unfolded and remembered), the Add panel making only its first groups at once and the rest as they
are scrolled to or reached with End (and its time), and the ranking across packs (the built-in Mitochondrion, Mouse and Heart
before the packs' look-alikes, in the panel and in `fig.findIcon`, a pack's closer "Rain (ICAO)" before the built-in Raincloud
plot, the shorter name first among pack icons, the same order whatever order the packs were imported in). A test of its own
covers the libraries and the relevance search: the ranking as a pure function (`palRank`: exact name, the name starting with the
word, a whole word, the start of a word, a tag, inside a word, in that order; a typo forgiven only when nothing else matches; two
words as a phrase first; British spellings, irregular and -eys plurals, a synonym; the built-in bonus never past a closer name;
the key typed exactly first; a name without its brackets or ", silhouette" counted as the name; a whole word before the start of
a word, a short rest before a long one; a synonym that is the whole name ("corn" → Maize); a typo ranked by the whole name, then
its first word; no second pass when no word is close; several words written together ("b cell" → BCell, "zebra fish"), phrase
synonyms ("flow cytometry" → FACS), one-letter words only whole or as the initial before the next word ("e coli", "c elegans";
never "b" in Blood first); no chance hits of words under 5 letters inside a word ("nk", "mast", "axon") while "film" still finds
Biofilm; `palTop`'s variety among ten copies of one drawing, and never letting a lower kind of match jump ahead; counts such as
x14 as variants), a table of real queries with every pack
imported (mouse, mitochondria, neuron, antibody, t cell, dna, heart, kidney, resistor, rain, wheat, zebrafish, petri dish,
pipette, virus, liver, e coli, chloroplast, receptor, beaker: a sensible first result, `fig.findIcon` with the same first icon
and every icon of the panel's ten, variety in the ten), the time per keystroke (each query typed letter by letter; it prints
the average and the slowest), the results (Most relevant with ten and no fold button, More results with its count, a header
per library with mark, count and fold button, the counts adding up, nothing listed twice, a library folded, remembered and
opened again, ↓ from the search to the best match, ↑ / ↓ between Most relevant and the first library past the More results
line), and the library switcher (the libraries with their counts, the listbox by keyboard: ↓ opens it on the library shown,
End, Esc back to the button, Enter picks; SciDraw alone with its groups as chips without the pack's name, a chip and All
within it, remembered in `fig.palLib`, the search looking in SciDraw only (the button, its label and the result line say so;
no group chips while searching), nothing there: how many the other libraries have and Search every library keeping the words,
a library picked keeping the words, the library back when the search is emptied, a group picked inside a pack's library
staying when Show icons from changes, All back, the packs A to Z, letters typed quickly ("sc" → SciDraw), More results a level-3
heading with its libraries at level 4, the "in …" line read out, the switcher growing with Text size Large, no pack chip under
All (a pack's name set as the group still shows its library), a hidden library marked and shown again when picked, the line
naming the library scrolled to). The shared categories test (every shipped pack imported) checks that the chips under All
libraries are All and the categories, never a pack; that every built-in group (`ICON_GROUPS` and the panel's other groups) and
every shipped pack's group is in the table `PAL_CAT_SRC` (none left to a guess or to Other), that no entry of the table names a
group that is gone, and that each pack part's category is a group; that no item is lost (the items of every group once each
across the categories, the same distinct items as under All, `fig.iconCategory` with the same counts); that Animals gathers
several libraries, built-in first and the packs in the switcher's order, each header with its library's mark and name for screen
readers and the group's own name, that its chip is pressed, `fig.iconLibrary` names it and `fig.palCat` remembers it; that the
built-in Organisms goes icon by icon (arabidopsis to Plants & fungi, yeast to Microbes, Human to People); that groups that mix
things go item by item (`PAL_CAT_PICK`: the built-in Bacterium and Virus to Microbes, Centrifuge and Beaker to Lab, Tractor to Food,
Dumbbell to Medicine, Raincloud plot to Charts, Bristlecone pine to Plants; SciDraw's Other, Health Icons' Symbols, OCHA's Data and
coordination) and that a yeast or microalga is under Microbes in every library (`PAL_CAT_ONECELL`); the word rules for a future
pack (Cell culture → Lab, Blood vessels → Anatomy, Neurons → Cells); the All chip's name and every full name starting with its chip's
words; what a picked chip says to screen readers; that a search ignores the category and the
category is back when the search is emptied (and a category picked meanwhile empties the words); one library: its own groups and
"All groups"; only SiliCoDraw shown: the built-in groups as before, and `fig.iconCategory('<category>')` refused without changing
the library; one pack shown on its own: the shared categories; a chip reset by hiding its library is forgotten in `fig.palCat` too;
a narrow panel (170 px): at most three lines and More (n) counting what it
holds, nothing cut off at the edge, More unfolding them all (Fewer, remembered) and folding them again, the chip pressed kept in
sight when it is one of those under More, the chips shown a run from the start with the chip pressed right before More; the keyboard (one Tab stop, ← / →, Home / End reaching More, the focus kept on a chip
picked); Text size Large: the chips grow and none is cut off; and the time to switch to a category. For
Servier Medical Art the same check allows drawings up to 300 KB, checks the shades (`kt`: colors of the drawing, never a
key, at most 256 per key), that no outline ink or near-white highlight is a color key, that no name has words glued
together or a British spelling, the credit in Servier's wording, a part per kit and no logo or Servier name among the
icons; the sixth test imports that pack (a big pack: names and first part only), places one of its shaded icons, recolors
it (its shades follow, also for a short hex color or a color name; its own color draws it as made), checks that a pack
icon shows Colors in this icon instead of the main and accent color fields, with Reset colors, and that switching its
kind to a built-in one brings the two fields back, that a big drawing's Add-panel thumbnail becomes a small picture, places an icon whose part was not
fetched yet, and checks the credit line, the SVG and the PowerPoint export.
Colorways (one icon for drawings of a pack that differ only in color): a made-up icon of the test pack with three colorways and the old keys of two merged drawings; `fig.iconColors` listing them and applying one (one undo step, redo), the colorway drawing the merged drawing as its library drew it (mean ΔE under 1 at 96 px), an unknown name refused, a group changed by hand leaving the colorway, a colorway whose groups look alike giving no color-check warning (the same colors set by hand do), `c1` / `c2` following a colorway applied before the drawing came (`cwSync`), the SVG export, a thumbnail and the PNG export with its colors; the side panel's row (named for screen readers, As made first, pressed state, one Tab stop, the line naming the colorway shown, every swatch different, a click as one undo step, the group swatches following, ← → Home End); an old key through `fig.add`, `fig.update`, paste (one recolored by hand keeps its old drawing), Duplicate copying an old key and a kept icon exactly, and a file without the drawing, a figure that embeds the old drawing unchanged; the search words and `cwQuery`, a drag from a search naming a colorway adding it in it, a merged drawing's own name ranking its icon first (`cwAlt`, 9.4); and, where `dev/icon-import/colorways.js` is there (the development copy), the detection finding the same drawing in other colors and neither another shape nor a duplicate, nor a pair listed in `cwApart` (another state). The shipped-pack test checks every `cw` (keys colors of the drawing, values colors, the same in `names.json`), every `alias` (an old key that is no icon, leading to a kept icon and one of its colorways), and that the drawings of another state (empty vs filled, a screen off, a lamp lit, another allele or nucleotide, a lab coat, a stained smear, another sugar, cell subtype or vesicle type, another ripeness or species, a fluorophore; the pairs it knows and, in the development copy, every `cwApart` pair of `dev/icon-import/packs/<id>.json`) are icons of their own: both keys icons, neither an old key, neither a colorway of the other.
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
keys (`fixed`) recolored by its groups. The Servier test also groups one of its shaded icons (under 60 ms; the time is
in its note with the largest drawing's and the panel's), recolors a third group with all its shades and resets it, and
checks the panel of a Servier icon with every pack imported. `dev/icon-import/color-groups.js` (private copy) is the
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

## The website's Home

One test named `home: the website starts on Home …` covers what only the website build (`-Editor dev/web/editor.html`) shows: a first visit
(nothing remembered) starts on Home → Figures with the welcome strip above the cards; its words (American spelling), the **Desktop version**
link (GitHub, a new tab, `rel=noopener`), the link shown and its **Copy** (an instruction for a coding agent naming the repository, its README
and AGENTS.md; the button says Copied), with a clipboard of the test's own (nothing reaches the real clipboard and no dialog opens); the
links under the sections (GitHub, About from `SiliCoDrawWeb.links`, the license); **More…** opening **Desktop & AI** with every part, every
link and what each Copy copies; ✕ folding the strip (remembered, still folded after a reload, the focus on Desktop & AI, the navigation
kept) and the section bringing it back; an example link opening the figure directly at a first visit; and on a phone the short strip,
buttons a finger can hit and nothing wider than the screen. In the desktop editor the same test checks that none of it exists, and the
test of where the plain address starts expects Home at a first visit on the website whatever the number of figures.

## The website offline

One test named `offline: …` covers the website's offline worker (`sw.js`, registered by the storage script). On the website build
it checks that the page carries its release id, that nothing is registered on localhost unasked (no `?sw=1`), then registers the
worker (`SiliCoDrawWeb.offline.register(true)`), which must become active with the editor's folder as its scope and keep the app
shell at once (the page, the storage script, the examples list, `notices/`, MathJax with mhchem, PptxGenJS and qrcode-generator;
no icon pack part and no figure or API answer). Before registering, it puts an older release's shell with one unchanged file
and a kept pack file this release no longer has into the caches: the file must be copied from the older shell (not fetched),
the older shell deleted and the stale pack file gone. Every kept copy carries the hash `sw.js` names for it; a shell file
deleted comes back on "fill"; a pack file handed over with `offline.keep` is kept (a file of another host is not), and
`offline.forget` deletes the pack's files. A page under the worker then loses the network (the worker's own stand-in, a
message it accepts only on localhost, so the server keeps running for the other tests) and is loaded again: it opens from the
kept copy, shows a figure stored in IndexedDB, cannot reach a file it never kept, saves an edit and has it after another
reload, and the folder's own address opens the kept editor too. With `navigator.onLine` false the status line says "· Offline"
(the phone layout: a hollow dot), its tooltip names what waits for a connection, and Import more icons says so; back online the note goes. A newer release taking over shows "A new version of SiliCoDraw is
ready" with Reload, the same release nothing. At the end the worker is unregistered and its caches are gone. In the desktop
editor the same test checks that there is no storage script, no registration, no controlling worker and no Offline note.

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
