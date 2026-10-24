#!/usr/bin/env python3
"""Reproducible GPUI migration checks (no windows are opened)."""
import argparse
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
out = root / 'artifacts/gpui-verification'
out.mkdir(parents=True, exist_ok=True)
cargo = shutil.which('cargo') or str(Path.home() / '.cargo/bin/cargo')
paths = [root / p for p in ['Cargo.toml', 'Cargo.lock', 'README.md', 'THIRD_PARTY.md', 'product-source.json']]
for folder in ['src', 'assets', 'native-editor-probe/src', 'native-editor-probe/assets', 'tools']:
    paths.extend(p for p in sorted((root / folder).rglob('*')) if p.is_file() and "__pycache__" not in p.parts)
paths.extend(root / p for p in ['native-editor-probe/Cargo.toml', 'native-editor-probe/Cargo.lock'])
def source_hashes():
    return {os.path.relpath(p, root): hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
verified_sources = source_hashes()

commands = [
    ('fmt', [cargo, 'fmt', '--check']),
    ('boundaries', ['python3', 'tools/check-ui-boundaries.py']),
    ('product-layers', ['python3', 'tools/audit-product-layers.py']),
    ('localization', ['python3', 'tools/import-localization.py', '--check']),
    ('assets', ['python3', 'tools/generate-assets-rs.py', '--check']),
    ('agent-marks', ['python3', 'tools/import-agent-marks.py', '--check']),
    ('ui-migration', ['python3', 'tools/audit-ui-migration.py']),
    ('test', [cargo, 'test', '--locked', '--features', 'dev-capture']),
    ('clippy', [cargo, 'clippy', '--locked', '--all-targets', '--features', 'dev-capture', '--', '-D', 'warnings']),
    ('release', [cargo, 'build', '--locked', '--release']),
    ('native-probe', ['python3', 'native-editor-probe/tools/verify.py']),
]
checks = []
for name, command in commands:
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
    'platform': platform.platform(), 'checks': checks,
    'baseCommit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip(),
    'implementation': 'puppy-one-rust at baseCommit; sourceHashes record the verified files, including uncommitted changes',
    'sourceUnchangedDuringVerification': True,
    'sourceHashes': verified_sources,
    'releaseBinarySha256': hashlib.sha256((root/'target/release/puppy-one-rust').read_bytes()).hexdigest(),
}
(out / 'result.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + '\n')
print('GPUI verification passed.', flush=True)
