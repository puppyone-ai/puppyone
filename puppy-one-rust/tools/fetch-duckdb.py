#!/usr/bin/env python3
"""Install the pinned DuckDB library (duckdb/duckdb releases, the version the
product's `@duckdb/node-api` 1.5.5 embeds) into vendor/duckdb for development
builds and packaging, thinned to this machine's architecture. The database
viewer reports DuckDB files as unsupported when no library is present.

    python3 tools/fetch-duckdb.py [--check]
"""
import hashlib
import io
import platform
import subprocess
import sys
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RELEASE = 'v1.5.5'
ASSETS = {
    ('Darwin', 'arm64'): ('libduckdb-osx-universal.zip', '7b5b8915cc382d0708636fe6385c0cdad5a61c9ff8ba2638b3e2141640783155'),
}
target = ROOT / 'vendor/duckdb'


def main():
    key = (platform.system(), platform.machine())
    if key not in ASSETS:
        raise SystemExit(f'No pinned DuckDB build for {key}; add one to ASSETS')
    name, digest = ASSETS[key]
    library = target / 'lib' / 'libduckdb.dylib'
    if '--check' in sys.argv:
        if not library.is_file():
            raise SystemExit(f'DuckDB missing at {library}; run tools/fetch-duckdb.py')
        print(f'DuckDB present: {library}')
        return
    url = f'https://github.com/duckdb/duckdb/releases/download/{RELEASE}/{name}'
    data = urllib.request.urlopen(url, timeout=300).read()
    if hashlib.sha256(data).hexdigest() != digest:
        raise SystemExit(f'DuckDB archive digest mismatch for {url}')
    library.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        library.write_bytes(archive.read('libduckdb.dylib'))
    # Only this architecture ships (as PDFium), and the bundle loads it by
    # its own path, not an rpath.
    subprocess.run(['lipo', str(library), '-thin', key[1], '-output', str(library)], check=True)
    subprocess.run(['install_name_tool', '-id', '@rpath/libduckdb.dylib', str(library)], check=True)
    (target / 'LICENSE').write_text(LICENSE)
    print(f'Installed DuckDB {RELEASE} into {target}')


# github.com/duckdb/duckdb/blob/v1.5.5/LICENSE
LICENSE = """Copyright 2018-2025 Stichting DuckDB Foundation

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
"""

main()
