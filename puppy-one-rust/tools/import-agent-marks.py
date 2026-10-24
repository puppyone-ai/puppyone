#!/usr/bin/env python3
"""Generate monochrome agent marks that the product draws as alpha masks.

`AgentMonochromeBrandImage` renders ChatGPT/Codex by masking the product's
`chatgpt.png` with `currentColor` inside `viewBox="250 250 1906 1906"`. GPUI
tints an SVG by the alpha of its rendering, so the native mark is that same
viewBox around the unmodified PNG (embedded byte-for-byte as a data URL).
"""
import argparse
import base64
import json
import os
from pathlib import Path

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
parser.add_argument('--check', action='store_true', help='fail if the generated mark is stale')
args = parser.parse_args()
config = json.loads((root / 'product-source.json').read_text())
product = Path(os.environ.get('PUPPYONE_PRODUCT_ROOT', root / config['checkout'])).resolve()

png = (product / 'public/assets/icons/agents/chatgpt.png').read_bytes()
svg = (
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
    'viewBox="250 250 1906 1906">'
    '<image width="2406" height="2406" xlink:href="data:image/png;base64,'
    + base64.b64encode(png).decode('ascii')
    + '"/></svg>\n'
)
out = root / 'assets/agents/chatgpt-mark.svg'
if args.check:
    if not out.is_file() or out.read_text() != svg:
        raise SystemExit('Stale agent mark: run python3 tools/import-agent-marks.py')
    print('Agent marks verified')
else:
    out.write_text(svg)
    print(f'Wrote {out.relative_to(root)} ({len(svg)} bytes)')
