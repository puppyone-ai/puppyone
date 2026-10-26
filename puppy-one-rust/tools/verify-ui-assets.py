#!/usr/bin/env python3
"""Capture the same asset board in native GPUI and real product React.
Raw captures, ICC-normalized comparisons and per-component scores are kept.
--strict requires exact pixels; no masking, tolerance pass or hidden retries.
"""
import argparse
import hashlib
import io
import json
import math
import os
from pathlib import Path
import subprocess
import tempfile
import numpy as np
from PIL import Image, ImageCms

ROOT = Path(__file__).resolve().parent.parent
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--binary', type=Path, required=True)
p.add_argument('--times', default='0,0.36,0.9,1.32,2.1')
p.add_argument('--modes', default='dark,light')
p.add_argument('--strict', action='store_true')
p.add_argument('--reduced', action='store_true')
a = p.parse_args()
modes=a.modes.split(',')
try:
    times=list(map(float,a.times.split(',')))
except ValueError:
    p.error('--times requires comma-separated seconds')
if not times or any(not math.isfinite(t) or t<0 for t in times) or any(m not in ['dark','light'] for m in modes):
    p.error('Use dark/light modes and finite nonnegative capture times')
product = (ROOT / os.environ.get('PUPPYONE_PRODUCT_ROOT', json.loads((ROOT / 'product-source.json').read_text())['checkout'])).resolve()
electron = product / 'node_modules/.bin/electron'
out = ROOT / 'artifacts/ui-assets'
out.mkdir(parents=True, exist_ok=True)
receipt = out / ('result-still.json' if a.reduced else 'result.json')
receipt.unlink(missing_ok=True)
board = json.loads((ROOT / 'fixtures/ui/asset-gallery.json').read_text())
def srgb(image):
    profile = image.info.get('icc_profile')
    if profile:
        return ImageCms.profileToProfile(image.convert('RGB'), ImageCms.ImageCmsProfile(io.BytesIO(profile)), ImageCms.createProfile('sRGB'), outputMode='RGB')
    return image.convert('RGB')
results = []
for mode in modes:
    for time in times:
        name = f'{mode}-{time:g}' + ('-still' if a.reduced else '')
        native, web = out / f'native-{name}.png', out / f'web-{name}'
        for previous in [native, native.with_suffix('.json'), Path(str(web)+'.png'), Path(str(web)+'.json')]:
            previous.unlink(missing_ok=True)
        with tempfile.TemporaryDirectory(prefix='puppyone-assets-') as profile:
            env = {k:v for k,v in os.environ.items() if not k.startswith('PUPPYONE_')}
            env.update(PUPPYONE_LAB=f'assets-{mode}', PUPPYONE_LOADING_AT=str(time), PUPPYONE_REDUCE_MOTION='1' if a.reduced else '0',
                       PUPPYONE_SCREENSHOT=str(native), PUPPYONE_RUST_DATA_DIR=profile,
                       PUPPYONE_WIDTH=str(board['width']), PUPPYONE_HEIGHT=str(board['height']))
            run = subprocess.run([str(a.binary.resolve())], cwd=ROOT, env=env, capture_output=True, text=True, timeout=60)
            (out / f'native-{name}.log').write_text(run.stdout + run.stderr)
            run.check_returncode()
        spec = out / f'spec-{name}.json'
        # The parent owns cleanup, after Chromium has stopped writing its profile.
        with tempfile.TemporaryDirectory(prefix='puppyone-reference-') as profile:
            spec.write_text(json.dumps(dict(mode=mode, time=time, still=a.reduced, out=str(web),profile=profile)))
            run = subprocess.run([str(electron), 'tools/reference-ui-assets.mjs', str(spec)], cwd=ROOT, capture_output=True, text=True, timeout=120)
            (out / f'web-{name}.log').write_text(run.stdout + run.stderr)
            run.check_returncode()
        n = json.loads(native.with_suffix('.json').read_text())
        r = json.loads(Path(str(web)+'.json').read_text())
        if not n.get('assetsReady'):
            raise RuntimeError('Native capture did not wait for asset decoding; rebuild the dev-capture binary')
        if {i['id'] for i in r['items']} != {i['id'] for i in board['items']}:
            raise RuntimeError('Reference component inventory mismatch')
        if r['dpr'] != n['pixelsPerPoint']:
            raise RuntimeError('DPR mismatch')
        dpr = r['dpr']
        ni, wi = srgb(Image.open(native)), srgb(Image.open(str(web)+'.png'))
        if ni.size != wi.size:
            raise RuntimeError(f'Raster mismatch: {ni.size}/{wi.size}')
        nn, ww = np.asarray(ni).astype(int), np.asarray(wi).astype(int)
        delta = np.abs(nn - ww).max(axis=2)
        Image.fromarray(np.minimum(np.abs(nn - ww)*4,255).astype('uint8')).save(out / f'diff-{name}.png')
        cmp = Image.new('RGB',(ni.width*2,ni.height))
        cmp.paste(wi,(0,0));cmp.paste(ni,(ni.width,0))
        cmp.resize((board['width']*2, board['height'])).save(out / f'comparison-{name}.png')
        items=[]
        for item in board['items']:
            x,y,w,h=[round(item[k]*dpr) for k in ['x','y','w','h']]
            diff=delta[y:y+h,x:x+w]
            items.append(dict(id=item['id'],kind=item['kind'],exactPct=float((diff==0).mean()*100),within8Pct=float((diff<=8).mean()*100)))
        result=dict(case=name,exactPct=float((delta==0).mean()*100),within8Pct=float((delta<=8).mean()*100),items=items)
        results.append(result)
        print(f"{name}: exact {result['exactPct']:.2f}%, tolerance8 {result['within8Pct']:.2f}% ({len(items)} components)",flush=True)
receipt.write_text(json.dumps(dict(nativeBinarySha256=hashlib.sha256(a.binary.resolve().read_bytes()).hexdigest(),scope='File/product icon registries and shared Loading, real full product CSS; comparison in sRGB. Percentages include background pixels. No brand-logo gallery.',cases=results),indent=2)+'\n')
if a.strict and any(r['exactPct']!=100 for r in results):
    raise SystemExit('Not pixel-identical; inspect per-component receipts and differences.')
