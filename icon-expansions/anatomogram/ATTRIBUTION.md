# Expression Atlas anatomograms: attribution

**Source:** [Expression Atlas Anatomogram](https://github.com/ebi-gene-expression-group/anatomogram), "an anatomogram
for Expression Atlas that we use to illustrate the experiments", by EMBL's European
Bioinformatics Institute (EMBL-EBI; its GitHub organization ebi-gene-expression-group), at commit `9fcc37022cce1e2862692a5f5fbfb78572b87e67` (2019-12-12, release 2.4.0),
folder `src/svg/`. The files name no individual illustrator; the outline of the male human body comes from "Human body
features" on Wikimedia Commons (<https://commons.wikimedia.org/wiki/File:Human_body_features.svg>), by Vsion, SVG by
Sjef, text by tsaitgaist (Kevin Redon), public domain: its Commons page releases it into the public domain, and the file in
the repository records CC0 1.0. The icon's credits name them.

**License:** Creative Commons Attribution 4.0 International (CC BY 4.0). The repository's README: "All images,
anatomograms and switcher icons, are distributed under the Creative Commons Attribution 4.0 International license"
(its code is under the Apache License 2.0 and is not part of this pack). The Expression Atlas licence page applies CC BY
4.0 to "all copyrightable material on our website. This includes the species anatomograms." See `LICENSE.txt`.

**How EMBL-EBI asks to be credited** (<https://www.ebi.ac.uk/gxa/licence.html>): anyone may copy, reuse, display and
distribute the images "provided you give us credit by citing":

> Expression Atlas in 2026: enabling FAIR and open expression data through community collaboration and integration
> (Nucleic Acids Research, 10 December 2025). doi:10.1093/nar/gkaf1238

SiliCoDraw puts this line on the page when you place one of these drawings:

> Anatomograms from Expression Atlas, EMBL-EBI (Expression Atlas in 2026, Nucleic Acids Research, doi:10.1093/nar/gkaf1238), CC BY 4.0, adapted

It names the work and its maker, the article EMBL-EBI asks you to cite, the license, and that the drawings were changed
(CC BY asks for all of these). Keep it on the figure or in its legend, and put the full citation in the reference list
or the acknowledgments.

**No endorsement:** this pack and SiliCoDraw are not affiliated with or endorsed by EMBL-EBI or Expression Atlas. The
EBI attribution logo of each file is not part of the pack.

**What SiliCoDraw changed:** each of the repository's anatomograms became one icon (`dev/icon-import`, `fetch.ps1 -Source
anatomogram`, then the converter):

- the small EBI attribution logo (a green mark linking the licence page) was taken out of every drawing;
- the tissue shapes, which the files draw invisible ("fill:none; stroke:none") for the Expression Atlas web page to
  color, were filled with one light red (#e0544a at 45 % opacity) and put under the outline, so that the organs show and
  the outline stays on top; recolor them in SiliCoDraw like any icon color;
- tissues that spread over the whole body were left unfilled, so the organs stay readable: skin, skeletal muscle, fat
  (adipose tissue), bone, bone marrow, cartilage, smooth muscle, blood, blood vessels, the aorta, coronary and other arteries, nerves and
  the peripheral nervous system, lymph nodes, leukocytes, the femur, hind limb and quadriceps, the intestinal mucosa, the
  pleura, the meninges and dura mater, the breast, the diaphragm and the spinal cord; and a tissue drawn a second time
  under another ontology id (a `use` copy) is filled once;
- the drawings were fitted into a 100 × 100 box by what they draw, their styles written out as attributes, their metadata
  removed, their coordinates rounded (at most 0.03 of the box off), and the outline gray and the tissue red made the two
  recolorable colors (the green anole's three small tissues cover too little of it for a color field of their own: they
  are recolored by their color group in the side panel). Each icon was drawn and compared with the adapted drawing on a white and on a dark page; all passed.

Names are SiliCoDraw's: the common name and the species ("Mouse, female (Mus musculus)"; the views "brain", "whole
plant", "flower parts" as in the file names). The names of the tissues each drawing holds (its `title`s, from Uberon,
EFO and the Plant Ontology) are its search words. Groups: Human, Animals, Plants (whole plants), Plant parts (the
flower, fruit and grain views).

**Left out (3 of the 31 files):** three drawings that are over 700 KB each even after conversion, because of their very
fine line work: the potato plant (*Solanum tuberosum*, 948 KB, a drawing without tissue shapes), the whole plant of
purple false brome (*Brachypodium distachyon*, 983 KB) and the sorghum flower parts (*Sorghum bicolor*, 874 KB). A
figure carries every icon it uses, so each of them would add about a megabyte to every figure file that shows it.

SiliCoDraw is not affiliated with or endorsed by EMBL-EBI.
