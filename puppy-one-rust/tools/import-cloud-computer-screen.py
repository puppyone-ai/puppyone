#!/usr/bin/env python3
"""Project the Cloud Computer Screen copy (`cloud.sandbox.screen.*`,
`cloud.settings.tab.computer`, `cloud.settings.computer.*`, and
`settings.experimental.cloudComputerScreen.*`) from qubits.

`CloudComputerScreen` landed on qubits after the v0.4.4 pin, so its messages
are read from one fixed qubits commit, ahead of `product-source.json`, and kept
apart from the pinned catalogs in `assets/cloud-computer-screen.json` with
per-input SHA-256 provenance.

  python3 tools/import-cloud-computer-screen.py [--check] [--checkout <path>]
"""
import hashlib
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CHECKOUT = '../../puppyone-qubits'
COMMIT = '76e56e3c73f25079f92999df24e13c2666784989'
LOCALES = ['en', 'es', 'pt-BR', 'fr', 'de', 'ja', 'ko', 'zh-Hans']
OUTPUT = ROOT / 'assets/cloud-computer-screen.json'

checkout = CHECKOUT
if '--checkout' in sys.argv:
    checkout = sys.argv[sys.argv.index('--checkout') + 1]
repo = (ROOT / checkout).resolve()

hashes = {}
locales = {}
for locale in LOCALES:
    merged = {}
    cloud_name = f'locales/renderer/{locale}/cloud.json'
    cloud_raw = subprocess.check_output(['git', 'show', f'{COMMIT}:{cloud_name}'], cwd=repo)
    hashes[cloud_name] = hashlib.sha256(cloud_raw).hexdigest()
    cloud_messages = json.loads(cloud_raw)
    merged.update({
        f'cloud.{key}': value
        for key, value in cloud_messages.items()
        if key.startswith('sandbox.screen.')
        or key == 'settings.tab.computer'
        or key.startswith('settings.computer.')
    })

    settings_name = f'locales/renderer/{locale}/settings.json'
    settings_raw = subprocess.check_output(['git', 'show', f'{COMMIT}:{settings_name}'], cwd=repo)
    hashes[settings_name] = hashlib.sha256(settings_raw).hexdigest()
    settings_messages = json.loads(settings_raw)
    merged.update({
        f'settings.{key}': value
        for key, value in settings_messages.items()
        if key.startswith('experimental.cloudComputerScreen.')
    })

    if not any(key.startswith('cloud.sandbox.screen.') for key in merged):
        raise SystemExit(f'{cloud_name} at {COMMIT} has no sandbox.screen.* messages')
    if not any(key.startswith('settings.experimental.cloudComputerScreen.') for key in merged):
        raise SystemExit(f'{settings_name} at {COMMIT} has no experimental.cloudComputerScreen.* messages')
    locales[locale] = merged

content = json.dumps(
    {'sourceCommit': COMMIT, 'sourceHashes': hashes, 'locales': locales},
    ensure_ascii=False,
    indent=1,
) + '\n'
if '--check' in sys.argv:
    if not OUTPUT.exists() or OUTPUT.read_text() != content:
        raise SystemExit(
            f'Stale {OUTPUT.relative_to(ROOT)}; run python3 tools/import-cloud-computer-screen.py'
        )
    print('Cloud Computer Screen copy verified')
else:
    OUTPUT.write_text(content)
    print(f'Cloud Computer Screen copy projected from {COMMIT[:9]}')
