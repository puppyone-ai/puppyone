#!/usr/bin/env python3
"""Import the product's Markdown callout glyphs.

`features/callout/calloutIcons.ts` stores each callout's Lucide outline as
data (`CALLOUT_ICONS`); each becomes `assets/icons/callout-<name>.svg`,
stroked in white (GPUI tints an SVG by its alpha) at the product's width 2.
"""
import argparse
import json
import re
from pathlib import Path

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
parser.add_argument('--check', action='store_true', help='fail if a glyph is stale')
args = parser.parse_args()
from product_source import product_root

source = (product_root() / 'src/shared-ui/editor/markdown/features/callout/calloutIcons.ts').read_text()
icons = dict(re.findall(r'^\s+(\w+): (\[\[.*\]\]),$', source, re.M))
stale = []
for name, nodes in sorted(icons.items()):
    body = ''.join(
        f'<{tag} ' + ' '.join(f'{k}="{v}"' for k, v in attributes.items()) + '/>'
        for tag, attributes in json.loads(nodes)
    )
    svg = ('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" '
           'fill="none" stroke="white" stroke-width="2" stroke-linecap="round" '
           f'stroke-linejoin="round">{body}</svg>\n')
    target = root / 'assets/icons' / f'callout-{name}.svg'
    if not target.is_file() or target.read_text() != svg:
        stale.append(name)
        if not args.check:
            target.write_text(svg)
if args.check and stale:
    raise SystemExit(f'Stale callout glyphs {stale}: run python3 tools/import-callout-icons.py')
print(f'{len(icons)} callout glyphs' + (' checked' if args.check else ''))
