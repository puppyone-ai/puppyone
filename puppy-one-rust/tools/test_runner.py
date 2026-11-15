"""Strict libtest execution shared by native acceptance gates.

A successful exit alone is insufficient: every required, fully qualified test
must be discovered exactly once and actually pass, including ignored tests.
"""
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import tempfile
from source_identity import source_hashes

ROOT = Path(__file__).resolve().parents[1]
CARGO = shutil.which('cargo') or str(Path.home() / '.cargo/bin/cargo')


@contextmanager
def isolated_test_environment(overrides=None):
    """Libtest never inherits the user's writable application profile.

    A gate may explicitly supply its own isolated profile (runtime acceptance
    does this); otherwise each exact test gets a fresh, disposable directory.
    """
    env = dict(os.environ)
    env.update(overrides or {})
    if overrides is not None and 'PUPPYONE_RUST_DATA_DIR' in overrides:
        yield env
    else:
        with tempfile.TemporaryDirectory(prefix='puppyone-libtest-') as directory:
            yield dict(env, PUPPYONE_RUST_DATA_DIR=directory)


def outcomes(output):
    return re.findall(r'^test (\S+) \.\.\. (ok|FAILED|ignored)(?:[^\n]*)$', output, re.M)


def validate_result(name, code, output):
    rows = outcomes(output)
    if code != 0:
        return f'exit {code}'
    if rows != [(name, 'ok')]:
        return f'expected exactly one passing test {name}; observed {rows}'
    if not re.search(r'test result: ok\. 1 passed; 0 failed; 0 ignored;', output):
        return 'missing successful nonempty libtest summary'
    return None


def execute(command, *, env=None, timeout=240):
    process = subprocess.Popen(command, cwd=ROOT, env=env, text=True,
                               stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                               start_new_session=True)
    try:
        output, _ = process.communicate(timeout=timeout)
        return process.returncode, output
    except subprocess.TimeoutExpired:
        # A timed-out test can own CLI children that inherit its output pipe.
        # Kill the group, then drain it; killing only libtest leaves them behind.
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        output, _ = process.communicate()
        return 124, output + '\nVerification timed out.\n'


def run_gate(name, required, *, env=None, metadata=None):
    out = ROOT / 'artifacts' / name
    out.mkdir(parents=True, exist_ok=True)
    receipt = out / 'result.json'
    receipt.unlink(missing_ok=True)
    before = source_hashes()
    checks = []
    packages = sorted({item['package'] for item in required})
    command = [CARGO, 'test', '--locked', '--offline', '--no-run', '--message-format=json']
    for package in packages:
        command += ['-p', package]
    code, output = execute(command, env=env, timeout=1200)
    (out / 'build.log').write_text(output)
    binaries = {}
    if code == 0:
        for line in output.splitlines():
            if not line.startswith('{'):
                continue
            row = json.loads(line)
            if row.get('reason') == 'compiler-artifact' and row.get('profile', {}).get('test') and row.get('executable'):
                binaries[row['target']['name']] = row['executable']
    listings = {}
    binary_hashes = {}
    for target, binary in binaries.items():
        binary_hashes[target] = hashlib.sha256(Path(binary).read_bytes()).hexdigest()
        listed, content = execute([binary, '--list', '--format=terse'], env=env)
        if listed == 0:
            listings[target] = re.findall(r'^(\S+): test$', content, re.M)
    for index, item in enumerate(required):
        test = item['test']
        target = item.get('target', item['package'].replace('-', '_'))
        error = None
        if code:
            error = f'build failed: exit {code}'
        elif listings.get(target, []).count(test) != 1:
            error = f'required test not discovered exactly once in {target}: {test}'
        if error:
            result_code, content = 1, error + '\n'
        else:
            with isolated_test_environment(env) as test_env:
                result_code, content = execute([binaries[target], test, '--exact', '--include-ignored',
                                                '--test-threads=1', '--color=never'], env=test_env,
                                               timeout=item.get('timeout', 240))
            error = validate_result(test, result_code, content)
        log = f'{index:02d}-{test.split("::")[-1]}.log'
        (out / log).write_text(content)
        checks.append({**item, 'exit': result_code, 'passed': error is None, 'error': error, 'log': log})
        print(f'{test}: {error or "passed"}', flush=True)
    unchanged = before == source_hashes()
    report = {'capturedAt': datetime.now(timezone.utc).isoformat(),
              'passed': bool(checks) and all(c['passed'] for c in checks) and unchanged,
              'checks': checks, 'sourceHashes': before,
              'binaryHashes': binary_hashes,
              'sourceUnchangedDuringVerification': unchanged,
              'testDataIsolation': 'temporary-per-test-unless-explicit', **(metadata or {})}
    receipt.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    return report
