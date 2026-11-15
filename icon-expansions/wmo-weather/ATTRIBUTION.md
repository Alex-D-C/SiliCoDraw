# WMO WorldWeatherSymbols: attribution

**Source:** [WorldWeatherSymbols](https://github.com/OGCMetOceanDWG/WorldWeatherSymbols), "A complete set of WMO
weather symbols in SVG with full metadata", by the OGC Meteorology and Oceanography Domain Working Group (OGC MetOcean
DWG), at commit `1b907f04da74c6dfd89508bab119e330ffd2f7b0` (2024-06-25, version 0.8-dev). Each symbol's own metadata
names its creator, publisher and source: "WMO CBS IPET-DR&C", published by the WMO, after WMO-No. 485 (Manual on the
Global Data-processing and Forecasting System, Volume I, Part II, Section 4, Appendix II-4), for the WMO symbols; "WMO
CAeM", published by the WMO and ICAO, after WMO-No. 49 (Technical Regulations, Volume II, C.3.1, Appendix 1), for the
aviation significant-weather symbols; contributor Chris Little for both. The repository's history says its first
version was "copied from web, and completed with Inkscape", then redrawn to consistent coordinates; it names no other
source.

**License:** Creative Commons Attribution 4.0 International (CC BY 4.0). The repository's LICENSE.md: "Copyright (C)
2013-2021 OGC Meteorology and Oceanography Domain Working Group. This website is released under the Creative Commons
Attribution 4.0 International (CC BY 4.0) license." Every symbol file links CC BY 4.0 as its `cc:license`; its
`dc:rights` still reads "Creative Commons Attribution 3.0 Unported Licence", from before the maintainers moved the
files to 4.0 in 2022 (issue #42, pull request #43). See `LICENSE.txt`.

**How the repository asks to be credited:** it gives no wording of its own; its LICENSE.md names the license and the
copyright holder. SiliCoDraw puts this line on the page when you place one of these symbols:

> WorldWeatherSymbols, OGC MetOcean DWG and WMO (github.com/OGCMetOceanDWG/WorldWeatherSymbols), CC BY 4.0, adapted

It names the work, its makers as the repository and the files name them, where it is, the license, and that the
symbols were changed (CC BY asks for all of these). Keep it in the figure legend or on the figure.

**No endorsement:** the symbols follow the WMO's and ICAO's published symbol tables; this pack and SiliCoDraw are not
affiliated with or endorsed by the WMO, ICAO or the OGC. The names in this pack are SiliCoDraw's short forms of the
descriptions in the files, not official wording: the full description stays each icon's title and search words.

**What SiliCoDraw changed:** the SVG files were converted to SiliCoDraw's icon format with `dev/icon-import`. Each symbol
was fitted into a 100 × 100 box by what it draws (the symbols were drawn on one 55 × 55 grid; in the pack each fills its
own box, so a single dot and a whole thunderstorm symbol are the same size), its repeated parts (`use`) and arrowheads
(markers) written out as shapes, its styles written out as attributes, its metadata removed, its coordinates rounded and
its color made recolorable. Every symbol was drawn and compared with the original on a white and on a dark page; all
355 passed. Names are the WMO code and the description of the file's title ("ww 95: Thunderstorm, slight or moderate,
without hail, but with rain and/or snow"), "at time of observation" at its end left off and cut after a word with an ellipsis where it is longer than 72 characters (the title keeps the whole description), with the footnote marks
and the footnotes on hail (and their French) taken off, words written in capitals written as words, and a few typos of
the titles corrected ("og or ice fog", "rizzle and rain", "nimbostratusx"); the total cloud cover symbols are named by
their oktas, and the ICAO symbols, whose titles are empty, by their file names in words ("Mountain obscuration" for
the file `MoutainObscuration`). The groups in the Add panel follow the repository's folders (its code tables). A symbol
drawn exactly the same in several code tables (most of `wawa` repeat `ww`, and the ICAO weather and front symbols repeat
WMO ones) is in the pack once, under its first code in the order ww, W1W2, wawa, Wa1Wa2, w1w1, clouds, fronts, pressure,
wind, ground, ICAO; the other codes and descriptions are its search words. Seven more symbols are as good as such a copy (the same glyph drawn a second time with a hair of difference, or the same plain circle) and are kept once in the same way: w1w1 69a and 69b (ww 68 and 69), Wa1Wa2 7b (ww 79), wawa 92a and 92b (ww 95a and 95b), wawa 60 (ww 00) and the calm wind circle (N 0). Two editing remnants of the drawing program were taken out: an empty path that its round line cap drew as a stray dot (C 9, CH 2) and a hair of a stroke far outside the page (the tropical cyclones). A symbol that runs off its own 55 × 55 page in the file (the automatic station triangle, cut off at its corners and top, and the tropical cyclones, whose arms were cut off) is shown whole.

**Left out (186 of the 541 files):**

- 93 drawings that are exactly another code's symbol, and 7 that are as good as one (above);
- 53 Southern Hemisphere symbols, which are mirror images of the Northern Hemisphere ones: the 50 wind arrows, the ICAO
  jet-stream wind arrow and the two tropical cyclones (flip the icon in SiliCoDraw);
- 24 symbols of the additional present weather table (w1w1 50 to 77, the rates of fall of drizzle, rain and snow) whose
  meaning is a digit written as text: the conversion keeps no text;
- 7 plain lines more than 60 times as long as they are high (instability line, intertropical discontinuity, shear line,
  axis of trough, and the ICAO 0 °C isotherm, area of clear-air turbulence and jet stream axis), which a line or an arrow
  in SiliCoDraw draws better;
- 2 files that draw nothing as published: wawa "No significant weather observed" (an empty group) and E 9 ("Extremely
  dry with cracks", whose shapes, a letter D in a box, are outside the SVG namespace).

SiliCoDraw is not affiliated with or endorsed by the OGC, the WMO or ICAO.
