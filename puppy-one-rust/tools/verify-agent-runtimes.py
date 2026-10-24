#!/usr/bin/env python3
"""Explicit native runtime checks. --live uses existing CLI login for small inference tests."""
import argparse
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--live', action='store_true')
parser.add_argument('--only', action='append', choices=['puppyone-native','handshakes','pty','codex','claude','cursor','pi'], help='Run only selected checks; inference checks also require --live')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
out = root / 'artifacts/agent-runtime-verification'
out.mkdir(parents=True, exist_ok=True)
cargo = shutil.which('cargo') or str(Path.home() / '.cargo/bin/cargo')
tests = [('puppyone-native', 'native_puppyone_http_approval_resume_fork_stop_and_binding'),
         ('handshakes', 'live_installed_runtime_handshakes'),
         ('pty', 'real_pty_input_resize_and_cleanup')]
if args.live:
    tests += [('codex', 'live_codex_roundtrip_resume_and_stop'),
              ('claude', 'live_claude_stream_and_resume'),
              ('cursor', 'live_cursor_stream_and_resume'),
              ('pi', 'live_pi_stream_and_resume')]
if args.only:
    requested = set(args.only)
    available = {name for name, _ in tests}
    if not requested <= available:
        parser.error('Inference checks require --live')
    tests = [(name, test) for name, test in tests if name in requested]


def source_hashes():
    return {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest()
            for folder in ['src/agent', 'src/features/desktop_agent', 'src/model_connections', 'src/platform']
            for p in sorted((root / folder).rglob('*.rs'))}

before = source_hashes()
checks = []
with tempfile.TemporaryDirectory(prefix='puppyone-runtime-verification-', dir='/private/tmp') as data:
    env = dict(os.environ, PUPPYONE_RUST_DATA_DIR=data)
    for name, test in tests:
        print(f'Checking {name}…', flush=True)
        command = [cargo, 'test', '--locked', '--features', 'dev-capture', test,
                   '--', '--ignored', '--nocapture', '--test-threads=1']
        try:
            result = subprocess.run(command, cwd=root, env=env, text=True,
                                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=240)
            code, output = result.returncode, result.stdout
        except subprocess.TimeoutExpired:
            code, output = 124, 'Runtime verification exceeded its time budget.'
        (out / f'{name}.log').write_text(output)
        checks.append({'name': name, 'exit': code, 'test': test})
        print(f'{name}: {"passed" if code == 0 else "failed (see log)"}', flush=True)
report = {'capturedAt': datetime.now().astimezone().isoformat(), 'checks': checks,
          'passed': all(c['exit'] == 0 for c in checks), 'liveInference': args.live, 'scope': [name for name, _ in tests], 'omittedChecks': sorted(available - {name for name, _ in tests}) if args.only else [],
          'sourceHashes': before, 'sourceUnchangedDuringVerification': before == source_hashes(),
          'qualification': 'OpenCode handshake uses an isolated config; runtime handshake is not inference or GUI validation.'}
if not report['sourceUnchangedDuringVerification']:
    report['passed'] = False
(out / 'result.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
raise SystemExit(0 if report['passed'] else 1)
