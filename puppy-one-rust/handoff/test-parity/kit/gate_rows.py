#!/usr/bin/env python3
"""Run the exact-test gate for selected acceptance rows.

usage: gate_rows.py GATE_NAME [--changed] [ROW_ID ...]
  --changed  rows whose content differs from HEAD's manifest (new or edited)
Runs from the Rust project root given by $PARITY_RUST_ROOT (default: the
test-completeness worktree), through tools/test_runner.run_gate.
"""
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(os.environ.get('PARITY_RUST_ROOT',
                           Path.home() / 'project/puppyone-rust-test-completeness/puppy-one-rust'))
sys.path.insert(0, str(ROOT / 'tools'))
os.chdir(ROOT)
from test_runner import run_gate  # noqa: E402


def main():
    args = sys.argv[1:]
    if not args:
        raise SystemExit(__doc__)
    gate, rest = args[0], args[1:]
    manifest = json.loads((ROOT / 'fixtures/test-parity-contracts.json').read_text())
    rows = {row['id']: row for row in manifest['contracts']}
    wanted = [r for r in rest if r != '--changed']
    if '--changed' in rest:
        head = json.loads(subprocess.check_output(
            ['git', 'show', 'HEAD:puppy-one-rust/fixtures/test-parity-contracts.json'], cwd=ROOT))
        old = {row['id']: row for row in head['contracts']}
        wanted += [i for i, row in rows.items() if old.get(i) != row and i not in wanted]
    missing = [i for i in wanted if i not in rows]
    if missing:
        raise SystemExit(f'unknown rows: {missing}')
    tests = {}
    for i in wanted:
        for test in rows[i]['rust']:
            tests[(test['package'], test.get('target'), test['test'], test.get('python'))] = test
    print(f'{len(wanted)} rows, {len(tests)} exact tests', flush=True)
    report = run_gate(gate, list(tests.values()), metadata={'rows': wanted})
    failed = [c for c in report['checks'] if not c['passed']]
    for c in failed:
        print('FAILED', c['test'], c['error'])
    print('passed' if report['passed'] else 'FAILED', f"{len(report['checks']) - len(failed)}/{len(report['checks'])}")
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
