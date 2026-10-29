#!/usr/bin/env python3
"""Package a source-verified local build; never sign, install, or launch it."""
import argparse
from datetime import datetime
import hashlib
import json
from pathlib import Path
import plistlib
import re
import shutil
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--qa-root', type=Path, help='Existing disposable workspace for the isolated QA app')
parser.add_argument('--preview-root', type=Path, help='Existing disposable workspace for a separate continuous-editor preview; leaves the running QA app untouched')
parser.add_argument('--kit-preview-root', type=Path, help='Package only a new GPUI Kit preview with a separate bundle identity and data directory')
parser.add_argument('--kit-preview-name', default='PuppyOne GPUI Kit Preview', help='Distinct app name when preserving an already-running Kit preview')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
if args.kit_preview_root and (args.qa_root or args.preview_root):
    parser.error('--kit-preview-root cannot replace an existing QA/continuous preview')
if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9 -]{0,63}', args.kit_preview_name):
    parser.error('--kit-preview-name must be a short app name without path separators')
kit_slug = re.sub(r' +', '-', args.kit_preview_name.removeprefix('PuppyOne ').lower())
custom_kit_name = args.kit_preview_name != 'PuppyOne GPUI Kit Preview'
if custom_kit_name and not args.kit_preview_root:
    parser.error('--kit-preview-name requires --kit-preview-root')


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verified_receipt(relative):
    receipt = json.loads((root / relative).read_text())
    if not receipt.get('passed') or not receipt.get('sourceUnchangedDuringVerification', True):
        raise SystemExit(f'Checks did not pass: {relative}')
    hashes = receipt.get('sourceHashes', {})
    if not hashes:
        raise SystemExit(f'Missing source identity: {relative}')
    for name, expected in hashes.items():
        path = root / name
        if not path.is_file() or digest(path) != expected:
            raise SystemExit(f'Source changed after verification: {name}')
    return receipt


checks = verified_receipt('artifacts/gpui-verification/result.json')
runtimes = verified_receipt('artifacts/agent-runtime-verification/result.json')
binary = root / 'target/release/puppy-one-rust'
if binary.is_file() and checks.get('releaseBinarySha256') != digest(binary):
    raise SystemExit('Release binary differs from source verification')
if not binary.is_file():
    raise SystemExit('Missing release binary; run tools/verify.py first')
qa_root = None
if args.qa_root:
    qa_root = args.qa_root.resolve(strict=True)
    if not qa_root.is_dir() or not qa_root.is_relative_to(Path('/private/tmp')):
        raise SystemExit('QA workspace must be an existing directory below /private/tmp')
preview_root = None
if args.preview_root:
    preview_root = args.preview_root.resolve(strict=True)
    if not preview_root.is_dir() or not preview_root.is_relative_to(Path('/private/tmp')):
        raise SystemExit('Preview workspace must be an existing directory below /private/tmp')
kit_root = args.kit_preview_root.resolve(strict=True) if args.kit_preview_root else None
if kit_root and (not kit_root.is_dir() or not kit_root.is_relative_to(Path('/private/tmp'))):
    raise SystemExit('Kit preview workspace must be an existing directory below /private/tmp')
version = datetime.now().strftime('%Y%m%d.%H%M%S')
app = root / (f'artifacts/{args.kit_preview_name}.app' if kit_root else 'artifacts/PuppyOne GPUI Workbench.app')


def package(path, name, identifier, environment=None):
    contents = path / 'Contents'
    executable = contents / 'MacOS/puppy-one-rust'
    resources = contents / 'Resources'
    executable.parent.mkdir(parents=True, exist_ok=True)
    resources.mkdir(parents=True, exist_ok=True)
    shutil.copy2(binary, executable)
    for source, destination in [
        (root / 'README.md', 'README.md'),
        (root / 'THIRD_PARTY.md', 'THIRD_PARTY.md'),
        (root.parent / 'LICENSE', 'LICENSE'),
        (root / 'assets/OpenSans-OFL.txt', 'OpenSans-OFL.txt'),
        (root / 'assets/agents/lobe-icons-license.txt', 'AGENT_ICONS_LICENSE.txt'),
    ]:
        shutil.copy2(source, resources / destination)
    # Folders open through Finder "Open With" / `open -a` (on_open_urls).
    folder_type = {'CFBundleTypeName': 'Folder', 'CFBundleTypeRole': 'Editor',
                   'LSItemContentTypes': ['public.folder'], 'LSHandlerRank': 'Alternate'}
    info = {'CFBundleDocumentTypes': [folder_type],
            'CFBundleExecutable': 'puppy-one-rust', 'CFBundleIdentifier': identifier,
            'CFBundleName': name, 'CFBundlePackageType': 'APPL',
            'CFBundleShortVersionString': '0.1.0', 'CFBundleVersion': version,
            'NSHighResolutionCapable': True}
    if environment:
        info['LSEnvironment'] = environment
    with (contents / 'Info.plist').open('wb') as f:
        plistlib.dump(info, f)
    if digest(executable) != digest(binary):
        raise SystemExit(f'Packaged binary mismatch: {path}')


if kit_root:
    package(app, args.kit_preview_name, f'local.puppyone.{kit_slug}', {
        'PUPPYONE_WORKSPACE': str(kit_root), 'PUPPYONE_FILE': 'note.md',
        'PUPPYONE_RUST_DATA_DIR': str(kit_root / '.puppyone-data'),
    })
else:
    package(app, 'PuppyOne GPUI Workbench', 'local.puppyone.gpui-workbench')
if qa_root:
    package(Path('/private/tmp/PuppyOneWorkbenchQA.app'), 'PuppyOne Workbench QA',
            'local.puppyone.workbench-qa', {
                'PUPPYONE_WORKSPACE': str(qa_root), 'PUPPYONE_RIGHT': '1',
                'PUPPYONE_RUST_DATA_DIR': str(qa_root / '.puppyone-data'),
            })
preview = root / 'artifacts/PuppyOne Continuous Editor Preview.app'
if preview_root:
    package(preview, 'PuppyOne Continuous Editor Preview', 'local.puppyone.continuous-editor-preview', {
        'PUPPYONE_WORKSPACE': str(preview_root),
        'PUPPYONE_RUST_DATA_DIR': str(preview_root / '.puppyone-data'),
    })
expected = {'puppyone-native', 'handshakes', 'pty', 'codex', 'claude', 'cursor', 'pi'}
scope = set(runtimes.get('scope', [c['name'] for c in runtimes['checks']]))
receipt = {
    'app': str(app.relative_to(root)), 'bundleVersion': version,
    'binarySha256': digest(binary), 'sourceVerification': checks['verifiedAt'],
    'defaultChecksPassed': True, 'runtimeChecks': runtimes['checks'],
    'runtimeVerification': runtimes['capturedAt'], 'runtimeScope': sorted(scope),
    'omittedRuntimeChecks': sorted(expected - scope),
    'selectedRuntimeChecksPassed': True,
    'fullRuntimeVerificationPassed': expected <= scope,
    'earlierRuntimeEvidence': [
        'artifacts/agent-runtime-verification/previous-live-result.json',
        'artifacts/agent-runtime-verification/pi-resume-result.json',
        'artifacts/agent-runtime-verification/pi-native-control.log',
    ],
    'guiVerified': False,
    'guiStatus': 'No GUI smoke in source verification; native editors are covered by GPUI tests, while full workbench, OS IME and pixel parity are not certified.',
    'previewApp': str(app.relative_to(root)) if kit_root else str(preview.relative_to(root)) if preview_root else None,
    'sourceStatus': 'puppyone-rust branch',
    'fullElectronParity': False,
    'editorModes': ['native'],
}
receipt_name = f'{kit_slug}-delivery.json' if custom_kit_name else 'kit-preview-delivery.json'
(root / (f'artifacts/{receipt_name}' if kit_root else 'artifacts/workbench-delivery.json')).write_text(json.dumps(receipt, indent=2) + '\n')
worktrees = subprocess.check_output(['git', 'worktree', 'list', '--porcelain'], cwd=root, text=True)
(root / 'artifacts/retained-worktrees.txt').write_text(worktrees)
print(f'Packaged {app}; SHA-256 {receipt["binarySha256"]}')
print('No application was launched. Full runtime/GUI/Electron parity is not certified.')
