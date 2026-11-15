#!/usr/bin/env python3
"""Collect production line/branch coverage from a stable, source-bound workspace."""
import argparse
from datetime import datetime, timezone
import importlib.util
import json
import os
from pathlib import Path
import subprocess
from coverage_report import measure, failures
from test_runner import CARGO, ROOT, execute, source_hashes, validate_result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline', type=Path, default=ROOT / 'fixtures/coverage-baseline.json')
    args = parser.parse_args()
    out = ROOT / 'artifacts/coverage'
    out.mkdir(parents=True, exist_ok=True)
    receipt = out / 'result.json'
    receipt.unlink(missing_ok=True)
    before = source_hashes()
    # Keep the same compiler channel and dependency cfgs as the application.
    # RUSTC_BOOTSTRAP only enables LLVM's unstable branch instrumentation.
    # The newer nightly activates unsupported pathfinder_simd intrinsics on ARM.
    env = dict(os.environ, RUSTC_BOOTSTRAP='1')
    compiler = subprocess.check_output([CARGO, '--version'], text=True).strip()
    commands = [
        # LLVM scans matching binaries in the target directory, including old
        # feature/source variants. Remove workspace artifacts as well as profiles
        # before compiling one measured snapshot; keep dependency caches.
        ('clean-workspace', [CARGO, 'llvm-cov', 'clean', '--workspace']),
        ('source-index-tests', [CARGO, 'test', '--locked', '--offline', '--manifest-path', 'tools/source-index/Cargo.toml']),
        ('workspace', [CARGO, 'llvm-cov', '--branch', '--locked', '--offline', '--workspace', '--features', 'dev-capture', '--no-fail-fast', '--no-report', '--', '--test-threads=4']),
    ]
    native = importlib.util.spec_from_file_location('native', ROOT / 'tools/verify-native-dependencies.py')
    module = importlib.util.module_from_spec(native)
    native.loader.exec_module(module)
    required = [*module.CHECKS, ('po-agent', 'agent::runtimes::puppyone_agent::native_kernel::tests::native_puppyone_http_approval_resume_stop_and_binding')]
    checks = []
    for name, command in commands:
        print(f'Coverage: {name}', flush=True)
        code, output = execute(command, env=env, timeout=1800)
        (out / f'{name}.log').write_text(output)
        checks.append({'name': name, 'exit': code, 'passed': code == 0})
    for index, (package, test) in enumerate(required):
        code, output = execute([CARGO, 'llvm-cov', 'test', '--branch', '--no-report', '--locked', '--offline', '-p', package, '--features', 'dev-capture', test, '--', '--exact', '--include-ignored', '--test-threads=1'], env=env, timeout=300)
        (out / f'native-{index}.log').write_text(output)
        error = validate_result(test, code, output)
        checks.append({'name': test, 'exit': code, 'passed': error is None, 'error': error})
        print(f'Coverage: {test}: {error or "passed"}', flush=True)
    code, output = execute([CARGO, 'run', '--locked', '--offline', '--manifest-path', 'tools/source-index/Cargo.toml', '--', str(ROOT)], timeout=120)
    # Cargo's build messages go to the shared output stream; the JSON begins
    # on its own line after that diagnostic prefix.
    start = output.find('\n{')
    index = json.loads(output[start + 1:] if start >= 0 else output)
    if code:
        raise RuntimeError('AST source inventory failed')
    (out / 'source-index.json').write_text(json.dumps(index, indent=2) + '\n')
    lcov = out / 'workspace.lcov'
    lcov.unlink(missing_ok=True)
    code, output = execute([CARGO, 'llvm-cov', 'report', '--workspace', '--lcov', '--output-path', str(lcov)], env=env, timeout=300)
    (out / 'export.log').write_text(output)
    if code:
        raise RuntimeError('LLVM coverage export failed')
    report = measure(lcov.read_text(), index, ROOT)
    baseline = json.loads(args.baseline.read_text())
    errors = failures(report, baseline)
    unchanged = source_hashes() == before
    report.update(compiler=compiler, checks=checks, sourceHashes=before,
                  sourceUnchangedDuringVerification=unchanged,
                  capturedAt=datetime.now(timezone.utc).isoformat(), thresholdFailures=errors,
                  passed=unchanged and all(check['passed'] for check in checks) and not errors)
    receipt.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report['domains'], indent=2))
    for error in errors:
        print(error)
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
