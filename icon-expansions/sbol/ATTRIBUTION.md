# SBOL Visual: attribution

**Source:** [SBOL Visual](https://github.com/SynBioDex/SBOL-visual), the glyphs of the Synthetic Biology Open Language's
visual standard, published by the SBOL developers (the SBOL community, SynBioDex) in the GitHub repository
[SynBioDex/SBOL-visual](https://github.com/SynBioDex/SBOL-visual) at commit
`f6b2f53a22105c768d376ecf68d67cc7f4516115` (2026-10-18, master, which holds the releases; the glyphs of SBOL Visual
3). The repository names no creator per glyph, so this pack names none. Only the GitHub repository was used: the
sbolstandard.org website states another license for its own content (CC BY-NC-ND 4.0), and nothing was taken from it.

**License:** CC0 1.0 Universal. The repository's `LICENSE.html` puts the repository under CC BY 4.0 "Except as noted
below", and the exception reads: "to the extent possible under law, the SBOL developers have waived all copyright and
related or neighboring rights to SBOL Visual glyphs." This pack holds those glyphs only, none of the specification text,
specification drawings or examples (which are under CC BY 4.0). See `LICENSE.txt`.

**How the repository asks to be credited:** it does not; neither `LICENSE.html` nor the README asks for credit. So
no credit is required, and SiliCoDraw adds no credit line for these glyphs. Page → Copy full icon credits gives a line
for anyone who wants to name the standard a figure follows: *SBOL Visual glyphs, the SBOL developers
(github.com/SynBioDex/SBOL-visual), CC0 1.0*.

**What SiliCoDraw changed:** the SVG files were converted to SiliCoDraw's icon format with `dev/icon-import`. Each
glyph was fitted into a 100 × 100 box by what it draws (the glyphs are drawn on a common 0.5 inch canvas to sit on a
DNA backbone line, which is not part of them; fitted one by one they no longer share one scale, and their lines are as
thick as the glyph's size makes them), its style sheet written out as attributes, the arrowhead of Origin of transfer
(an SVG marker) written out as a shape, its metadata removed, its coordinates rounded and its one color made
recolorable. Six glyphs are partly characters: the question mark of the replacement glyph (Unspecified), the brackets
of No glyph assigned, the ellipsis of Omitted detail, the AAA of the polyA site and the asterisks of the two stop
sites. An icon holds no text, so these characters were set as outlines in MathJax's sans-serif face (bold, as the
originals' Arial Bold), each fitted into the space the original character takes; the shapes of the letters differ a
little from Arial's (SBOL Visual itself notes that the asterisk's number of points follows the font). Two files (Double-
stranded nucleic acid and Blunt restriction site) have a view box of zero width, so a browser draws nothing of them as
published; they were converted by their width and height, which gives the glyphs the repository's specification
pictures show. The single-stranded nucleic acid is an open wave line that the file also fills white (the fill closes
the wave along its chord): invisible on a white page, a white patch on a dark one, so that fill was taken off. The white
interiors of Dissociation and of the Process node are part of those glyphs (they cover the lines behind them) and are
kept; on a dark page they show white (Colors in this icon changes them). Every glyph was drawn and compared with the
original on a white and on a dark page; all passed. Names
follow the glyph sets of the repository (each set's README), with the alternates named by what sets them apart
("CDS, block arrow", "Simple chemical, pentagon"); each set's SO and SBO terms are search words. The groups in the Add
panel are the repository's folders: sequence features, molecular species, interactions and interaction nodes.

**Left out:** the specification drawings (the glyphs again with their dimension guides) and the example drawings of
the glyph sets; the Deprecated folder (Insulator and an older Macromolecule); and five files that repeat a glyph of
another set: the replacement glyph filed under Molecular species and under Interaction nodes, No glyph assigned under
Molecular species, and the SBGN nucleic-acid shape under Double-stranded nucleic acid and under Unspecified sequence
feature. Each is in the pack once, and the other sets' names and terms find it. The 5′ and 3′ overhang sites and
sticky restriction sites are mirror images of each other but separate glyphs of the standard with their own terms, so
both are in the pack; so are glyphs of the standard that look alike once fitted into the box but mean different things
(Association, Simple chemical as a circle and Origin of replication are all rings; their names tell them apart).

SiliCoDraw is not affiliated with or endorsed by the SBOL developers.
