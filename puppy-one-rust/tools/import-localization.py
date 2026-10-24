#!/usr/bin/env python3
"""Project catalogs are the only translation source. No installed preferences.
Run with --check to detect a stale native projection.
"""
import hashlib
import os
import json
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parents[1]
repo = (root / os.environ.get('PUPPYONE_PRODUCT_ROOT', json.loads((root / 'product-source.json').read_text())['checkout'])).resolve()
manifest_path = repo / 'locales/manifest.json'
manifest = json.loads(manifest_path.read_text())
locales = [x for x in manifest['locales'] if x.get('productionReady')]
inputs = [manifest_path]
catalogs = {}
for descriptor in locales:
    locale = descriptor['locale']
    catalogs[locale] = {}
    for namespace in ['settings', 'shell', 'common', 'workspace', 'agent', 'updates', 'terminal', 'source-control', 'shared-ui', 'onboarding', 'editor']:
        source = repo / f'locales/renderer/{locale}/{namespace}.json'
        inputs.append(source)
        catalogs[locale].update({f'{namespace}.{k}': v for k, v in json.loads(source.read_text()).items()})
data = {'sourceCommit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=repo, text=True).strip(),
        'sourceHashes': {str(p.relative_to(repo)): hashlib.sha256(p.read_bytes()).hexdigest() for p in inputs},
        'locales': locales, 'catalogs': catalogs}
outputs = {root / 'assets/locales.json': json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n'}
for path, content in outputs.items():
    if '--check' in sys.argv:
        actual = path.read_text() if path.exists() else None
        if actual and path.suffix == '.json':
            recorded = json.loads(actual); expected = json.loads(content)
            recorded.pop('sourceCommit', None); expected.pop('sourceCommit', None)
            matches = recorded == expected
        else:
            matches = actual == content
        if not matches:
            raise SystemExit(f'Stale localization projection: {path.relative_to(root)}')
    else:
        path.write_text(content)
print('Product localization projections verified' if '--check' in sys.argv else 'Product localization projections generated')
