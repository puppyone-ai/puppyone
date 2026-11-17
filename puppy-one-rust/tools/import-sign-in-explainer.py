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

# Copy refinements from artifacts/sign-in-explainer/v4.html (2-agent Moment 1 cast + explicit line breaks).
V4_OVERRIDES = {
    'en': {
        'cloud.auth.explainer.cloud.body': 'Claude and ChatGPT reach it directly,\nand it opens on your phone anytime.',
        'cloud.auth.explainer.share.body': 'Text it to a teammate, or send it to Grok\u00a0Bot—\nopen it to view and keep editing.',
    },
    'es': {
        'cloud.auth.explainer.cloud.body': 'Claude y ChatGPT entran directo,\ny también puedes abrirlo en el móvil cuando quieras.',
        'cloud.auth.explainer.share.body': 'Envíalo por mensaje a un compañero o a Grok\u00a0Bot:\nal abrirlo se puede ver y seguir editando.',
    },
    'pt-BR': {
        'cloud.auth.explainer.cloud.body': 'Claude e ChatGPT acessam direto,\ne você também abre no celular quando quiser.',
        'cloud.auth.explainer.share.body': 'Mande por mensagem para um colega ou para o Grok\u00a0Bot —\né só abrir para ver e continuar editando.',
    },
    'fr': {
        'cloud.auth.explainer.cloud.body': 'Claude et ChatGPT y accèdent directement,\net tout s’ouvre aussi sur votre téléphone.',
        'cloud.auth.explainer.share.body': 'Envoyez-le par message à un collègue ou à Grok\u00a0Bot :\nil suffit de l’ouvrir pour lire et continuer à modifier.',
    },
    'de': {
        'cloud.auth.explainer.cloud.body': 'Claude und ChatGPT greifen direkt darauf zu –\nund auf dem Handy jederzeit griffbereit.',
        'cloud.auth.explainer.share.body': 'Schick ihn per Nachricht ans Team oder an Grok\u00a0Bot –\nöffnen, ansehen und direkt weiterändern.',
    },
    'ja': {
        'cloud.auth.explainer.cloud.body': 'Claude、ChatGPT から直接使えて、\nスマホからもいつでも開けます。',
        'cloud.auth.explainer.share.body': '同僚にメッセージで送ったり、Grok\u00a0Bot に渡したり。\n開くだけで閲覧も続きの編集もできます。',
    },
    'ko': {
        'cloud.auth.explainer.cloud.body': 'Claude, ChatGPT에서 바로 접근하고,\n휴대폰에서도 언제든 열 수 있습니다.',
        'cloud.auth.explainer.share.body': '동료에게 문자로 보내거나 Grok\u00a0Bot에게 전달하세요.\n열기만 하면 바로 보고 이어서 고칠 수 있습니다.',
    },
    'zh-Hans': {
        'cloud.auth.explainer.cloud.body': 'Claude、ChatGPT 直接访问，\n手机上也能随时打开。',
        'cloud.auth.explainer.share.body': '发短信给同事，或发给 Grok\u00a0Bot，\n点开就能看、能接着改。',
    },
}

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

    merged.update(V4_OVERRIDES.get(locale, {}))
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
