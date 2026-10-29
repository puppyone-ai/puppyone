#!/usr/bin/env python3
"""Copy the product's browser renderers (the same package versions the
Electron Office viewer uses) into assets/web/vendor. Run with --check."""
import json
import shutil
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
product = (root / json.loads((root / 'product-source.json').read_text())['checkout']).resolve()
files = {
    'docx-preview.min.js': 'node_modules/docx-preview/dist/docx-preview.min.js',
    'jszip.min.js': 'node_modules/jszip/dist/jszip.min.js',
    'pptx-renderer.js': 'node_modules/@aiden0z/pptx-renderer/dist/aiden0z-pptx-renderer.browser.es.js',
    'xlsx.full.min.js': 'node_modules/xlsx/dist/xlsx.full.min.js',
}
target = root / 'assets/web/vendor'
stale = []
for name, source in files.items():
    src, dst = product / source, target / name
    if '--check' in sys.argv:
        if not dst.is_file() or dst.read_bytes() != src.read_bytes():
            stale.append(name)
    else:
        target.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dst)
if stale:
    raise SystemExit('Stale web vendor files: ' + ', '.join(stale))
print('Web vendor renderers ' + ('verified' if '--check' in sys.argv else 'imported'))
