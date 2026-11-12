# SiliCoDraw app icon

The icon is the periodic-table cell of silicon (14, Si, 28.085) with the **Co** mark as its symbol: a white C and an
artist's palette as the "o", whose thumb hole is the letter's counter. Every letter and numeral is drawn as outlines:
the SVG files use no fonts, no text, no masks and no external references.

| File | For |
|---|---|
| `icon.svg` | the master, on its tile (128 px and up) |
| `icon-small.svg` | 16–64 px: only the Co mark, larger (browser tabs, the editor's top bar) |
| `icon-macos.svg` | macOS: Apple's grid (the tile 824 of 1024 px, centered, with a soft shadow) |
| `mark.svg` / `mark-dark.svg` | the Co mark alone, transparent, for light / dark backgrounds |
| `lockup.svg` / `lockup-dark.svg` | small tile and the "SiliCoDraw" wordmark side by side, for light / dark backgrounds |
| `icon-16.png` … `icon-1024.png` | the icon at 16, 32, 48, 64 (small mark), 128, 192, 256, 512 and 1024 px |
| `icon-180.png` | `apple-touch-icon` (iPhone and iPad home screens): square, the system rounds the corners |
| `icon.ico` | Windows (16, 24, 32, 48, 64 and 256 px). For a shortcut to SiliCoDraw: right-click it → Properties → Change Icon… → Browse… → this file |
| `SiliCoDraw.icns` | macOS (16 to 1024 px); the Mac app made by `start.sh` uses it |
| `social-preview.png` | 1280 × 640 link preview (GitHub: Settings → Social preview; websites: `og:image`) |

The editor carries `icon-small.svg` inside its page (top bar, Home, and the tab icon), so it needs none of these files to run.

**Colors:** tile gradient `#1d4ed8` → `#6d28d9` (top left to bottom right), letters `#ffffff`, palette and the "Co" of
the name `#f4e7c5`, paint dots Okabe–Ito `#d55e00` `#e69f00` `#009e73` `#0072b2` `#cc79a7`. Wordmark on light
backgrounds `#1f2328` with "Co" in `#4338ca`, on dark ones `#eef0f6` with "Co" in `#f4e7c5`.

**Minimum sizes:** `icon.svg` from 128 px (below that its name line and numbers blur), `icon-small.svg` down to 16 px,
the lockup from 24 px high.

**License:** the icon is SiliCoDraw's own and is under the same license as the rest of the project (see `LICENSE`).
Please do not use it to suggest that something else is SiliCoDraw or is endorsed by it.
