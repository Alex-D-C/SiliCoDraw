# Inkscape Electric Symbols: attribution

**Source:** [Inkscape Electric Symbols](https://github.com/upb-lea/Inkscape_electric_Symbols), the symbol library that
the Power Electronics and Electrical Drives group (LEA) of Paderborn University publishes in its GitHub organization
`upb-lea`, at commit `9be09cd0e8fcff72816517f240eeff76cef807e2` (2026-02-08, branch master). The whole library is one
Inkscape sheet, `Inkscape_Symbols_All.svg`. The repository names no creator per symbol, so this pack names none; its
README says that requested symbols are redrawn by the maintainers ("We will then redraw the symbol, modify it if
necessary to fit with the other symbols, and add it to the library").

**License:** public domain, dedicated under CC0 1.0 Universal: the repository's LICENSE is the CC0 1.0 legal code, and
the sheet's own metadata says `dc:rights` CC0 with the license link http://creativecommons.org/publicdomain/zero/1.0/.
See `LICENSE.txt`.

**How the repository asks to be credited:** it does not ask. Its README (read on 2026-11-14) has no section on
licensing, citation or credit. So no credit is required, and SiliCoDraw adds no credit line for these symbols.
Page → Copy full icon credits gives a line for anyone who wants to mention the library: *Inkscape Electric Symbols,
Paderborn University LEA (github.com/upb-lea/Inkscape_electric_Symbols), CC0 1.0*.

**What SiliCoDraw changed:** the drawings were taken out of the one sheet with `dev/icon-import` (`sheet.ps1` /
`sheet.js`) and converted to SiliCoDraw's icon format (`convert.ps1`):

- each `<symbol>` of the sheet is one icon (149 of its 199 symbols), and 55 drawings of the sheet's drawing layer that
  are no symbols (instruments, electronic parts, computers, energy and buildings, toroids, waveforms, ladder-logic
  contacts and coils, a magnetic core and a B-H hysteresis curve) are icons too, each made of the elements of the sheet
  that lie inside a box SiliCoDraw chose for it (`packs/electric.json` in the development files);
- arrowheads (SVG markers) are drawn as shapes of their own, where the browser places them; compared with the sheet,
  every symbol with arrowheads came out the same (at most 0.04 % of the pixels differ);
- the letters and signs inside a symbol (V, A, M, G, +, −, &, ≥1, J, K, D, Q, S, R, abc, dq, αβ, LUT, MUX, DEMUX, s,
  1 kHz, 1 Vpp) are set as outlines in MathJax's sans-serif face (Greek letters in its math italic) instead of the
  sheet's live text, at the place the sheet puts them; the placeholder ratio of the two transformers (n:1, n:1:1) is
  left out;
- each drawing was fitted into a 100 × 100 box, its coordinates rounded and its colors made recolorable (the line
  color, black in nearly every symbol, is Color 1); every icon was drawn and compared with what it was converted from
  on a white and on a dark page, and all passed;
- names and groups are SiliCoDraw's, based on the titles the sheet gives its symbols ("Resistor_US" is "Resistor (US)",
  "Stransformer_YD" is "Transformer Yd", "Opener" is "Break contact"); the sheet's own title stays a search word.

**Left out:** the symbols the sheet has again in another size (two operational amplifiers, a transconductance
amplifier, twelve multiplexers and demultiplexers: one of each style is in the pack), turned (two MOSFETs with their
gate lead on the other side) or drawn a second time (four diodes, a Zener diode, an LED, an opto-isolator, an open
switch at a smaller angle, a plain circle beside the voltage source with its line, and five symbols that only wrap
the filled opto-isolator); eighteen plain symbols framed as blocks (a capacitor, battery, diode, valve, inductor,
transformer, switch, fuse or transistor in a square); the USB plug, which carries the USB trident logo; and the sheet's example circuits (converter
topologies, test circuits), labels, designators (R1, C1, …), font samples and instructions.

SiliCoDraw is not affiliated with or endorsed by Paderborn University or its LEA group.
