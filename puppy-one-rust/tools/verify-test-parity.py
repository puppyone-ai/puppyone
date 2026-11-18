#!/usr/bin/env python3
"""Verify reviewed acceptance rows; inventory is explicitly not whole-product parity."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
from test_runner import ROOT, run_gate
from parity_inventory import case_inventory


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--inventory-only', action='store_true')
    parser.add_argument('--require-complete', action='store_true')
    args = parser.parse_args()
    manifest = json.loads((ROOT / 'fixtures/test-parity-contracts.json').read_text())
    reference = json.loads((ROOT / 'fixtures/test-parity-reference.json').read_text())
    ts = (ROOT / os.environ.get('PUPPYONE_PARITY_ROOT', reference['checkout'])).resolve()
    commit = manifest['referenceCommit']
    assert commit == reference['commit'], 'Oracle and acceptance reference commits disagree'
    assert subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ts, text=True).strip() == commit, 'Review the new TS HEAD before changing the reference'
    # Consume the actual Vitest discovery contract, including its layer and extension sets.
    discovery = ts / 'tests/config/discovery.mjs'
    layers = json.loads(re.search(r'export const testLayers = (\[[^;]+\]);', discovery.read_text())[1])
    extensions = json.loads(re.search(r'export const testExtensions = (\[[^;]+\]);', discovery.read_text())[1])
    files = subprocess.check_output(['git', 'ls-tree', '-r', '--name-only', commit, 'tests'], cwd=ts, text=True).splitlines()
    runtime = [p for p in files if p.split('/')[1] in layers and any(p.endswith('.test.' + e) for e in extensions)]
    auxiliary = [p for p in files if p not in runtime and re.search(r'\.(?:smoke|e2e|bench)\.(?:mjs|ts|tsx)$', p)]
    referenced = set()
    tests = {}
    for row in manifest['contracts']:
        assert row['acceptance'] and row['typescript'] and row['rust'], f'Empty acceptance row: {row}'
        for item in row['typescript']:
            path = item['path']
            assert path in runtime + auxiliary, f'TS test is not discovered: {path}'
            data = (ts / path).read_bytes()
            assert hashlib.sha256(data).hexdigest() == item['sha256'], f'TS acceptance drift: {path}'
            pinned = subprocess.check_output(['git', 'show', f'{commit}:{path}'], cwd=ts)
            assert pinned == data, f'TS acceptance is not the pinned version: {path}'
            referenced.add(path)
        for test in row['rust']:
            tests[(test['package'], test['test'])] = test
    out = ROOT / 'artifacts/test-parity'
    out.mkdir(parents=True, exist_ok=True)
    inventory = {
        'referenceCommit': commit, 'runtimeTestFiles': runtime,
        'auxiliaryTestFiles': auxiliary, 'referencedTestFiles': sorted(referenced),
        'unreviewedTestFiles': sorted(set(runtime + auxiliary) - referenced),
        'qualification': manifest['qualification'], 'openAcceptance': manifest['openAcceptance'],
        'knownDifferences': [{key: item[key] for key in ('id', 'kind', 'reason', 'owner')}
                             for item in manifest.get('knownDifferences', [])],
        'wholeProductParityVerified': False,
    }
    collected = json.loads((out / 'typescript-cases.json').read_text())
    inventory.update(case_inventory(manifest, collected, runtime, auxiliary))
    inventory['unreviewedTestFiles'] = sorted({case['path'] for case in inventory['unreviewedCases']} | set(auxiliary))
    (out / 'inventory.json').write_text(json.dumps(inventory, indent=2) + '\n')
    print(f"{len(runtime)} TS runtime files; {len(auxiliary)} auxiliary entries; {len(manifest['contracts'])} reviewed criteria; {len(tests)} required Rust tests.")
    print(f"{len(inventory['unreviewedTestFiles'])} files are not fully reviewed at case level. Whole-product parity is not verified.")
    print(f"{inventory['reviewedCaseCount']} of {inventory['runtimeCaseCount']} individual cases reviewed; {len(inventory['skippedCases'])} cases skipped by TS environment.")
    print(f"{len(inventory['knownGapCases'])} reviewed cases are known gaps Rust does not meet yet; {len(inventory['outOfScopeCases'])} are out of scope by a recorded decision.")
    passed = True
    if not args.inventory_only:
        report = run_gate('test-parity', list(tests.values()), metadata={
            'contracts': manifest['contracts'], 'referenceCommit': commit,
            'wholeProductParityVerified': False,
        })
        passed = report['passed']
    if args.require_complete and (inventory['unreviewedCases'] or inventory['knownGapCases']
                                  or inventory['unreviewedAuxiliaryFiles'] or inventory['openAcceptance']):
        passed = False
    return 0 if passed else 1


if __name__ == '__main__':
    raise SystemExit(main())
