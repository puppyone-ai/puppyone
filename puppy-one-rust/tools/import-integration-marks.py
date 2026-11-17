#!/usr/bin/env python3
"""Import the product's integration marks the import sources show
(`RENDERER_ASSET_PATHS.icons.integrations`, `ImportSourceMark`) into
assets/integrations/, byte for byte. GitHub and GitLab were imported with the
Homepage; `github-inverse.svg` is the native dark-mode GitHub mark.

    python3 tools/import-integration-marks.py [--check]
"""
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / 'tools'))
from product_source import product_root

MARKS = ['github.svg', 'gitlab.svg', 'notion.svg', 'google-drive.svg', 'obsidian.svg', 'airtable.png']
source = product_root() / 'public/assets/icons/integrations'
target = root / 'assets/integrations'
stale = []
for name in MARKS:
    data = (source / name).read_bytes()
    if not (target / name).is_file() or (target / name).read_bytes() != data:
        stale.append(name)
        if '--check' not in sys.argv:
            (target / name).write_bytes(data)
if '--check' in sys.argv and stale:
    raise SystemExit(f'Stale integration marks {stale}: run python3 tools/import-integration-marks.py')
print(f'{len(MARKS)} integration marks ' + ('checked' if '--check' in sys.argv else 'imported'))
