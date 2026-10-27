#!/usr/bin/env python3
"""Update SiliCoDraw to the latest version from GitHub (Windows, macOS, Linux).

    python3 update.py            # download the latest version and replace the software files (asks first)
    python3 update.py --check    # only show what would change
    python3 update.py --yes      # do not ask (for scripts and AI assistants)
    python3 update.py --pause    # wait for Enter at the end (used by the double-click launchers)

What it does, in this order, and only after you confirm:
  1. downloads the current main branch of https://github.com/Alex-D-C/SiliCoDraw as a ZIP and checks it,
  2. puts a copy of your figures (*.json here, assets/, archive/) in updates/figures-backup-<date>.zip,
  3. writes every changed software file to a staging folder first, then keeps the old version of each in
     updates/backup-<date>/ and swaps the new files in; if anything goes wrong (or you press Ctrl+C) the
     files already swapped are put back, so the folder is never left half-updated.
What it never touches: your figures, history/, exports/, assets/, archive/, trash/, updates/, .git/.
Needs only Python 3 and an internet connection. Windows without Python: "Update SiliCoDraw.bat" runs
update.ps1 instead, which does the same.
"""
import sys
if sys.version_info < (3, 6):
    sys.exit('The updater needs Python 3.6 or newer. Get it from https://www.python.org/downloads/')
import argparse, getpass, io, json, os, platform, shutil, stat, subprocess, time, traceback
import urllib.parse, urllib.request, webbrowser, zipfile
from datetime import datetime

REPO = 'Alex-D-C/SiliCoDraw'
BRANCH = 'main'
ROOT = os.path.dirname(os.path.abspath(__file__))
UPD = os.path.join(ROOT, 'updates')
JOURNAL = os.path.join(UPD, 'in-progress.json')
PROTECTED_DIRS = ('history', 'exports', 'assets', 'archive', 'trash', 'updates', '.git')
KEEP_SOFTWARE_BACKUPS = 5          # the backup made by the current run is never removed; figure backups are never removed
EXEC_FILES = ('.sh', '.command', 'serve.py', 'update.py')   # made executable on macOS / Linux
ISSUES = 'https://github.com/%s/issues' % REPO

NOTICE = """
  PLEASE READ: this updater is new and has not been tested by its author yet.
  If something goes wrong, files in this folder could be damaged.
  Before you continue:
    1. Save your work and close SiliCoDraw (the browser tab and the server window).
    2. Copy your figures (the .json files in this folder, and the assets folder)
       to a separate place, such as another folder or a USB stick.
  The updater also puts a copy of your figures in the "updates" folder first.
  Afterwards, please tell us whether it worked:
    %s
""" % ISSUES


class Stop(Exception):
    """An expected problem: the message is shown as it is, without a traceback."""


def say(s=''):
    try:
        print(s)
    except UnicodeEncodeError:                     # e.g. a Windows console or a pipe with a narrow code page
        print(s.encode('ascii', 'replace').decode('ascii'))
    sys.stdout.flush()


def interactive():
    try:
        return sys.stdin is not None and sys.stdin.isatty()
    except Exception:
        return False


def ask(prompt):
    try:
        return input(prompt)
    except (EOFError, KeyboardInterrupt):
        return ''


def protected(rel):
    """True for paths (with / separators) that belong to the user, not to the software. Case-insensitive,
    because macOS and Windows file systems are."""
    low = rel.lower()
    return low.split('/', 1)[0] in PROTECTED_DIRS or ('/' not in low and low.endswith('.json'))


def safe_parts(rel):
    """The path parts of a ZIP entry, or None if it could write outside this folder."""
    if not rel or '\\' in rel or ':' in rel or rel.startswith('/'):
        return None
    parts = rel.split('/')
    if '' in parts or '..' in parts or '.' in parts:
        return None
    return parts


def fetch(url, timeout=120):
    """Download url. Python's own HTTPS first; if that fails (python.org Python on a Mac often has no root
    certificates until 'Install Certificates.command' is run), the system's curl, which uses the computer's own
    certificate store and ships with macOS, Windows 10+ and most Linux systems."""
    first = None
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'SiliCoDraw-updater'})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read()
    except Exception as e:
        first = e
    curl = shutil.which('curl') or shutil.which('curl.exe')
    if curl:
        try:
            p = subprocess.run([curl, '-fsSL', '--retry', '2', '--max-time', str(timeout), '-A', 'SiliCoDraw-updater', url],
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout + 30)
            if p.returncode == 0 and p.stdout:
                return p.stdout
            first = '%s; curl: %s' % (first, p.stderr.decode('utf-8', 'replace').strip() or 'exit %d' % p.returncode)
        except Exception as e:
            first = '%s; curl: %s' % (first, e)
    msg = 'Could not download the latest version: %s' % first
    if 'CERTIFICATE_VERIFY_FAILED' in str(first):
        msg += ('\nYour Python cannot check web certificates. On a Mac: open the Applications folder, then the Python 3.x'
                ' folder, double-click "Install Certificates.command", and run the update again.')
    else:
        msg += '\nCheck your internet connection and try again.'
    raise Stop(msg + '\nNothing was changed.')


def make_exec_and_unquarantine():
    """Launchers must be executable (a GitHub ZIP of web-uploaded files has no executable bits) and, on a Mac,
    not quarantined, or a double-click is refused."""
    if os.name == 'nt':
        return
    for n in os.listdir(ROOT):
        p = os.path.join(ROOT, n)
        if os.path.isfile(p) and n.endswith(EXEC_FILES):
            try:
                os.chmod(p, os.stat(p).st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
            except OSError:
                pass
    if sys.platform == 'darwin' and shutil.which('xattr'):
        subprocess.run(['xattr', '-dr', 'com.apple.quarantine', ROOT], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def backup_figures(stamp):
    """Zip the user's figures (root *.json), assets/ and archive/ into updates/figures-backup-<stamp>.zip."""
    path = os.path.join(UPD, 'figures-backup-%s.zip' % stamp)
    n = 0
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z:
        for name in sorted(os.listdir(ROOT)):
            p = os.path.join(ROOT, name)
            if os.path.isfile(p) and name.lower().endswith('.json'):
                z.write(p, name)
                n += 1
        for d in ('assets', 'archive'):
            base = os.path.join(ROOT, d)
            for dirpath, _dirs, files in os.walk(base):
                for f in files:
                    p = os.path.join(dirpath, f)
                    z.write(p, os.path.relpath(p, ROOT).replace(os.sep, '/'))
                    n += 1
    return path, n


def restore(journal, quiet=False):
    """Undo a partly applied update described by the journal: put back every replaced file, remove new ones."""
    bdir = os.path.join(UPD, journal['backup'])
    for rel in journal.get('applied', []):
        dst = os.path.join(ROOT, *rel.split('/'))
        bak = os.path.join(bdir, *rel.split('/'))
        try:
            if os.path.isfile(bak):
                shutil.copy2(bak, dst)
            elif rel in journal.get('new', []) and os.path.isfile(dst):
                os.remove(dst)
        except OSError as e:
            if not quiet:
                say('  could not restore %s: %s' % (rel, e))


def write_journal(j):
    tmp = JOURNAL + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(j, f)
    os.replace(tmp, JOURNAL)


def replace_with_retry(src, dst):
    for i in range(6):                               # Windows: antivirus or a sync tool may hold the file for a moment
        try:
            os.replace(src, dst)
            return
        except PermissionError:
            if i == 5:
                raise
            time.sleep(0.5)


def installed_commit():
    try:
        with open(os.path.join(UPD, 'installed.txt')) as f:
            for line in f:
                if line.startswith('source:'):
                    return line.split('commit', 1)[1].split()[0]
    except Exception:
        pass
    return 'unknown'


def os_name():
    s = platform.system()
    if s == 'Darwin':
        return 'macOS %s (%s)' % (platform.mac_ver()[0] or '?', platform.machine())
    if s == 'Windows':
        return 'Windows %s (%s)' % (platform.version(), platform.machine())
    return '%s %s (%s)' % (s, platform.release(), platform.machine())


def sanitize(s):
    s = str(s)
    for secret, label in ((ROOT, '<folder>'), (os.path.expanduser('~'), '~')):
        if secret and len(secret) > 2:
            s = s.replace(secret, label)
    try:
        u = getpass.getuser()
        if u and len(u) > 2:
            s = s.replace(u, '<user>')
    except Exception:
        pass
    return s


def report_url(st):
    res = st.get('result', 'failed')
    title = 'Update report: %s (%s, update.py)' % (res, os_name().split(' (')[0])
    lines = ['Result: ' + res,
             'OS: ' + os_name(),
             'Method: update.py' + (' (double-click launcher)' if st.get('pause') else ''),
             'Python: ' + platform.python_version(),
             'Files: %d updated, %d new' % (st.get('changed', 0), st.get('new', 0)),
             'Version: %s -> %s' % (st.get('old', 'unknown'), st.get('commit', 'unknown'))]
    if st.get('error'):
        lines.append('Error: ' + sanitize(st['error'])[:300])
    lines += ['', 'What happened (optional):', '']
    return '%s/new?title=%s&body=%s' % (ISSUES, urllib.parse.quote(title, safe=''), urllib.parse.quote('\n'.join(lines), safe=''))


def recover_interrupted():
    """A previous run stopped in the middle of swapping files (power cut, crash): put the old files back."""
    if not os.path.isfile(JOURNAL):
        return
    try:
        with open(JOURNAL) as f:
            j = json.load(f)
    except Exception:
        return
    say('A previous update was interrupted. Restoring the previous version from updates/%s ...' % j.get('backup', '?'))
    restore(j)
    os.remove(JOURNAL)
    say('Restored. Now updating again.\n')


def run(a, st):
    say('SiliCoDraw updater')
    say('  folder: %s' % ROOT)
    say('  source: https://github.com/%s (%s)' % (a.repo, a.branch))
    if os.path.isdir(os.path.join(ROOT, '.git')) and not a.force:
        st['result'] = 'not started'
        raise Stop('This folder is a git clone: update it with "git pull" instead (or run again with --force).')
    if not a.check:
        say(NOTICE)
        if not a.yes:
            if not interactive():
                st['result'] = 'not started'
                raise Stop('Not running in a terminal window, so nothing was changed. Run again with --yes to update without asking.')
            if ask('  Type Y and press Enter to continue (just Enter cancels): ').strip().lower() not in ('y', 'yes'):
                st['result'] = 'cancelled'
                say('Cancelled. Nothing was changed.')
                return 0
        try:                                            # can we write here at all? (read-only folder, macOS privacy block)
            os.makedirs(UPD, exist_ok=True)
            with open(os.path.join(UPD, '.write-test'), 'w') as f:
                f.write('ok')
            os.remove(os.path.join(UPD, '.write-test'))
        except OSError as e:
            hint = ('\nmacOS may be blocking Terminal from this folder: System Settings > Privacy & Security > Files and Folders'
                    ' > Terminal, allow access, then try again. Or move the SiliCoDraw folder into your home folder.'
                    if sys.platform == 'darwin' else '\nMove the SiliCoDraw folder to your Documents folder (not inside the ZIP, not a read-only drive) and try again.')
            raise Stop('This folder cannot be written (%s).%s\nNothing was changed.' % (e, hint))
        recover_interrupted()
    st['old'] = installed_commit()
    say('Downloading...')
    data = fetch(os.environ.get('SILICODRAW_ZIP_URL') or 'https://github.com/%s/archive/refs/heads/%s.zip' % (a.repo, a.branch))   # the variable is for tests
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
        broken = z.testzip()
    except zipfile.BadZipFile:
        raise Stop('The download is not a valid ZIP file. Try again later. Nothing was changed.')
    if broken:
        raise Stop('The download is damaged (%s). Try again later. Nothing was changed.' % broken)
    st['commit'] = (z.comment or b'').decode('ascii', 'ignore').strip()[:10] or 'unknown'   # GitHub puts the commit id there
    infos = [i for i in z.infolist() if not i.filename.endswith('/')]
    if not infos:
        raise Stop('The download was empty. Nothing was changed.')
    top = infos[0].filename.split('/', 1)[0]           # GitHub puts everything in <repo>-<branch>/
    editor = next((i for i in infos if i.filename == top + '/figure-editor.html'), None)
    if not editor or editor.file_size < 100000:
        raise Stop('The download does not contain the editor; it may be incomplete. Try again later. Nothing was changed.')
    plan, skipped = [], 0                                # (rel, parts, body, existed)
    for info in infos:
        if not info.filename.startswith(top + '/'):
            continue
        rel = info.filename[len(top) + 1:]
        parts = safe_parts(rel)
        if parts is None or ((info.external_attr >> 16) & 0o170000) == 0o120000:   # unsafe name or a symlink
            continue
        if protected(rel):
            skipped += 1
            continue
        body = z.read(info)
        dst = os.path.join(ROOT, *parts)
        if os.path.isfile(dst):
            with open(dst, 'rb') as f:
                if f.read() == body:
                    continue
            plan.append((rel, parts, body, True))
        else:
            plan.append((rel, parts, body, False))
    changed = [p[0] for p in plan if p[3]]
    new = [p[0] for p in plan if not p[3]]
    st['changed'], st['new'] = len(changed), len(new)
    if a.check:
        st['result'] = 'checked'
        if not plan:
            say('SiliCoDraw is up to date.')
        else:
            say('%d file(s) would be updated:' % len(plan))
            for r in changed:
                say('  updated  ' + r)
            for r in new:
                say('  new      ' + r)
        return 0
    if not plan:
        make_exec_and_unquarantine()
        st['result'] = 'already up to date'
        say('SiliCoDraw is already up to date. Nothing was changed.')
        return 0

    stamp = datetime.now().strftime('%Y-%m-%d_%H-%M-%S')
    fb, n = backup_figures(stamp)
    say('A copy of your figures (%d files) is in updates/%s' % (n, os.path.basename(fb)))
    sdir = os.path.join(UPD, 'staging-' + stamp)
    bdir_name = 'backup-' + stamp
    bdir = os.path.join(UPD, bdir_name)
    for rel, parts, body, existed in plan:                 # phase 1: write everything next to the folder first
        p = os.path.join(sdir, *parts)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, 'wb') as f:
            f.write(body)
        if existed:                                        # and keep the current version of every file to be replaced
            b = os.path.join(bdir, *parts)
            os.makedirs(os.path.dirname(b), exist_ok=True)
            shutil.copy2(os.path.join(ROOT, *parts), b)
    journal = {'backup': bdir_name, 'new': new, 'applied': []}
    write_journal(journal)
    try:                                                   # phase 2: swap the files in, remembering each one
        for rel, parts, body, existed in plan:
            dst = os.path.join(ROOT, *parts)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            journal['applied'].append(rel)
            write_journal(journal)
            replace_with_retry(os.path.join(sdir, *parts), dst)
    except BaseException as e:
        say('\nThe update stopped part-way (%s). Putting the previous files back...' % (e.__class__.__name__ if isinstance(e, KeyboardInterrupt) else e))
        restore(journal)
        os.remove(JOURNAL)
        shutil.rmtree(sdir, ignore_errors=True)
        st['result'] = 'failed, previous version restored'
        st['error'] = 'interrupted' if isinstance(e, KeyboardInterrupt) else repr(e)
        raise Stop('The previous version was restored; your figures were not touched.')
    os.remove(JOURNAL)
    shutil.rmtree(sdir, ignore_errors=True)
    make_exec_and_unquarantine()
    with open(os.path.join(UPD, 'installed.txt'), 'w') as f:
        f.write('updated: %s\nsource: https://github.com/%s commit %s\n' % (datetime.now().strftime('%Y-%m-%d %H:%M'), a.repo, st['commit']))
    st['result'] = 'success'
    say('Updated %d file(s), added %d:' % (len(changed), len(new)))
    for r in changed:
        say('  updated  ' + r)
    for r in new:
        say('  new      ' + r)
    if changed:
        say('The previous versions are kept in updates/%s/' % bdir_name)
    say('Your figures, history, exports and assets were not touched.')
    say('If SiliCoDraw is open: close the server window, start it again and reload the browser page.')
    if skipped:
        say('(%d file(s) in the download were skipped because they would overwrite your data.)' % skipped)
    try:                                                   # keep the newest software backups (by date written, not by name)
        olds = [d for d in os.listdir(UPD) if d.startswith('backup-') and d != bdir_name and os.path.isdir(os.path.join(UPD, d))]
        olds.sort(key=lambda d: os.path.getmtime(os.path.join(UPD, d)))
        for d in olds[:max(0, len(olds) - (KEEP_SOFTWARE_BACKUPS - 1))]:
            shutil.rmtree(os.path.join(UPD, d), ignore_errors=True)
    except OSError:
        pass
    return 0


def main():
    ap = argparse.ArgumentParser(description='Update SiliCoDraw from GitHub')
    ap.add_argument('--check', action='store_true', help='only show what would change')
    ap.add_argument('--yes', action='store_true', help='do not ask for confirmation')
    ap.add_argument('--pause', action='store_true', help='wait for Enter before closing')
    ap.add_argument('--force', action='store_true', help='update even if this folder is a git clone')
    ap.add_argument('--repo', default=REPO, help='GitHub repository (default %s)' % REPO)
    ap.add_argument('--branch', default=BRANCH, help='branch (default %s)' % BRANCH)
    a = ap.parse_args()
    st = {'pause': a.pause}
    try:
        code = run(a, st)
    except Stop as e:
        say('\n' + str(e))
        st.setdefault('result', 'failed')
        st.setdefault('error', str(e).splitlines()[0])
        code = 1
    except KeyboardInterrupt:
        say('\nCancelled. Nothing was changed.')
        st['result'] = 'cancelled'
        code = 1
    except Exception as e:
        say('\nUpdate failed: %r' % e)
        st['result'] = 'failed'
        st['error'] = '%r | %s' % (e, traceback.format_exc().strip().splitlines()[-2:])
        code = 1
    asked = False
    if st.get('result') not in ('cancelled', 'checked', 'not started', 'already up to date', None):
        url = report_url(st)
        say('\nPlease tell us how the update went, even if it worked (needs a free GitHub account):')
        say('  ' + url)
        if interactive():
            asked = True
            if ask('Type O and press Enter to open this page in your browser, or just press Enter to close: ').strip().lower() == 'o':
                webbrowser.open(url)
    if a.pause and not asked and interactive():
        ask('\nPress Enter to close.')
    sys.exit(code)


if __name__ == '__main__':
    main()
