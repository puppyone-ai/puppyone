#!/usr/bin/env python3
"""Project the Computer Mode copy (`onboarding.computerMode.*` and
`settings.experimental.computerMode.*`) from qubits.

Computer Mode (`enableComputerMode`) landed on qubits after the v0.4.4 pin,
so its messages are read from one fixed qubits commit, ahead of
`product-source.json`, and kept apart from the pinned catalogs in
`assets/computer-mode.json` with per-input SHA-256 provenance.

  python3 tools/import-computer-mode.py [--check] [--checkout <path>]
"""
import hashlib
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CHECKOUT = '../../puppyone-qubits'
COMMIT = 'c902535220b72b87ec0a79db7ddb9574c6e45870'
LOCALES = ['en', 'es', 'pt-BR', 'fr', 'de', 'ja', 'ko', 'zh-Hans']
OUTPUT = ROOT / 'assets/computer-mode.json'

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
    merged = {}
    onboarding_name = f'locales/renderer/{locale}/onboarding.json'
    merged.update({
        f'onboarding.{key}': value
        for key, value in read(onboarding_name).items()
        if key.startswith('computerMode.')
    })
    settings_name = f'locales/renderer/{locale}/settings.json'
    merged.update({
        f'settings.{key}': value
        for key, value in read(settings_name).items()
        if key.startswith('experimental.computerMode.')
    })
    if not any(key.startswith('onboarding.computerMode.') for key in merged):
        raise SystemExit(f'{onboarding_name} at {COMMIT} has no computerMode.* messages')
    if not any(key.startswith('settings.experimental.computerMode.') for key in merged):
        raise SystemExit(f'{settings_name} at {COMMIT} has no experimental.computerMode.* messages')
    locales[locale] = merged

content = json.dumps(
    {'sourceCommit': COMMIT, 'sourceHashes': hashes, 'locales': locales},
    ensure_ascii=False,
    indent=1,
) + '\n'
if '--check' in sys.argv:
    if not OUTPUT.exists() or OUTPUT.read_text() != content:
        raise SystemExit(f'Stale {OUTPUT.relative_to(ROOT)}; run python3 tools/import-computer-mode.py')
    print('Computer Mode copy verified')
else:
    OUTPUT.write_text(content)
    print(f'Computer Mode copy projected from {COMMIT[:9]}')
