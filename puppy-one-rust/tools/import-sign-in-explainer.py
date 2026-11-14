#!/usr/bin/env python3
"""Project the Cloud sign-in explainer copy (`cloud.auth.explainer.*` and its
reused scene messages) from qubits.

`CloudSignInDialog` landed on qubits after the v0.4.4 pin, so its messages are
read from one fixed qubits commit, ahead of `product-source.json`, and kept
apart from the pinned catalogs in `assets/sign-in-explainer.json` with
per-input SHA-256 provenance. Any checkout of the product repository that
contains the commit will do; the files are read from the commit itself, not the
working tree.

  python3 tools/import-sign-in-explainer.py [--check] [--checkout <path>]
"""
import hashlib
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CHECKOUT = '../../puppyone-qubits'
COMMIT = '01dac7c02c2c9dd12fcc18c8efaab75cfdfbf06a'
LOCALES = ['en', 'es', 'pt-BR', 'fr', 'de', 'ja', 'ko', 'zh-Hans']
OUTPUT = ROOT / 'assets/sign-in-explainer.json'

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
        if key.startswith('auth.explainer.')
    })

    onboarding_name = f'locales/renderer/{locale}/onboarding.json'
    onboarding_raw = subprocess.check_output(['git', 'show', f'{COMMIT}:{onboarding_name}'], cwd=repo)
    hashes[onboarding_name] = hashlib.sha256(onboarding_raw).hexdigest()
    onboarding_messages = json.loads(onboarding_raw)
    merged.update({
        f'onboarding.{key}': value
        for key, value in onboarding_messages.items()
        if key == 'value.folder' or key.startswith('value.scene.')
    })

    if not any(key.startswith('cloud.auth.explainer.') for key in merged):
        raise SystemExit(f'{cloud_name} at {COMMIT} has no auth.explainer.* messages')
    locales[locale] = merged

content = json.dumps(
    {'sourceCommit': COMMIT, 'sourceHashes': hashes, 'locales': locales},
    ensure_ascii=False,
    indent=1,
) + '\n'
if '--check' in sys.argv:
    if not OUTPUT.exists() or OUTPUT.read_text() != content:
        raise SystemExit(
            f'Stale {OUTPUT.relative_to(ROOT)}; run python3 tools/import-sign-in-explainer.py'
        )
    print('Sign-in explainer copy verified')
else:
    OUTPUT.write_text(content)
    print(f'Sign-in explainer copy projected from {COMMIT[:9]}')
