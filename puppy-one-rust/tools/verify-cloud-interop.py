#!/usr/bin/env python3
"""Real bidirectional TS/Rust Host acceptance with disposable Cloud devices.

Uses the acceptance test account, never sends email or purchases a plan. The
TypeScript Host uses a test-only key store; this is not OS-keychain/UI evidence.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
from source_identity import source_hashes
from test_runner import ROOT, CARGO, execute, run_gate

PREFIX = 'workspace::hosts::acceptance::'
SCRIPT = ROOT / 'tools/cloud-interop.mjs'


def reference_state(root, commit):
    actual = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
    if actual != commit:
        raise ValueError('TS Host interop requires the pinned parity reference commit')
    if subprocess.run(['git', 'diff', '--quiet', 'HEAD', '--'], cwd=root).returncode:
        raise ValueError('TS Host interop requires unchanged tracked reference sources')
    return subprocess.check_output(['git', 'rev-parse', 'HEAD^{tree}'], cwd=root, text=True).strip()


def reference_unchanged(root, commit, tree):
    try:
        return reference_state(root, commit) == tree
    except (ValueError, OSError, subprocess.SubprocessError):
        return False


def built_workspace_binary(output):
    binaries = set()
    for line in output.splitlines():
        if not line.startswith('{'):
            continue
        row = json.loads(line)
        if (row.get('reason') == 'compiler-artifact' and row.get('profile', {}).get('test')
                and row.get('target', {}).get('name') == 'po_workspace' and row.get('executable')):
            binaries.add(row['executable'])
    if len(binaries) != 1:
        raise ValueError('Expected exactly one built po_workspace test executable')
    return Path(binaries.pop())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--only', action='append', choices=['rust-host', 'typescript-host'])
    args = parser.parse_args()
    scope = list(dict.fromkeys(args.only or ['rust-host', 'typescript-host']))
    for direction in scope:
        name = 'cloud-interop-rust-host' if direction == 'rust-host' else 'cloud-interop-ts-host'
        (ROOT / 'artifacts' / name / 'result.json').unlink(missing_ok=True)
    reference = json.loads((ROOT / 'fixtures/test-parity-reference.json').read_text())
    ts = (ROOT / os.environ.get('PUPPYONE_PARITY_ROOT', reference['checkout'])).resolve()
    tree = reference_state(ts, reference['commit'])
    node = shutil.which('node')
    if not node:
        parser.error('Node is required for the real TypeScript Host')
    env = dict(os.environ, PUPPYONE_PARITY_ROOT=str(ts), ACCEPT_TS_ACCESS=str(SCRIPT))
    metadata = {
        'typescriptReference': reference['commit'], 'typescriptTree': tree,
        'scriptSha256': hashlib.sha256(SCRIPT.read_bytes()).hexdigest(),
        'qualification': 'Real deployment cross-language SSH/file acceptance. Disposable devices require cleanup. Password grant and test-only secure storage; no GUI, email, payment or production OS keychain certification.',
    }
    passed = True
    if 'rust-host' in scope:
        result = run_gate('cloud-interop-rust-host', [dict(package='po-workspace',
            test=PREFIX + 'a_folder_this_host_shares_opens_from_typescript', timeout=600)],
            env=env, metadata=metadata)
        unchanged = reference_unchanged(ts, reference['commit'], tree)
        result['typescriptUnchangedDuringVerification'] = unchanged
        result['passed'] = result['passed'] and unchanged
        (ROOT / 'artifacts/cloud-interop-rust-host/result.json').write_text(json.dumps(result, indent=2) + '\n')
        passed = passed and result['passed']
    if 'typescript-host' in scope:
        out = ROOT / 'artifacts/cloud-interop-ts-host'
        out.mkdir(parents=True, exist_ok=True)
        receipt = out / 'result.json'
        receipt.unlink(missing_ok=True)
        before = source_hashes()
        code, output = execute([CARGO, 'test', '--locked', '--offline', '--no-run',
                                '-p', 'po-workspace', '--message-format=json'], env=env, timeout=1200)
        (out / 'build.log').write_text(output)
        binary_hash = None
        error = None
        try:
            if code:
                raise ValueError(f'Rust interop test build failed: exit {code}')
            binary = built_workspace_binary(output)
            binary_hash = hashlib.sha256(binary.read_bytes()).hexdigest()
            listed, names = execute([str(binary), '--list', '--format=terse'], env=env)
            name = PREFIX + 'a_folder_a_typescript_host_shares_opens_here'
            if listed or names.splitlines().count(name + ': test') != 1:
                raise ValueError('Required Rust access-side test is not discovered exactly once')
            code, output = execute([node, str(SCRIPT), '--host', str(binary)], env=env, timeout=600)
            (out / 'interop.log').write_text(output)
            if code:
                raise ValueError(f'TS Host interop failed: exit {code}')
            rows = [json.loads(line) for line in output.splitlines() if line.startswith('{')]
            if len(rows) != 1 or rows[0].get('ok') is not True or rows[0].get('direction') != 'TS Host to Rust access':
                raise ValueError('Missing exact successful TS Host interop receipt')
        except (ValueError, OSError) as failure:
            error = str(failure)
        unchanged = before == source_hashes()
        ts_unchanged = reference_unchanged(ts, reference['commit'], tree)
        result = dict(capturedAt=datetime.now(timezone.utc).isoformat(), passed=error is None and unchanged and ts_unchanged,
                      exit=code, error=error, sourceHashes=before, sourceUnchangedDuringVerification=unchanged,
                      typescriptUnchangedDuringVerification=ts_unchanged, binarySha256=binary_hash, **metadata)
        receipt.write_text(json.dumps(result, indent=2) + '\n')
        print('TypeScript Host to Rust access: ' + ('passed' if result['passed'] else str(error or 'source changed')), flush=True)
        passed = passed and result['passed']
    return 0 if passed else 1


if __name__ == '__main__':
    raise SystemExit(main())
