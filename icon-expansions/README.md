# Icon packs (icon expansions)

The folders here hold icons from open repositories, converted to SiliCoDraw's icon format. They are **third-party works
under their own licenses, not under SiliCoDraw's MIT license**. SiliCoDraw shows them only after you imported a pack
(Add panel → *Import more icons*), where each pack's terms are shown first.

| Folder | Repository | License | Credit |
|---|---|---|---|
| `scidraw/` | [SciDraw](https://scidraw.io) | CC BY 4.0 or CC0 1.0, per drawing | authors and DOI per CC BY drawing, SciDraw, the license and "adapted" |
| `biodraws/` | [BioDraws](https://biodraws.com) | CC BY-SA 4.0 | "Images are obtained from BioDraws.com", with the license and "adapted"; share-alike |
| `nih-bioart/` | [NIH BioArt Source](https://bioart.niaid.nih.gov) | public domain (the entries the site labels so), under the site's terms | not required; appreciated |
| `arcadia/` | [Arcadia Science](https://arcadia-science.github.io/organism-illustration-library/), Free organism illustration library | CC0 1.0 | not required; a citation of the library is appreciated |
| `reactome/` | [Reactome Icon Library](https://reactome.org/icon-lib) (from Reactome's GitHub repository) | CC BY 4.0 | name and designer per icon, the Reactome Icon Library, the license and "adapted" |
| `bioicons/` | [Bioicons](https://bioicons.com) (from its GitHub repository) | CC0 1.0, CC BY 4.0, CC BY-SA 4.0 or MIT, per icon | name, creator and license per icon (all but CC0), Bioicons and "adapted"; the CC BY-SA icons are share-alike |
| `phylopic/` | [PhyloPic](https://www.phylopic.org) (from its public API) | Public Domain Mark, CC0 1.0, CC BY 3.0 or CC BY 4.0, per icon | taxon, creator and license per CC BY icon, PhyloPic and "adapted"; public domain and CC0 need none |
| `healthicons/` | [Health Icons](https://healthicons.org) (from its GitHub repository) | CC0 1.0 | not required |
| `ocha/` | [OCHA Humanitarian Icons](https://un-ocha.github.io/humanitarian-icons/) (from OCHA's GitHub repository) | public domain (CC0 1.0) | not required; OCHA appreciates a credit where feasible |
| `electric/` | [Inkscape Electric Symbols](https://github.com/upb-lea/Inkscape_electric_Symbols) (Paderborn University LEA; from its GitHub repository, taken out of its one symbol sheet) | public domain (CC0 1.0) | not required |
| `wmo-weather/` | [WMO WorldWeatherSymbols](https://github.com/OGCMetOceanDWG/WorldWeatherSymbols) (OGC MetOcean DWG; from its GitHub repository) | CC BY 4.0 | one line for the pack: "WorldWeatherSymbols, OGC MetOcean DWG and WMO (github.com/OGCMetOceanDWG/WorldWeatherSymbols), CC BY 4.0, adapted" |
| `sbol/` | [SBOL Visual](https://github.com/SynBioDex/SBOL-visual) (the SBOL developers; the glyphs from its GitHub repository, not from sbolstandard.org) | CC0 1.0 (the glyphs; the rest of that repository is CC BY 4.0) | not required |
| `opencrop/` | [Open Crop Icons](https://github.com/openfarmcc/open-crop-icons) (OpenFarm contributors; from its GitHub repository) | public domain (CC0 1.0) | not required; a credit is welcome ("would be in good spirit") |
| `anatomogram/` | [Expression Atlas anatomograms](https://github.com/ebi-gene-expression-group/anatomogram) (EMBL-EBI; from its GitHub repository) | CC BY 4.0 (the outline of the male body: public domain, from Wikimedia Commons) | one line for the pack, citing the article EMBL-EBI asks for: "Anatomograms from Expression Atlas, EMBL-EBI (Expression Atlas in 2026, Nucleic Acids Research, doi:10.1093/nar/gkaf1238), CC BY 4.0, adapted" |
| `servier/` | [Servier Medical Art](https://smart.servier.com) (from its PowerPoint kits) | CC BY 4.0 | "Images adapted from Servier Medical Art (https://smart.servier.com/), licensed under CC BY 4.0", with the license link |

In every folder:

- `LICENSE.txt`: the license name and link, the repository's own terms as retrieved (with the date), and the full legal text
- `ATTRIBUTION.md`: who made the icons, how they ask to be credited in their own words (with the page it was read on),
  what SiliCoDraw changed, and the creator, DOI, license and page of every icon where the repository names them
- `pack.json`: the pack's description (what the editor shows before an import), with the fields it serves (`fields`:
  `life`, `medicine`, `ecology`, `earth`, `engineering`), by which the Add panel's list of packs is filtered
- `names.json`: every icon's name, search words, colors, credits and the part it is in, and (`alias`) the old keys of drawings that are now colorways of another icon
- `icons-<category>.json`: the drawings, in parts of at most a few MB
- `preview.json`: the icons of the preview in the Add panel

`index.json` lists the packs. All of this is written by the converter (`dev/icon-import/` in the development copy);
do not edit the files by hand.

What SiliCoDraw changed in every icon: fitted into a 100 × 100 box, style sheets written out as attributes, text,
metadata and editor data removed, coordinates rounded, and the two main colors made recolorable. Icons with embedded
pictures, icons that did not come out the same after conversion, very large ones and duplicates were left out, and so
were the repositories' own logos and drawings of identifiable real people. The Inkscape Electric Symbols were taken
out of the repository's one sheet drawing by drawing; their arrowheads are drawn as shapes and the letters and signs
inside a symbol (V, A, M, +, &, abc/dq) are set as outlines instead of being removed. The WMO WorldWeatherSymbols keep their
arrowheads, drawn as shapes; a symbol that several WMO code tables repeat is in the pack once, and the Southern
Hemisphere symbols, mirror images of the Northern ones, are left out (flip the icon). The SBOL Visual glyphs whose meaning is a character (the ? of the replacement glyph, the AAA of the polyA site, the asterisk of the stop sites) have it set as outlines in another sans-serif face, and two files whose view box is zero wide (they draw nothing in a browser as published) were converted by their width and height. Open Crop Icons has some crops in several colors drawn the same (carrots, onions, beans): each such drawing is in the pack once, and the names of its other colors find it; a pepper of another ripeness or a mushroom of another species drawn the same is an icon of its own. The Expression Atlas anatomograms draw their tissues invisible (the Atlas web page colors them): in the pack the tissues are filled with one light red under the outline, those spread over the whole body (skin, muscle, fat, bone, vessels, nerves) left unfilled, and the small EBI attribution logo of each drawing is taken out. Drawings of one repository that are the same shapes in other colors (NIH BioArt Source's outlines in six skin tones and its lab mouse in gray and white, Bioicons' database in light blue and white, BioDraws' 24-well plate with pink and with light blue medium, Open Crop Icons' Rainier and Bing cherries, Servier Medical Art's animals, receptors and channels in several colors) are one icon with **colorways**: its other colors as named presets of its color groups (`cw` in the icon), each checked to draw the original drawing again; the old names find the icon, and figures that used an old icon still draw it. A drawing that shows another state or meaning of a thing (a flask or a plate empty and filled, a screen on and off, another allele, nucleotide or sugar, a stained smear, another cell subtype or vesicle type, a person with and without a lab coat, a bell pepper green or ripe, a fluorescent bead whose color is its label) is never a colorway: it stays an icon of its own.

SiliCoDraw is not affiliated with or endorsed by these repositories or by NIH (NIAID), Arcadia Science, Servier, Reactome, Resolve to Save Lives, OCHA or the United Nations, Paderborn University, the WMO, ICAO or the OGC, the SBOL developers, OpenFarm, EMBL-EBI, or the creators of Bioicons, PhyloPic, Health Icons and Open Crop Icons. The Servier Medical Art
icons were drawn from the vector shapes of its PowerPoint kits (Servier offers no SVG files) and keep its shaded style;
drawings that are only raster pictures in the kits are not in the pack.
