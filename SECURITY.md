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

Please include what you did, what happened, and the version (the date in `updates/installed.txt`, or the commit).
You will get an answer as soon as I can; but this is a one-person project, can take some time.

