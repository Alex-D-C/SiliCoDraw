# Icon packs (icon expansions)

The folders here hold icons from open repositories, converted to SiliCoDraw's icon format. They are **third-party works
under their own licenses, not under SiliCoDraw's MIT license**. SiliCoDraw shows them only after you imported a pack
(Add panel → *Import more icons*), where each pack's terms are shown first.

| Folder | Repository | License | Credit |
|---|---|---|---|
| `scidraw/` | [SciDraw](https://scidraw.io) | CC BY 4.0 or CC0 1.0, per drawing | authors and DOI per CC BY drawing, SciDraw, the license and "adapted" |
| `biodraws/` | [BioDraws](https://biodraws.com) | CC BY-SA 4.0 | "Images are obtained from BioDraws.com", with the license and "adapted"; share-alike |
| `nih-bioart/` | [NIH BioArt Source](https://bioart.niaid.nih.gov) | public domain (the entries the site labels so), under the site's terms | not required; appreciated |

In every folder:

- `LICENSE.txt`: the license name and link, the repository's own terms as retrieved (with the date), and the full legal text
- `ATTRIBUTION.md`: who made the icons, how they ask to be credited in their own words (with the page it was read on),
  what SiliCoDraw changed, and the creator, DOI, license and page of every icon where the repository names them
- `pack.json`: the pack's description (what the editor shows before an import)
- `names.json`: every icon's name, search words, colors, credits and the part it is in
- `icons-<category>.json`: the drawings, in parts of at most a few MB
- `preview.json`: the icons of the preview in the Add panel

`index.json` lists the packs. All of this is written by the converter (`dev/icon-import/` in the development copy);
do not edit the files by hand.

What SiliCoDraw changed in every icon: fitted into a 100 × 100 box, style sheets written out as attributes, text,
metadata and editor data removed, coordinates rounded, and the two main colors made recolorable. Icons with embedded
pictures, icons that did not come out the same after conversion, very large ones and duplicates were left out, and so
were the repositories' own logos and drawings of identifiable real people.

SiliCoDraw is not affiliated with or endorsed by these repositories or by NIH (NIAID).
