#!/usr/bin/env python3
"""Install the Excalidraw SDK's fonts (13 MB, mostly Xiaolai's CJK shards)
into vendor/excalidraw/fonts for development builds and packaging. The
whiteboard serves them from disk (`__assets__/excalidraw/fonts/…`); without
them its text falls back to the system's fonts.

The npm tarball is the one the product's lockfile pins (the same sha512
integrity); every installed file must match the digest
tools/import-excalidraw.mjs recorded in assets/web/excalidraw-fonts.json.

    python3 tools/fetch-excalidraw-fonts.py [--check]
"""
import base64
import hashlib
import io
import json
import shutil
import sys
import tarfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INTEGRITY = 'sha512-6i5Gt7IDTOH//qa0Z315Ly5iVRhjWpu2whrlQFqkuwrkKUWgRsMk0P5qdE7bpyDpai7jeLeWYkyj1eVAfni1lw=='
MANIFEST = ROOT / 'assets/web/excalidraw-fonts.json'
TARGET = ROOT / 'vendor/excalidraw/fonts'
PREFIX = 'package/dist/prod/fonts/'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def stale(fonts):
    """Files missing or different from the manifest."""
    return [name for name, expected in fonts.items()
            if not (TARGET / name).is_file() or digest((TARGET / name).read_bytes()) != expected]


def main():
    manifest = json.loads(MANIFEST.read_text())
    fonts = manifest['fonts']
    if '--check' in sys.argv:
        missing = stale(fonts)
        if missing:
            raise SystemExit(f'{len(missing)} Excalidraw fonts missing or changed; '
                             'run python3 tools/fetch-excalidraw-fonts.py')
        print(f'Excalidraw fonts verified ({len(fonts)} files)')
        return
    name = manifest['package'].split('/')[-1]
    url = f"https://registry.npmjs.org/{manifest['package']}/-/{name}-{manifest['version']}.tgz"
    with urllib.request.urlopen(url, timeout=120) as response:
        archive = response.read()
    algorithm, expected = INTEGRITY.split('-', 1)
    if base64.b64encode(hashlib.new(algorithm, archive).digest()).decode() != expected:
        raise SystemExit(f'{url} does not match the pinned integrity')
    if TARGET.exists():
        shutil.rmtree(TARGET)
    with tarfile.open(fileobj=io.BytesIO(archive), mode='r:gz') as tar:
        for member in tar.getmembers():
            relative = member.name[len(PREFIX):] if member.name.startswith(PREFIX) else None
            if not member.isfile() or relative not in fonts:
                continue
            data = tar.extractfile(member).read()
            if digest(data) != fonts[relative]:
                raise SystemExit(f'{relative} does not match assets/web/excalidraw-fonts.json')
            path = TARGET / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
    missing = stale(fonts)
    if missing:
        raise SystemExit(f'The tarball lacks {len(missing)} listed fonts, e.g. {missing[0]}')
    print(f'Installed {len(fonts)} Excalidraw fonts into {TARGET.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
