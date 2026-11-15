#!/usr/bin/env python3
"""Import the faces Sub Themes set Markdown in that the app does not already
bundle: the product's PT Serif (`public/fonts/pt-serif`, "PuppyOne PT
Serif"), decompressed from WOFF2 to the TrueType GPUI loads, with its
licence. Open Sans ships as assets/OpenSans-*.ttf already.

    python3 tools/import-document-fonts.py [--check]
"""
import io
import sys
from pathlib import Path

from fontTools.ttLib import woff2

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / 'tools'))
from product_source import product_root

FACES = ['PTSerif-Regular', 'PTSerif-Italic', 'PTSerif-Bold', 'PTSerif-BoldItalic']
product = product_root() / 'public/fonts/pt-serif'
target = root / 'assets/fonts/document'
expected = {'PT_Serif_OFL.txt': (product / 'OFL.txt').read_bytes()}
for face in FACES:
    out = io.BytesIO()
    woff2.decompress(io.BytesIO((product / f'{face}.woff2').read_bytes()), out)
    expected[f'{face}.ttf'] = out.getvalue()
stale = [name for name, data in expected.items()
         if not (target / name).is_file() or (target / name).read_bytes() != data]
if '--check' in sys.argv:
    if stale:
        raise SystemExit(f'Stale document fonts {stale}: run python3 tools/import-document-fonts.py')
    print(f'{len(expected)} document font files checked')
else:
    target.mkdir(parents=True, exist_ok=True)
    for name in stale:
        (target / name).write_bytes(expected[name])
    print(f'{len(expected)} document font files imported')
