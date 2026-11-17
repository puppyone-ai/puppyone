#!/usr/bin/env python3
"""Install the pinned PDFium library (bblanchon/pdfium-binaries) into
vendor/pdfium for development builds and packaging. The PDF viewer reports
"unavailable" when no library is present; it never falls back to another engine.

    python3 tools/fetch-pdfium.py [--check]
"""
import hashlib
import io
import platform
import sys
import tarfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RELEASE = 'chromium/8125'
ASSETS = {
    ('Darwin', 'arm64'): ('pdfium-mac-arm64.tgz', '4939bd935ac83ddc09a3a4f038bc43a19cea1660316a3667f26cb07a070e139d'),
}
target = ROOT / 'vendor/pdfium'


def main():
    key = (platform.system(), platform.machine())
    if key not in ASSETS:
        raise SystemExit(f'No pinned PDFium build for {key}; add one to ASSETS')
    name, digest = ASSETS[key]
    library = target / 'lib' / ('libpdfium.dylib' if key[0] == 'Darwin' else 'libpdfium.so')
    if '--check' in sys.argv:
        if not library.is_file():
            raise SystemExit(f'PDFium missing at {library}; run tools/fetch-pdfium.py')
        print(f'PDFium present: {library}')
        return
    url = f'https://github.com/bblanchon/pdfium-binaries/releases/download/{RELEASE}/{name}'
    data = urllib.request.urlopen(url, timeout=120).read()
    if hashlib.sha256(data).hexdigest() != digest:
        raise SystemExit(f'PDFium archive digest mismatch for {url}')
    target.mkdir(parents=True, exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(data)) as archive:
        archive.extractall(target, filter='data')
    print(f'Installed {RELEASE} into {target}')


main()
