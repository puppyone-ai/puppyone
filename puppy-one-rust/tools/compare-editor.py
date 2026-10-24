#!/usr/bin/env python3
"""Pixel and geometry gate: product editor (Chromium) vs content island (WebKit).

Reference: artifacts/editor-reference/<case>.{png,json} from
  electron tools/reference-editor.mjs   (real EditorPaneShell + product routing)
Island:    tools/island-webkit.py       (the bundle the native app embeds, in the
                                        engine wry uses)

Per case: the routed viewer must match, block-level element rects must match
within --tolerance px, and the share of identical pixels must reach
--min-matching (±2 per channel absorbs colour-mix rounding). Remaining
pixel differences are glyph rasterisation between the two engines. Report: artifacts/editor-parity/report.json (+ diff PNGs).
"""
import argparse
from collections import defaultdict
import json
from pathlib import Path
import subprocess
import sys

import numpy as np
from PIL import Image

root = Path(__file__).resolve().parents[1]
reference = root / 'artifacts/editor-reference'
out = root / 'artifacts/editor-parity'
parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
parser.add_argument('--check', action='store_true', help='exit 1 when a case misses the thresholds')
parser.add_argument('--min-matching', type=float, default=98.5, help='percent of pixels within ±2 per channel (colour-mix rounding)')
parser.add_argument('--tolerance', type=float, default=0.01, help='px deviation counted as identical')
parser.add_argument('--only', help='comma-separated case ids')
args = parser.parse_args()

FIXTURES = {'md': 'sample.md', 'csv': 'sample.csv', 'json': 'sample.json', 'code': 'sample.ts'}
cases = sorted(p.stem for p in reference.glob('*.json'))
if args.only:
    cases = [c for c in cases if c in args.only.split(',')]
out.mkdir(parents=True, exist_ok=True)

# Tiers: block boxes must match exactly; deviations up to 1px are engine
# sub-pixel effects (WebKit floors every visual line's fractional line-height
# and rounds half-leading, so wrapped lines pitch 26px vs 26.25px); larger
# deviations are layout failures. Inline glyph boxes report content-area
# heights the engines round differently, so only their position is compared.
# Table column elements have no box in WebKit's geometry API.
SKIP_TAGS = {'COL', 'COLGROUP'}

def geometry(ref, nat):
    groups = defaultdict(list)
    for e in nat.get('elements', []):
        groups[(e['selector'], e['className'])].append(e)
    seen = defaultdict(int)
    layout, engine = [], []
    for e in ref.get('elements', []):
        if e.get('tag') in SKIP_TAGS:
            continue
        key = (e['selector'], e['className'])
        i = seen[key]; seen[key] += 1
        if i >= len(groups.get(key, [])):
            layout.append({'element': e['className'][:80], 'problem': 'missing in island'}); continue
        r, n = e['rect'], groups[key][i]['rect']
        inline = e.get('display', '').startswith('inline') and e.get('display') != 'inline-block'
        pairs = list(zip(r[:2], n[:2])) if inline else list(zip(r, n))
        worst = max(abs(a - b) for a, b in pairs)
        if worst <= args.tolerance:
            continue
        item = {'element': e['className'][:80], 'reference': r, 'island': n, 'delta': round(worst, 3), 'text': e.get('text', '')[:40]}
        (engine if worst <= 1.0 else layout).append(item)
    return layout, engine

report = []
failed = False
for case in cases:
    kind, *rest = case.split('-')
    flags = ['--light'] if 'light' in rest else []
    if 'menu' in rest: flags.append('--menu')
    if 'source' in rest: flags.append('--source')
    ref_json = json.loads((reference / f'{case}.json').read_text())
    width, height = ref_json['size']
    island_png = out / f'{case}.island.png'
    subprocess.run([sys.executable, str(root / 'tools/island-webkit.py'), str(root / 'fixtures/editor' / FIXTURES[kind]),
                    str(island_png), '--size', f'{width}x{height}', *flags], check=True, stdout=subprocess.DEVNULL)
    island = json.loads(island_png.with_suffix('.json').read_text())['state']
    a = np.asarray(Image.open(reference / f'{case}.png').convert('RGB')).astype(int)
    b = np.asarray(Image.open(island_png).convert('RGB')).astype(int)
    if a.shape != b.shape:
        raise SystemExit(f'{case}: size mismatch {a.shape} vs {b.shape}')
    d = np.abs(a - b).max(axis=2)
    vis = np.zeros_like(a); vis[..., 0] = np.clip(d * 4, 0, 255); vis[..., 1] = (a.mean(axis=2) * .35).astype(int); vis[..., 2] = (b.mean(axis=2) * .35).astype(int)
    Image.fromarray(vis.astype('uint8')).save(out / f'{case}.diff.png')
    identical = float((d == 0).mean() * 100)
    matching = float((d <= 2).mean() * 100)
    mismatches, subpixel = geometry(ref_json, island)
    viewer_ok = ref_json.get('viewer') in (None, island.get('viewer'))
    ok = matching >= args.min_matching and not mismatches and viewer_ok
    failed |= not ok
    report.append({'case': case, 'passed': ok, 'viewer': {'reference': ref_json.get('viewer'), 'island': island.get('viewer')},
                   'identicalPercent': round(identical, 3), 'matchingPercent': round(matching, 3), 'over32Percent': round(float((d > 32).mean() * 100), 3),
                   'meanDelta': round(float(d.mean()), 4), 'layoutMismatches': mismatches[:40],
                   'engineSubpixel': {'count': len(subpixel), 'maxDelta': max([m['delta'] for m in subpixel], default=0), 'examples': subpixel[:8]}})
    print(f"{'PASS' if ok else 'FAIL'} {case:18s} matching {matching:6.2f}%  identical {identical:6.2f}%  >32 {float((d > 32).mean()*100):5.2f}%  "
          f"mean {float(d.mean()):.3f}  layout {len(mismatches)}  subpixel {len(subpixel)}  viewer {island.get('viewer')}")
(out / 'report.json').write_text(json.dumps({'reference': 'Chromium product (tools/reference-editor.mjs)',
    'island': 'WebKit content island (tools/island-webkit.py)', 'thresholds': {'minMatching': args.min_matching, 'tolerancePx': args.tolerance},
    'cases': report}, indent=2) + '\n')
if args.check and failed:
    sys.exit(1)
