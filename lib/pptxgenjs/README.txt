PptxGenJS 3.12.0 by Brent Ely (https://github.com/gitbrent/PptxGenJS), MIT License (see LICENSE in this folder).
pptxgen.bundle.js is an unchanged copy of dist/pptxgen.bundle.js from the npm package pptxgenjs@3.12.0
(https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js; the same bytes on unpkg.com; SHA-256 as the npm
package lists it: zQeMqekcb54GHuCjwxDW/xV8OnGx3qf0D9U4GAFyZv8=). The bundle includes JSZip 3.5.0 (Stuart Knightley and
others, dual licensed MIT or GPLv3: used under the MIT license, LICENSE-jszip.md) and JSZip's own small dependencies: pako
(MIT, LICENSE-pako) and the small MIT-licensed helpers JSZip's own browser build includes.
SiliCoDraw loads this copy first, so the PowerPoint export works without internet, and falls back to that CDN address when
the folder is missing, pinned by the SHA-384 of this same file (LIB_PPTX in figure-editor.html):
sha384-Cck14aA9cifjYolcnjebXRfWGkz5ltHMBiG4px/j8GS+xQcb7OhNQWZYyWjQ+UwQ
A new version: replace the file, and the address and the hash in LIB_PPTX (the browser test "libraries" checks that they agree).
