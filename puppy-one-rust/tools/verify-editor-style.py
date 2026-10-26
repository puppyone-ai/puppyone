#!/usr/bin/env python3
"""Real product Markdown vs native captures; no mutation of the product checkout.

Requires a --features dev-capture binary, Electron from the product checkout,
Pillow and numpy. Writes PNGs, geometry, source hashes and honest pixel scores.
--check requires exact pixels (known renderer differences are NOT masked).
"""
import argparse
import hashlib
import json
import io
import os
from pathlib import Path
import subprocess
import tempfile

import numpy as np
from PIL import Image, ImageCms


def srgb(image):
    """OS captures and Chromium carry different ICC profiles; compare colors,
    not unlike encoded RGB bytes. Never drop a profile before conversion."""
    profile = image.info.get('icc_profile')
    if profile:
        return ImageCms.profileToProfile(image.convert('RGB'),
            ImageCms.ImageCmsProfile(io.BytesIO(profile)), ImageCms.createProfile('sRGB'), outputMode='RGB')
    return image.convert('RGB')

ROOT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--binary', type=Path, required=True)
parser.add_argument('--electron', type=Path)
parser.add_argument('--only', help='comma-separated case ids')
parser.add_argument('--check', action='store_true')
args = parser.parse_args()
product = (ROOT / os.environ.get('PUPPYONE_PRODUCT_ROOT', json.loads((ROOT / 'product-source.json').read_text())['checkout'])).resolve()
electron = args.electron or product / 'node_modules/.bin/electron'
out = ROOT / 'artifacts/style-sync'
out.mkdir(parents=True, exist_ok=True)
fixtures = ROOT / 'fixtures/editor'
cases = []
for mode in ['dark', 'light']:
    for scale in ['small', 'medium', 'large']:
        cases.append(dict(id=f'style-{mode}-{scale}', file='style-sync.md', mode=mode, scale=scale, width=1280))
    for width in [1280, 960]:
        cases.append(dict(id=f'table-{mode}-{width}', file='table-style-sync.md', mode=mode, scale='medium', width=width))
    text = (fixtures / 'selection-style-sync.md').read_text()
    for name, selection in [('paragraph', [2, 220]), ('code', [text.index('first line') + 2, text.index('third line') + 5])]:
        case = dict(id=f'selection-{mode}-{name}', file='selection-style-sync.md', mode=mode, scale='medium', width=960, selection=selection, focus=True)
        if name == 'code':
            case['codeSelection'] = [offset - text.index('first line') for offset in selection]
        cases.append(case)
results = []
for case in cases:
    if args.only and case['id'] not in args.only.split(','):
        continue
    name = case['id']
    native = out / f'native-{name}.png'
    geometry = out / f'geometry-{name}.json'
    for previous in [native, native.with_suffix('.json'), geometry,
                     out / f'web-{name}.png', out / f'web-{name}.json']:
        previous.unlink(missing_ok=True)
    with tempfile.TemporaryDirectory(prefix='puppyone-style-') as profile:
        env = {k: v for k, v in os.environ.items() if not k.startswith('PUPPYONE_')}
        env.update(PUPPYONE_SCREENSHOT=str(native), PUPPYONE_EDITOR_GEOMETRY=str(geometry),
                   PUPPYONE_THEME=case['mode'], PUPPYONE_TEXT_SCALE=case['scale'], PUPPYONE_WIDTH=str(case['width']),
                   PUPPYONE_HEIGHT='800', PUPPYONE_RUST_DATA_DIR=profile, PUPPYONE_LOCALE='en',
                   PUPPYONE_EDITOR_FOCUS='1' if case.get('focus') else '0')
        if 'selection' in case:
            env['PUPPYONE_EDITOR_SELECTION'] = ','.join(map(str, case['selection']))
        run = subprocess.run([str(args.binary.resolve()), '--workspace', str(fixtures), '--file', case['file']],
                             cwd=ROOT, env=env, capture_output=True, text=True, timeout=60)
        (out / f'native-{name}.log').write_text(run.stdout + run.stderr)
        run.check_returncode()
    shell = json.loads(native.with_suffix('.json').read_text())
    x, y, w, h = shell['editor']
    spec = {**case, 'file': str(fixtures / case['file']), 'width': w, 'height': h,
            'out': str(out / f'web-{name}.json'), 'screenshot': str(out / f'web-{name}.png')}
    spec_file = out / f'spec-{name}.json'
    spec_file.write_text(json.dumps(spec))
    run = subprocess.run([str(electron), 'tools/probe-editor.mjs', str(spec_file)], cwd=ROOT,
                         capture_output=True, text=True, timeout=90)
    (out / f'web-{name}.log').write_text(run.stdout + run.stderr)
    run.check_returncode()
    reference = json.loads((out / f'web-{name}.json').read_text())
    # Chromium reports this deferred ResizeObserver delivery while the real
    # table reflows. Keep it in the receipt; all other runtime errors fail.
    fatal = [e for e in reference['errors'] if e != 'ResizeObserver loop completed with undelivered notifications.']
    if fatal:
        raise RuntimeError(fatal)
    if case.get('focus'):
        selected = reference['selection']
        if not selected['focused'] or not (selected['rects'] or selected['codeRange']):
            raise RuntimeError(f'{name}: reference selection was not painted')
    native_geometry = json.loads(geometry.read_text())
    dpr = shell['pixelsPerPoint']
    a = srgb(Image.open(native)).crop(tuple(round(v * dpr) for v in (x, y, x + w, y + h)))
    a.save(out / f'editor-{name}.png')
    b = srgb(Image.open(out / f'web-{name}.png'))
    if a.size != b.size:
        raise RuntimeError(f'{name}: different raster sizes: {a.size} / {b.size}')
    aa, bb = np.asarray(a).astype(int), np.asarray(b).astype(int)
    delta = np.abs(aa - bb).max(axis=2)
    Image.fromarray(np.minimum(np.abs(aa - bb) * 4, 255).astype('uint8')).save(out / f'diff-{name}.png')
    comparison = Image.new('RGB', (a.width * 2, a.height))
    comparison.paste(b, (0, 0)); comparison.paste(a, (a.width, 0))
    comparison.resize((round(w * 2), round(h))).save(out / f'comparison-{name}.png')
    # Source lines are exact identifiers outside replaced widgets. Match the
    # top-level boxes by order; report coverage, never treat unmatched as pass.
    nlines, rlines = native_geometry['lines'], reference['lines']
    count = min(len(nlines), len(rlines))
    error = max((abs(n['rect'][i] - r['rect'][i]) for n, r in zip(nlines, rlines) for i in range(4)), default=0)
    result = {'id': name, 'sourceCommit': reference['sourceCommit'], 'dpr': dpr,
              'exactPct': float((delta == 0).mean() * 100), 'within8Pct': float((delta <= 8).mean() * 100),
              'meanChannelError': float(np.abs(aa - bb).mean()), 'maxBlockDeltaPx': error,
              'blocksCompared': count, 'nativeBlocks': len(nlines), 'referenceBlocks': len(rlines),
              'footerHeight': shell['footer'][3], 'referenceWarnings': reference['errors']}
    results.append(result)
    print(f"{name:28} exact {result['exactPct']:.2f}%  <=8 {result['within8Pct']:.2f}%  box delta {error:.3f}px ({count}/{len(nlines)}/{len(rlines)})", flush=True)
if not results:
    parser.error('No cases matched --only')
(out / 'result.json').write_text(json.dumps({
    'scope': 'Default-neutral, real product viewer vs native; ICC-normalized sRGB; exact means zero RGB difference',
    'nativeBinarySha256': hashlib.sha256(args.binary.resolve().read_bytes()).hexdigest(),
    'pixelIdentical': all(r['exactPct'] == 100 for r in results), 'cases': results,
}, indent=2) + '\n')
if args.check and any(r['exactPct'] != 100 or r['nativeBlocks'] != r['referenceBlocks'] or r['maxBlockDeltaPx'] > 0.01 for r in results):
    raise SystemExit('NOT pixel-identical: see artifacts/style-sync/result.json and diff images.')
