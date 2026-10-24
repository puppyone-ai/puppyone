#!/usr/bin/env python3
"""Fail when editor/bundle is stale: every input esbuild recorded in
editor/bundle/sources.json (product sources, the island's own sources and the
resolved packages) must still hash the same. Rebuild with `node editor/build.mjs`.
"""
import hashlib
import json
import os
from pathlib import Path
import sys

root = Path(__file__).resolve().parents[1]
config = json.loads((root / 'product-source.json').read_text())
product = Path(os.environ.get('PUPPYONE_PRODUCT_ROOT', root / config['checkout'])).resolve()
recorded = json.loads((root / 'editor/bundle/sources.json').read_text())
stale = []
for name, digest in recorded['inputs'].items():
    path = (product / name.split('?')[0]).resolve()
    if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != digest:
        stale.append(name)
island = [n for n in recorded['inputs'] if 'puppy-one-rust/editor/src/' in n]
for source in (root / 'editor/src').iterdir():
    if source.suffix in ('.js', '.tsx', '.ts', '.css', '.html') and not any(n.endswith(f'editor/src/{source.name}') for n in island):
        if source.name not in ('markdown-smoke.js',):
            stale.append(f'editor/src/{source.name} (not in bundle)')
if stale:
    sys.exit('Stale editor bundle; run node editor/build.mjs:\n  ' + '\n  '.join(stale[:20]) + (f'\n  … {len(stale) - 20} more' if len(stale) > 20 else ''))
print(f"Editor bundle verified ({len(recorded['inputs'])} inputs, product {recorded['sourceCommit'][:8]})")
