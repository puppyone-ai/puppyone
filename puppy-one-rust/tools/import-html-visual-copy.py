#!/usr/bin/env python3
"""Project the HTML visual editor's block and link copy (`editor.html.*`)
from qubits.

The block moves, copies and deletes and the link address editor landed on
qubits after the v0.4.4 pin, so their labels are read from one fixed qubits
commit, ahead of `product-source.json`, and kept apart from the pinned
catalogs in `assets/html-visual-copy.json` with per-input SHA-256
provenance. The bundled editor (`assets/web/html-visual.js`) reads them
through the `editor.html.` messages the native viewer hands it.

  python3 tools/import-html-visual-copy.py [--check] [--checkout <path>]
"""
import hashlib
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CHECKOUT = '../../puppyone-qubits'
COMMIT = '2d2cf6a629b2658750e80b536fd9d6999888ebef'
LOCALES = ['en', 'es', 'pt-BR', 'fr', 'de', 'ja', 'ko', 'zh-Hans']
KEYS = ['html.linkUrl', 'html.moveUp', 'html.moveDown', 'html.duplicateBlock', 'html.deleteBlock']
OUTPUT = ROOT / 'assets/html-visual-copy.json'

checkout = CHECKOUT
if '--checkout' in sys.argv:
    checkout = sys.argv[sys.argv.index('--checkout') + 1]
repo = (ROOT / checkout).resolve()


def read(name):
    raw = subprocess.check_output(['git', 'show', f'{COMMIT}:{name}'], cwd=repo)
    hashes[name] = hashlib.sha256(raw).hexdigest()
    return json.loads(raw)


hashes = {}
locales = {}
for locale in LOCALES:
    name = f'locales/renderer/{locale}/editor.json'
    catalog = read(name)
    missing = [key for key in KEYS if key not in catalog]
    if missing:
        raise SystemExit(f'{name} at {COMMIT} has no {", ".join(missing)}')
    locales[locale] = {f'editor.{key}': catalog[key] for key in KEYS}

content = json.dumps(
    {'sourceCommit': COMMIT, 'sourceHashes': hashes, 'locales': locales},
    ensure_ascii=False,
    indent=1,
) + '\n'
if '--check' in sys.argv:
    if not OUTPUT.exists() or OUTPUT.read_text() != content:
        raise SystemExit(f'Stale {OUTPUT.relative_to(ROOT)}; run python3 tools/import-html-visual-copy.py')
    print('HTML visual editor copy verified')
else:
    OUTPUT.write_text(content)
    print(f'HTML visual editor copy projected from {COMMIT[:9]}')
