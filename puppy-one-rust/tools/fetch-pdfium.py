#!/usr/bin/env python3
"""Install the pinned PDFium library (bblanchon/pdfium-binaries) into
vendor/pdfium for development builds and packaging. The PDF viewer reports
"unavailable" when no library is present; it never falls back to another engine.

    python3 tools/fetch-pdfium.py [--check] [--target <os-arch>]
"""
import argparse
import hashlib
import io
import platform
import sys
import tarfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RELEASE = 'chromium/8125'

# Pinned bblanchon/pdfium-binaries chromium/8125 SHA-256 digests across all
# supported desktop targets (macOS arm64/x64, Windows x64/arm64, Linux x64/arm64).
ASSETS = {
    'mac-arm64': (
        'pdfium-mac-arm64.tgz',
        '4939bd935ac83ddc09a3a4f038bc43a19cea1660316a3667f26cb07a070e139d',
        Path('lib/libpdfium.dylib'),
    ),
    'mac-x64': (
        'pdfium-mac-x64.tgz',
        '8a5193535b80c7215d8932f6647ae5097465b6dba2811602c21e120c2af112b0',
        Path('lib/libpdfium.dylib'),
    ),
    'win-x64': (
        'pdfium-win-x64.tgz',
        '9a964261760cff52570aabf038ab346d3a5034dd8b30d0d5fe8861235d356b8b',
        Path('bin/pdfium.dll'),
    ),
    'win-arm64': (
        'pdfium-win-arm64.tgz',
        'd394ba61991fb53f4d87f70988035f337d9e73f2bd2c3c1b966df8c43fcabb05',
        Path('bin/pdfium.dll'),
    ),
    'linux-x64': (
        'pdfium-linux-x64.tgz',
        'e1c3ce6e270cb5e0c20816b379ad9f2c1309972697c505f508de92bf5e7d6659',
        Path('lib/libpdfium.so'),
    ),
    'linux-arm64': (
        'pdfium-linux-arm64.tgz',
        '8b8818f2ec57d1b213d952ca6d7f0ffeca9d0110487d0e20ad83ba918bc92efa',
        Path('lib/libpdfium.so'),
    ),
}

HOST_TARGETS = {
    ('Darwin', 'arm64'): 'mac-arm64',
    ('Darwin', 'aarch64'): 'mac-arm64',
    ('Darwin', 'x86_64'): 'mac-x64',
    ('Windows', 'AMD64'): 'win-x64',
    ('Windows', 'x86_64'): 'win-x64',
    ('Windows', 'ARM64'): 'win-arm64',
    ('Windows', 'aarch64'): 'win-arm64',
    ('Linux', 'x86_64'): 'linux-x64',
    ('Linux', 'AMD64'): 'linux-x64',
    ('Linux', 'aarch64'): 'linux-arm64',
    ('Linux', 'arm64'): 'linux-arm64',
}


def detect_host_target() -> str:
    key = (platform.system(), platform.machine())
    if key not in HOST_TARGETS:
        raise SystemExit(f'No pinned PDFium build for host {key}; supported: {sorted(ASSETS)}')
    return HOST_TARGETS[key]


def install(target_id: str, dest: Path, check_only: bool) -> Path:
    if target_id not in ASSETS:
        raise SystemExit(f'Unknown PDFium target {target_id!r}; expected one of {sorted(ASSETS)}')
    name, digest, rel_lib = ASSETS[target_id]
    library = dest / rel_lib
    if check_only:
        if not library.is_file():
            raise SystemExit(f'PDFium missing at {library}; run tools/fetch-pdfium.py --target {target_id}')
        print(f'PDFium present ({target_id}): {library}')
        return library
    url = f'https://github.com/bblanchon/pdfium-binaries/releases/download/{RELEASE}/{name}'
    data = urllib.request.urlopen(url, timeout=120).read()
    actual = hashlib.sha256(data).hexdigest()
    if actual != digest:
        raise SystemExit(f'PDFium archive digest mismatch for {url}: got {actual}, expected {digest}')
    dest.mkdir(parents=True, exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(data)) as archive:
        archive.extractall(dest, filter='data')
    if not library.is_file():
        raise SystemExit(f'PDFium archive {name} did not contain expected {rel_lib}')
    print(f'Installed {RELEASE} ({target_id}) into {dest}')
    return library


def main(argv=None):
    parser = argparse.ArgumentParser(description='Fetch pinned PDFium binary for a desktop target.')
    parser.add_argument('--check', action='store_true', help='Verify the library is already present.')
    parser.add_argument('--target', choices=sorted(ASSETS), help='Target platform (defaults to host).')
    parser.add_argument('--dest', type=Path, default=ROOT / 'vendor/pdfium', help='Destination directory.')
    args = parser.parse_args(argv)
    target_id = args.target or detect_host_target()
    install(target_id, args.dest, args.check)


if __name__ == '__main__':
    main()
