#!/usr/bin/env python3
"""The product's format registry and preset viewer manifest, verbatim.

`shared/fileFormats.json` is the canonical file format
table (extensions, MIME types, category, default viewer, editability) and
`shared/presetViewerManifest.json` the
process-neutral contract of every viewer that ships with the product. The
native registries (`src/formats`, `src/editor/registry`) read these copies.
Run with --check to detect a stale projection.
"""
import json
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
from product_source import product_root
repo = product_root()
sources = {
    'shared/fileFormats.json': root / 'assets/formats/file-formats.json',
    'shared/presetViewerManifest.json': root / 'assets/formats/preset-viewers.json',
}
stale = []
for source, target in sources.items():
    # Normalised JSON keeps the copy byte-stable across editors.
    content = json.dumps(json.loads((repo / source).read_text()), ensure_ascii=False, indent=1) + '\n'
    if '--check' in sys.argv:
        if not target.exists() or target.read_text() != content:
            stale.append(str(target.relative_to(root)))
    else:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content)
if stale:
    raise SystemExit('Stale format projection: ' + ', '.join(stale))
print('Format registry verified' if '--check' in sys.argv else 'Format registry imported')
