#!/usr/bin/env python3
"""Import the product's agent brand marks and generate the monochrome ones.

Every mark in `public/assets/icons/agents/` (`RENDERER_ASSET_PATHS.icons.agents`)
is copied byte-for-byte into `assets/agents/`.

`AgentMonochromeBrandImage` renders ChatGPT/Codex by masking the product's
`chatgpt.png` with `currentColor` inside `viewBox="250 250 1906 1906"`. GPUI
tints an SVG by the alpha of its rendering, so the native mark is that same
viewBox around the unmodified PNG (embedded byte-for-byte as a data URL).
"""
import argparse
import base64
from pathlib import Path

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
parser.add_argument('--check', action='store_true', help='fail if the generated mark is stale')
args = parser.parse_args()
from product_source import product_root
product = product_root()

source = product / 'public/assets/icons/agents'
marks = sorted(p for p in source.iterdir() if p.suffix in ('.svg', '.png', '.webp', '.txt'))
stale = [p.name for p in marks if not (root / 'assets/agents' / p.name).is_file()
         or (root / 'assets/agents' / p.name).read_bytes() != p.read_bytes()]
if not args.check:
    for p in marks:
        (root / 'assets/agents' / p.name).write_bytes(p.read_bytes())
elif stale:
    raise SystemExit(f'Stale agent marks {stale}: run python3 tools/import-agent-marks.py')
png = (source / 'chatgpt.png').read_bytes()
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
