#!/usr/bin/env python3
"""Reproducible migration checks, including isolated offscreen native fixtures."""
import argparse
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
from source_identity import source_hashes

parser = argparse.ArgumentParser(description=__doc__)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
out = root / 'artifacts/gpui-verification'
out.mkdir(parents=True, exist_ok=True)
(out / 'result.json').unlink(missing_ok=True)
cargo = shutil.which('cargo') or str(Path.home() / '.cargo/bin/cargo')
verified_sources = source_hashes()

commands = [
    ('fmt', [cargo, 'fmt', '--check']),
    ('boundaries', ['python3', 'tools/check-ui-boundaries.py']),
    ('test-runner', ['python3', '-B', '-m', 'unittest', 'discover', '-s', 'tools', '-p', 'test_*.py']),
    ('test-parity-reference', ['node', 'tools/reference-test-parity.mjs', '--check']),
    ('test-parity-cases', ['node', 'tools/collect-test-cases.mjs']),
    ('viewer-pack', ['python3', '-B', 'tools/verify-viewer-pack.py']),
    ('test-parity-contracts', ['python3', '-B', 'tools/verify-test-parity.py']),
    ('filesystem-case-sensitivity', ['python3', '-B', 'tools/verify-filesystem-case-sensitivity.py']),
    ('managed-installer-interop', ['python3', '-B', 'tools/verify-managed-installer-interop.py']),
    ('product-layers', ['python3', 'tools/audit-product-layers.py']),
    ('auth-reference', ['python3', 'tools/check-auth-reference.py']),
    ('cloud-reference', ['python3', 'tools/check-cloud-reference.py']),
    ('editor-workbench-reference', ['node', 'tools/reference-editor-workbench.mjs', '--check']),
    ('navigation-reference', ['node', 'tools/reference-navigation.mjs', '--check']),
    ('code-reference', ['node', 'tools/reference-code.mjs', '--check']),
    ('localization', ['python3', 'tools/import-localization.py', '--check']),
    ('native-vocabulary', ['node', 'tools/check-native-vocabulary.mjs']),
    ('number-format', ['node', 'tools/reference-number-format.mjs', '--check']),
    ('assets', ['python3', 'tools/generate-assets-rs.py', '--check']),
    ('agent-marks', ['python3', 'tools/import-agent-marks.py', '--check']),
    ('ui-assets', ['node', 'tools/import-ui-assets.mjs', '--check']),
    ('formats', ['python3', 'tools/import-formats.py', '--check']),
    ('templates', ['python3', 'tools/import-templates.py', '--check']),
    ('theme-contract', ['node', 'tools/import-theme-contract.mjs', '--check']),
    ('file-icons', ['node', 'tools/import-file-icons.mjs', '--check']),
    ('integration-marks', ['python3', 'tools/import-integration-marks.py', '--check']),
    ('release-assets', ['python3', 'tools/import-release-assets.py', '--check']),
    ('release-tools', ['python3', '-B', '-m', 'unittest', 'discover', '-s', 'tools/release']),
    ('html-visual', ['node', 'tools/import-html-visual.mjs', '--check']),
    ('office-viewer', ['node', 'tools/import-office-viewer.mjs', '--check']),
    ('structured-viewers', ['node', 'tools/import-structured-viewers.mjs', '--check']),
    ('excalidraw', ['node', 'tools/import-excalidraw.mjs', '--check']),
    ('render-service', ['node', 'tools/import-render-service.mjs', '--check']),
    ('document-defaults', ['node', 'tools/import-document-defaults.mjs', '--check']),
    ('document-fonts', ['python3', 'tools/import-document-fonts.py', '--check']),
    ('app-preview', ['node', 'tools/import-app-preview.mjs', '--check']),
    ('terminal-glyphs', ['node', 'tools/import-xterm-glyphs.mjs', '--check']),
    ('ui-migration', ['python3', 'tools/audit-ui-migration.py']),
    ('coverage', ['python3', '-B', 'tools/verify-coverage.py']),
    ('clippy', [cargo, 'clippy', '--locked', '--all-targets', '--features', 'dev-capture', '--', '-D', 'warnings']),
    ('release', [cargo, 'build', '--locked', '--release']),
    ('editor-frames', ['python3', 'tools/bench-editor.py', '--check']),
    ('native-editor', ['python3', 'tools/verify-native-editor.py']),
]
# A release runner without a sibling repository a check reads (the Cloud
# backend for cloud-reference) names that check here; the receipt keeps it.
skipped = sorted(filter(None, os.environ.get('PUPPYONE_VERIFY_SKIP', '').split(',')))
unknown = set(skipped) - {name for name, _ in commands}
if unknown:
    raise SystemExit(f'PUPPYONE_VERIFY_SKIP names no such check: {", ".join(sorted(unknown))}')
checks = []
for name, command in commands:
    if name in skipped:
        print(f'Skipping {name} (PUPPYONE_VERIFY_SKIP).', flush=True)
        continue
    print(f'Checking {name}…', flush=True)
    result = subprocess.run(command, cwd=root, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    (out / f'{name}.log').write_text(result.stdout)
    checks.append({'name': name, 'exit': result.returncode})
    if result.returncode:
        print(result.stdout, end='')
        raise SystemExit(result.returncode)
tree = subprocess.check_output([cargo, 'tree', '--locked'], cwd=root, text=True)
(out / 'dependencies.txt').write_text(tree)
assert 'gpui-kit v0.8.0' in tree and 'gpui v0.2.2' not in tree
assert 'gpui-pre v0.3.9' in tree
assert not any(name in tree for name in ['egui v', 'eframe v', 'gpui-kit-markdown-editor v'])
if source_hashes() != verified_sources:
    raise SystemExit('Local implementation changed during verification; rerun against one stable source snapshot.')
receipt = {
    'framework': 'gpui-kit 0.8.0 / gpui-pre 0.3.9', 'passed': True,
    'verifiedAt': datetime.now().astimezone().isoformat(),
    'platform': platform.platform(), 'checks': checks, 'skipped': skipped,
    'baseCommit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip(),
    'implementation': 'puppy-one-rust at baseCommit; sourceHashes record the verified files, including uncommitted changes',
    'sourceUnchangedDuringVerification': True,
    'sourceHashes': verified_sources,
    'releaseBinarySha256': hashlib.sha256((Path(json.loads(subprocess.check_output(
        [cargo, 'metadata', '--locked', '--offline', '--no-deps', '--format-version=1'],
        cwd=root, text=True))['target_directory']) / 'release/puppy-one-rust').read_bytes()).hexdigest(),
}
(out / 'result.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + '\n')
print('GPUI verification passed.', flush=True)
