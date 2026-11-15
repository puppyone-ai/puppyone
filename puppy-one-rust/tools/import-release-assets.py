#!/usr/bin/env python3
"""Import what a release bundle shows from the product, byte for byte, into
assets/release/: the App Image per channel (`app-icon-contract.mjs`; dev has
its own) and the DMG window's background (`assets/installer`).

    python3 tools/import-release-assets.py [--check]
"""
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / 'tools'))
from product_source import product_root

ASSETS = {
    'assets/brand/puppy/puppy-app-image.png': 'puppy-app-image.png',
    'assets/brand/puppy/puppy-app-image-dev.png': 'puppy-app-image-dev.png',
    'assets/installer/dmg-background.tiff': 'dmg-background.tiff',
}
product = product_root()
target = root / 'assets/release'
stale = []
for source, name in ASSETS.items():
    data = (product / source).read_bytes()
    if not (target / name).is_file() or (target / name).read_bytes() != data:
        stale.append(name)
        if '--check' not in sys.argv:
            (target / name).write_bytes(data)
if '--check' in sys.argv and stale:
    raise SystemExit(f'Stale release assets {stale}: run python3 tools/import-release-assets.py')
print(f'{len(ASSETS)} release assets ' + ('checked' if '--check' in sys.argv else 'imported'))
