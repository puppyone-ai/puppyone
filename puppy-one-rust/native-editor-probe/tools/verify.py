#!/usr/bin/env python3
"""Isolated checks; never launches/closes windows or touches user documents."""
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import struct

root = Path(__file__).resolve().parents[1]
out = root / 'artifacts'
out.mkdir(exist_ok=True)
cargo = shutil.which('cargo') or str(Path.home() / '.cargo/bin/cargo')
env = {**os.environ, 'CARGO_TARGET_DIR': str(root.parent / 'target')}
# Distinct font identities prevent CoreText from replacing Regular with Bold.
def postscript_name(path):
    data = path.read_bytes()
    for i in range(struct.unpack_from('>H', data, 4)[0]):
        tag, _, offset, _ = struct.unpack_from('>4sIII', data, 12 + 16 * i)
        if tag == b'name':
            _, count, strings = struct.unpack_from('>3H', data, offset)
            for j in range(count):
                platform_id, _, _, name, length, start = struct.unpack_from('>6H', data, offset + 6 + 12 * j)
                if platform_id == 3 and name == 6:
                    return data[offset + strings + start:offset + strings + start + length].decode('utf-16-be')
    raise ValueError(f'Missing PostScript name: {path}')
assert postscript_name(root / 'assets/Geist-Regular.ttf') == 'Geist-Regular'
assert postscript_name(root / 'assets/Geist-Bold.ttf') == 'Geist-Bold'
assert len({postscript_name(root / f'assets/OpenSans-{style}.ttf') for style in ['Regular', 'Bold', 'Italic', 'BoldItalic']}) == 4
checks = [
    ['fmt', '--check'],
    ['test', '--locked'],
    ['clippy', '--locked', '--all-targets', '--', '-D', 'warnings'],
    ['build', '--release', '--locked'],
]
receipts = []
for args in checks:
    result = subprocess.run([cargo, *args], cwd=root, env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    (out / f'{args[0]}.log').write_text(result.stdout)
    print(result.stdout, end='')
    receipts.append({'command': ['cargo', *args], 'exit': result.returncode})
    if result.returncode:
        raise SystemExit(result.returncode)
tree = subprocess.check_output([cargo, 'tree', '--locked'], cwd=root, env=env, text=True)
(out / 'dependencies.txt').write_text(tree)
assert not any(name in tree for name in ['wry v', 'tauri v', 'webkit2gtk v', 'egui v', 'eframe v', 'gpui-kit-markdown-editor v'])
assert 'gpui-kit v0.8.0' in tree and 'gpui-pre v0.3.9' in tree
assert 'gpui v0.2.2' not in tree
paths = [root / 'Cargo.toml', root / 'Cargo.lock', *sorted((root / 'src').rglob('*.rs')), *sorted((root / 'assets').glob('*'))]
paths += [root.parent / p for p in ['src/ui/input.rs', 'src/theme.rs', 'src/geometry.rs']]
adapter = root.parent / 'src/native_editor/gpui'
paths += [adapter / p for p in ['input.rs', 'layout.rs', 'hit_test.rs', 'presentation.rs']]
paths += sorted((adapter / 'input').rglob('*.rs'))
metadata = {
    'scope': 'independent native in-memory editor probe; synthetic GPUI input tests, not OS IME acceptance',
    'passed': True,
    'verifiedAt': datetime.now().astimezone().isoformat(),
    'platform': platform.platform(),
    'rustc': subprocess.check_output([str(Path(cargo).with_name('rustc')), '--version'], text=True).strip(),
    'baseCommit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip(),
    'implementation': 'uncommitted worktree; baseCommit does not contain this probe',
    'checks': receipts,
    'sourceHashes': {os.path.relpath(p, root): hashlib.sha256(p.read_bytes()).hexdigest() for p in paths},
}
(out / 'verification.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + '\n')
print('Native probe verification passed; no GUI window or user document was manipulated.')
