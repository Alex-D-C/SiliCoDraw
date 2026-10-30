# SiliCoDraw tests

Two kinds of tests run on every push to GitHub (`.github/workflows/test.yml`, results in the repository's **Actions** tab)
on macOS, Linux and Windows; the browser tests run in Chrome / Edge everywhere, in Firefox on Linux and Windows, and in
Safari on macOS. You can run them on your own computer too; each prints one line per check and ends with exit code 0 when
everything passed.

| Script | What it checks | Needs |
|---|---|---|
| `smoke.sh` / `smoke.ps1` | the server (page, save, 304 for an unchanged figure, history, file list, refusal of writes from other websites), the first-start setup and installer (macOS / Linux), the updater's dry run | Python 3.7+ (macOS / Linux); nothing on Windows |
| `browser.sh` / `browser.ps1` | the editor itself, in a headless browser: every element type (add, draw, side panel, bounds), every icon, every example (loads; SVG, PNG, PDF and PowerPoint export), TIFF export and import, copy as picture / paste from clipboard (with the clipboard stubbed), undo/redo, connectors, elements parked off the page, colors (chart series, ink on dark pages, the color check, recoloring), rich-text parsing, repairing broken files, `fig` API errors, and a save → reload round trip | Chrome, Chromium, Edge, Firefox or Safari; Python 3 on macOS / Linux |

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
example). They work on a scratch figure called `zz-test-….json`, which is removed at the end.

Options for the browser tests:

| `browser.sh` | `browser.ps1` | |
|---|---|---|
| `--only icons,examples` | `-Only icons,examples` | only the tests whose names start with these words |
| `--show` | `-Show` | a visible browser window instead of headless |
| `--timeout 600` | `-Timeout 600` | give up after this many seconds (default 1800) |
| `--browser firefox` | `-Browser firefox` | Firefox (headless, with a fresh profile of its own; your open Firefox windows are not touched) |
| `--browser safari` | | Safari on macOS, through `safaridriver`: it opens a separate automation window (Safari has no headless mode). Turn it on once: Safari → Settings → Advanced → Show features for web developers, then Develop → Allow Remote Automation (or `sudo safaridriver --enable`) |
| `SILICODRAW_BROWSER=/path/to/chrome` | `-Browser C:\path\to\msedge.exe` | use this browser: a path, or `chrome` / `edge` / `firefox` (default: Chrome, then Chromium, then Edge on macOS / Linux; Edge, then Chrome, then Firefox on Windows) |

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
