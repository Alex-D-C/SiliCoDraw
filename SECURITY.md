# Security

## Official downloads

SiliCoDraw is published **only** at [github.com/Alex-D-C/SiliCoDraw](https://github.com/Alex-D-C/SiliCoDraw)
(the source, the ZIP behind the green **Code** button, the one-line installer `install.sh` and the updater
`update.ps1` / `update.py`, which fetch from there) and runs as a website at [silicodraw.com](https://silicodraw.com).

**I never send executables (.exe, .msi, .dmg, .app, installers or ZIPs of them) by email or chat**, and there
is no SiliCoDraw desktop app to download. If someone sends you a program that claims to be SiliCoDraw, or a
"desktop version" of it, do not open it; please tell me (see below). SiliCoDraw itself is plain text you can
read: an HTML file, two small servers (`serve.py`, `serve.ps1`), start scripts, and libraries in `lib/` with
their licenses.

## Reporting a problem privately

If you find a security problem (for example a way for a web page or a crafted figure file to read or change files,
or a problem in the updater or installer), please report it privately, not in a public issue:

- Preferred: GitHub's private vulnerability reporting, the **Report a vulnerability** button under the repository's
  [Security tab](https://github.com/Alex-D-C/SiliCoDraw/security). Only I see the report.
- If that button is not there: open an issue that says only "security report, please contact me" (no details), and
  I will reply with a private way to send them.

Please include what you did, what happened, and the version (the date in `updates/installed.txt`, or the commit).
You will get an answer as soon as I can; this is a one-person project, so please allow a few days.
Please give me a reasonable time to fix the problem before you publish it.

## What SiliCoDraw does to stay safe

- The local server listens on this computer only (`localhost`) unless you start `serve.py --host` on purpose.
- It answers only requests addressed to this computer by name (a foreign `Host` is refused), and it accepts writes
  (saving, exports, moving or deleting figures, changing the figures folder, Quit) only from the editor's own page,
  `http://localhost:<its port>`, or from tools on your computer that send no browser origin. Pages on other sites
  and on other ports of your computer are refused.
- The libraries it loads on first use (MathJax, qrcode-generator, PptxGenJS) are shipped in `lib/`; when a copy is
  missing, the same version comes from a CDN pinned by its hash (`integrity`), so a changed file is refused.
- Imported pictures and icons pass a sanitizer before they are drawn, and figures are plain JSON.
