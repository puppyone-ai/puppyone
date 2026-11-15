#!/usr/bin/env python3
"""Project the first-run moments' copy (`onboarding.value.*`) from qubits.

The empty Homepage's value carousel (MinimalOnboarding) landed on qubits after
the v0.4.4 pin, so its messages are read from one fixed qubits commit, ahead of
`product-source.json`, and kept apart from the pinned catalogs in
`assets/onboarding-value.json` with per-input SHA-256 provenance. Any checkout
of the product repository that contains the commit will do; the files are read
from the commit itself, not the working tree.

  python3 tools/import-onboarding-value.py [--check] [--checkout <path>]
"""
import hashlib
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CHECKOUT = '../../puppyone-qubits'
COMMIT = '67b1e3865558b7b8fb62f0d79c3aa49a8909ad0b'
LOCALES = ['en', 'es', 'pt-BR', 'fr', 'de', 'ja', 'ko', 'zh-Hans']
OUTPUT = ROOT / 'assets/onboarding-value.json'

checkout = CHECKOUT
if '--checkout' in sys.argv:
    checkout = sys.argv[sys.argv.index('--checkout') + 1]
repo = (ROOT / checkout).resolve()

hashes = {}
locales = {}
for locale in LOCALES:
    name = f'locales/renderer/{locale}/onboarding.json'
    raw = subprocess.check_output(['git', 'show', f'{COMMIT}:{name}'], cwd=repo)
    hashes[name] = hashlib.sha256(raw).hexdigest()
    messages = json.loads(raw)
    locales[locale] = {f'onboarding.{key}': value for key, value in messages.items() if key.startswith('value.')}
    if not locales[locale]:
        raise SystemExit(f'{name} at {COMMIT} has no value.* messages')

content = json.dumps({'sourceCommit': COMMIT, 'sourceHashes': hashes, 'locales': locales},
                     ensure_ascii=False, indent=1) + '\n'
if '--check' in sys.argv:
    if not OUTPUT.exists() or OUTPUT.read_text() != content:
        raise SystemExit(f'Stale {OUTPUT.relative_to(ROOT)}; run python3 tools/import-onboarding-value.py')
    print('First-run moment copy verified')
else:
    OUTPUT.write_text(content)
    print(f'First-run moment copy projected from {COMMIT[:9]}')
