#!/usr/bin/env python3
"""Extract one app's files from a local (UNENCRYPTED) iPhone backup on macOS.

Why: iOS apps sandbox their data, but a local Finder/iTunes backup contains
every app's container. This script pulls just one app's files out so the
workout history inside (usually a .sqlite or .plist) can be recovered.

Usage:
  1. Make a fresh LOCAL backup: plug iPhone into the Mac -> Finder -> select
     the phone -> UNCHECK "Encrypt local backup" -> Back Up Now.
     (If unchecking asks for a password, that's the old backup password.)
  2. List app domains to find the app:
       python3 extract-ios-backup.py --list
       python3 extract-ios-backup.py --list | grep -i push
  3. Extract (substring match on the domain/bundle id):
       python3 extract-ios-backup.py --app pushpull --out ~/Desktop/app-dump
     Then right-click the output folder -> Compress, and share the zip.

No third-party packages needed. Reads Manifest.db (sqlite) from the newest
backup under ~/Library/Application Support/MobileSync/Backup unless
--backup <dir> is given. Encrypted backups are detected and rejected with
instructions (their Manifest.db is itself encrypted).
"""

import argparse
import os
import plistlib
import shutil
import sqlite3
import sys
from pathlib import Path

DEFAULT_ROOT = Path.home() / "Library" / "Application Support" / "MobileSync" / "Backup"


def newest_backup(root: Path) -> Path:
    candidates = [p for p in root.iterdir() if p.is_dir() and (p / "Manifest.db").exists()]
    if not candidates:
        sys.exit(f"No backups with a Manifest.db found under {root}\n"
                 "Make a local backup first: Finder -> iPhone -> Back Up Now (encryption OFF).")
    return max(candidates, key=lambda p: (p / "Manifest.db").stat().st_mtime)


def check_not_encrypted(backup: Path) -> None:
    manifest_plist = backup / "Manifest.plist"
    if manifest_plist.exists():
        try:
            with open(manifest_plist, "rb") as fh:
                meta = plistlib.load(fh)
            if meta.get("IsEncrypted"):
                sys.exit("This backup is ENCRYPTED, so its file index can't be read here.\n"
                         "Redo it unencrypted: Finder -> iPhone -> uncheck 'Encrypt local backup' -> Back Up Now.")
        except Exception:
            pass  # fall through; sqlite open below is the real test


def open_manifest(backup: Path) -> sqlite3.Connection:
    db = backup / "Manifest.db"
    try:
        conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        conn.execute("SELECT count(*) FROM Files").fetchone()
        return conn
    except sqlite3.DatabaseError:
        sys.exit("Couldn't read Manifest.db — this backup is most likely encrypted.\n"
                 "Redo it unencrypted: Finder -> iPhone -> uncheck 'Encrypt local backup' -> Back Up Now.")


def main() -> None:
    ap = argparse.ArgumentParser(description="Extract one app's files from a local iPhone backup")
    ap.add_argument("--backup", type=Path, help="backup directory (default: newest under MobileSync/Backup)")
    ap.add_argument("--list", action="store_true", help="list app domains and file counts, then exit")
    ap.add_argument("--app", help="substring of the app's domain/bundle id to extract (case-insensitive)")
    ap.add_argument("--out", type=Path, default=Path("app-dump"), help="output directory (default ./app-dump)")
    args = ap.parse_args()

    backup = args.backup or newest_backup(DEFAULT_ROOT)
    print(f"Backup: {backup}")
    check_not_encrypted(backup)
    conn = open_manifest(backup)

    if args.list or not args.app:
        rows = conn.execute(
            "SELECT domain, count(*) FROM Files WHERE domain LIKE 'AppDomain%' GROUP BY domain ORDER BY domain"
        ).fetchall()
        print(f"\n{len(rows)} app domains:")
        for domain, n in rows:
            print(f"  {n:5d}  {domain}")
        if not args.app:
            print("\nRe-run with --app <substring> to extract one of these.")
        return

    needle = args.app.lower()
    rows = conn.execute(
        "SELECT fileID, domain, relativePath, flags FROM Files WHERE lower(domain) LIKE ?",
        (f"%{needle}%",),
    ).fetchall()
    if not rows:
        sys.exit(f"No files matched domain substring '{args.app}'. Try --list to see domains.")

    copied = skipped = 0
    for file_id, domain, rel, flags in rows:
        if flags == 2 or not rel:  # directory entries
            continue
        src = backup / file_id[:2] / file_id
        if not src.exists():
            skipped += 1
            continue
        dest = args.out / domain / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dest)
        copied += 1

    print(f"\nExtracted {copied} files to {args.out.resolve()} ({skipped} missing on disk).")
    print("Right-click the folder -> Compress, and share the zip for schema analysis.")


if __name__ == "__main__":
    main()
