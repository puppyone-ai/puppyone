#!/usr/bin/env python3
"""Capture the real native Agent view with an offline injected session port."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
cargo = shutil.which('cargo') or str(Path.home()/'.cargo/bin/cargo')
subprocess.run([cargo,'build','--locked','--features','webview-smoke'],cwd=root,check=True)
out=root/'artifacts/agent-visual';out.mkdir(parents=True,exist_ok=True)
with tempfile.TemporaryDirectory(prefix='puppyone-agent-visual-') as data:
    for surface in ['agent-empty','agent-transcript']:
        env={k:v for k,v in os.environ.items() if not k.startswith('PUPPYONE_')}
        env.update(PUPPYONE_RUST_DATA_DIR=data,PUPPYONE_EDITOR='native',PUPPYONE_CAPTURE_SURFACE=surface,PUPPYONE_SCREENSHOT=str(out/f'{surface}.png'))
        subprocess.run([str(root/'target/debug/puppy-one-rust')],cwd=root,env=env,check=True,timeout=25)
    (out/'result.json').write_text(json.dumps({'scope':'Real GPUI view, offline injected session; no live runtime or pixel parity claim','sourceHashes':{str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted((root/'src/features/desktop_agent').rglob('*.rs'))}},indent=2)+'\n')
print('Native Agent screenshots captured.')
