#!/usr/bin/env python3
"""Import the product's built-in project templates.

`electron/local-api/templates/content/` (`project-catalog.mjs`) holds each
built-in template's manifest and its localized files; they are copied
byte-for-byte into `assets/templates/`, where `platform::templates::builtin`
embeds them and its tests check them against the manifest's digests.
"""
import argparse
from pathlib import Path

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
parser.add_argument('--check', action='store_true', help='fail if a copied file is stale')
args = parser.parse_args()
from product_source import product_root
product = product_root()

source = product / 'electron/local-api/templates/content'
target = root / 'assets/templates'
files = sorted(p for p in source.rglob('*') if p.is_file())
stale = []
for path in files:
    relative = path.relative_to(source)
    destination = target / relative
    if not destination.is_file() or destination.read_bytes() != path.read_bytes():
        stale.append(str(relative))
        if not args.check:
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(path.read_bytes())
if args.check and stale:
    raise SystemExit(f'Stale templates {stale}: run python3 tools/import-templates.py')
print(f'{len(files)} template files' + (' checked' if args.check else ' imported'))
