#!/usr/bin/env python3
"""Import the product's Markdown emoji shortcodes.

`features/inline-syntax/emojiShortcodes.generated.json` (`:name:` → emoji)
is copied byte-for-byte into `assets/markdown/emoji-shortcodes.json`, which
`editor::markdown::core::syntax` embeds.
"""
import argparse
from pathlib import Path

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
parser.add_argument('--check', action='store_true', help='fail if the copy is stale')
args = parser.parse_args()
from product_source import product_root

source = product_root() / 'src/shared-ui/editor/markdown/features/inline-syntax/emojiShortcodes.generated.json'
target = root / 'assets/markdown/emoji-shortcodes.json'
if target.is_file() and target.read_bytes() == source.read_bytes():
    print('emoji shortcodes current')
elif args.check:
    raise SystemExit('Stale emoji shortcodes: run python3 tools/import-emoji-shortcodes.py')
else:
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(source.read_bytes())
    print('emoji shortcodes imported')
