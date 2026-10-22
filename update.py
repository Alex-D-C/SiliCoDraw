#!/usr/bin/env python3
"""Update SiliCoDraw to the latest version from GitHub (Windows, macOS, Linux).

    python3 update.py            # download the latest version and replace the software files
    python3 update.py --check    # only show what would change
    python3 update.py --pause    # wait for Enter at the end (used by the double-click launchers)

What it does: downloads the current main branch of https://github.com/Alex-D-C/SiliCoDraw as a ZIP,
unpacks it in a temporary folder and copies every software file that changed into this folder
(editor, servers, launchers, docs, examples, this script). Before a file is replaced, the old one is
kept in updates/backup-<date>/ (the three newest backups are kept).

What it never touches: your figures (*.json in this folder), history/, exports/, assets/, archive/,
trash/ and updates/. Nothing is ever deleted. Needs only Python 3 and an internet connection.
Windows without Python: "Update SiliCoDraw.bat" runs update.ps1 instead, which does the same.
"""
import argparse, io, json, os, shutil, stat, sys, urllib.request, zipfile
from datetime import datetime

REPO = 'Alex-D-C/SiliCoDraw'
BRANCH = 'main'
ROOT = os.path.dirname(os.path.abspath(__file__))
PROTECTED_DIRS = ('history', 'exports', 'assets', 'archive', 'trash', 'updates', '.git')
KEEP_BACKUPS = 3
EXEC_FILES = ('.sh', '.command', 'serve.py', 'update.py')   # made executable on macOS / Linux


def protected(rel):
    """True for paths (with / separators) that belong to the user, not to the software."""
    if rel.split('/', 1)[0] in PROTECTED_DIRS:
        return True
    return '/' not in rel and rel.endswith('.json')   # a figure in the root folder


def fetch(url, timeout=60):
    req = urllib.request.Request(url, headers={'User-Agent': 'SiliCoDraw-updater'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def latest_commit(repo, branch):
    try:
        j = json.loads(fetch('https://api.github.com/repos/%s/commits/%s' % (repo, branch), 20).decode('utf-8'))
        return {'sha': j['sha'][:10], 'date': j['commit']['committer']['date'][:10],
                'message': j['commit']['message'].splitlines()[0]}
    except Exception:
        return None


def run(a):
    print('SiliCoDraw updater\n  folder: %s\n  source: https://github.com/%s (%s)' % (ROOT, a.repo, a.branch))
    info = latest_commit(a.repo, a.branch)
    if info:
        print('  latest: %s  %s  [%s]' % (info['date'], info['message'], info['sha']))
    print('Downloading...')
    try:
        data = fetch('https://github.com/%s/archive/refs/heads/%s.zip' % (a.repo, a.branch))
    except Exception as e:
        print('Could not download the latest version: %s\nCheck your internet connection and try again. Nothing was changed.' % e)
        return 1
    z = zipfile.ZipFile(io.BytesIO(data))
    names = [n for n in z.namelist() if not n.endswith('/')]
    if not names:
        print('The download was empty; nothing was changed.')
        return 1
    top = names[0].split('/', 1)[0]            # GitHub puts everything in <repo>-<branch>/
    stamp = datetime.now().strftime('%Y-%m-%d_%H-%M-%S')
    bdir = os.path.join(ROOT, 'updates', 'backup-' + stamp)
    changed, new, skipped = [], [], 0
    for n in names:
        if not n.startswith(top + '/'):
            continue
        rel = n[len(top) + 1:]
        parts = rel.split('/')
        if not rel or '' in parts or '..' in parts or os.path.isabs(rel):
            continue                                # never write outside this folder
        if protected(rel):
            skipped += 1
            continue
        body = z.read(n)
        dst = os.path.join(ROOT, *parts)
        if os.path.isfile(dst):
            with open(dst, 'rb') as f:
                if f.read() == body:
                    continue
            changed.append(rel)
            if not a.check:
                bak = os.path.join(bdir, *parts)
                os.makedirs(os.path.dirname(bak), exist_ok=True)
                shutil.copy2(dst, bak)
        else:
            new.append(rel)
        if not a.check:
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            with open(dst, 'wb') as f:
                f.write(body)
            if os.name != 'nt' and rel.endswith(EXEC_FILES):
                os.chmod(dst, os.stat(dst).st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    total = len(changed) + len(new)
    if a.check:
        if not total:
            print('SiliCoDraw is up to date.')
        else:
            print('%d file(s) would be updated:' % total)
            for r in changed:
                print('  updated  ' + r)
            for r in new:
                print('  new      ' + r)
    elif not total:
        print('SiliCoDraw is already up to date. Nothing was changed.')
    else:
        print('Updated %d file(s), added %d:' % (len(changed), len(new)))
        for r in changed:
            print('  updated  ' + r)
        for r in new:
            print('  new      ' + r)
        if changed:
            print('The previous versions are kept in updates/backup-%s/' % stamp)
        udir = os.path.join(ROOT, 'updates')
        os.makedirs(udir, exist_ok=True)
        backups = sorted(d for d in os.listdir(udir) if d.startswith('backup-') and os.path.isdir(os.path.join(udir, d)))
        for d in backups[:-KEEP_BACKUPS]:
            shutil.rmtree(os.path.join(udir, d), ignore_errors=True)
        with open(os.path.join(udir, 'installed.txt'), 'w') as f:
            f.write('updated: %s\n' % datetime.now().strftime('%Y-%m-%d %H:%M'))
            if info:
                f.write('source: https://github.com/%s commit %s (%s)\n' % (a.repo, info['sha'], info['date']))
        print('Your figures, history, exports and assets were not touched.')
        print('If SiliCoDraw is open: close the server window, start it again and reload the browser page.')
    if skipped:
        print('(%d file(s) in the download were skipped because they would overwrite your data.)' % skipped)
    return 0


def main():
    ap = argparse.ArgumentParser(description='Update SiliCoDraw from GitHub')
    ap.add_argument('--check', action='store_true', help='only show what would change')
    ap.add_argument('--pause', action='store_true', help='wait for Enter before closing')
    ap.add_argument('--repo', default=REPO, help='GitHub repository (default %s)' % REPO)
    ap.add_argument('--branch', default=BRANCH, help='branch (default %s)' % BRANCH)
    a = ap.parse_args()
    try:
        code = run(a)
    except KeyboardInterrupt:
        code = 1
    except Exception as e:
        print('\nUpdate failed: %s' % e)
        code = 1
    if a.pause:
        try:
            input('\nPress Enter to close.')
        except EOFError:
            pass
    sys.exit(code)


if __name__ == '__main__':
    main()
