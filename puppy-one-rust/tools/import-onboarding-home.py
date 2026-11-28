#!/usr/bin/env python3
"""Project the redesigned Projects Home copy (`onboarding.agents.*`, `onboarding.agentStart.*`) from qubits.

The Projects Home Agent strip and start-with-Agent dialog landed on qubits after
the v0.4.4 pin, so their messages are read from one fixed qubits commit, ahead
of `product-source.json`, and kept apart from the pinned catalogs in
`assets/onboarding-home.json` with per-input SHA-256 provenance. Any checkout
of the product repository that contains the commit will do; the files are read
from the commit itself, not the working tree.

  python3 tools/import-onboarding-home.py [--check] [--checkout <path>]
"""
import hashlib
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CHECKOUT = '../../puppyone-qubits'
COMMIT = 'dc8468ccca89a3f75a0ebadbbe0de5688e4dc2e2'
LOCALES = ['en', 'es', 'pt-BR', 'fr', 'de', 'ja', 'ko', 'zh-Hans']
PREFIXES = ('agents.', 'agentStart.', 'sharing.thisMac')
OUTPUT = ROOT / 'assets/onboarding-home.json'

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
    locales[locale] = {
        f'onboarding.{key}': value
        for key, value in messages.items()
        if key.startswith(PREFIXES)
    }
    if not locales[locale]:
        raise SystemExit(f'{name} at {COMMIT} has no agents.* / agentStart.* messages')

content = json.dumps({'sourceCommit': COMMIT, 'sourceHashes': hashes, 'locales': locales},
                     ensure_ascii=False, indent=1) + '\n'
if '--check' in sys.argv:
    if not OUTPUT.exists() or OUTPUT.read_text() != content:
        raise SystemExit(f'Stale {OUTPUT.relative_to(ROOT)}; run python3 tools/import-onboarding-home.py')
    print('Projects Home copy verified')
else:
    OUTPUT.write_text(content)
    print(f'Projects Home copy projected from {COMMIT[:9]}')
