#!/usr/bin/env python3
"""Reproducible migration checks, including isolated offscreen native fixtures.

Every check runs, even after one fails, and the summary lists all failures
with their logs. Checks run side by side in two lanes: quick source and
oracle checks share a small pool while the checks that build or run Rust go
one at a time (they compete for the same cores and Cargo locks). The editor
frame benchmark runs last, alone, because its budgets measure time.

    python3 tools/verify.py                     # everything; writes the receipt when all pass
    python3 tools/verify.py --only clippy,fmt   # rerun a few after a fix; no receipt
    python3 tools/verify.py --list              # the checks and their lanes
"""
import argparse
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import time
from source_identity import source_hashes

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'artifacts/gpui-verification'
CARGO = shutil.which('cargo') or str(Path.home() / '.cargo/bin/cargo')

# (name, command, lane, checks it reads the output of). Lanes: `light` checks
# read sources and oracles; `cargo` checks build or run Rust; `alone` checks
# measure time and wait until nothing else runs.
CHECKS = [
    ('fmt', [CARGO, 'fmt', '--all', '--check'], 'light', ()),
    ('boundaries', ['python3', 'tools/check-ui-boundaries.py'], 'light', ()),
    ('test-runner', ['python3', '-B', '-m', 'unittest', 'discover', '-s', 'tools', '-p', 'test_*.py'], 'light', ()),
    ('test-parity-reference', ['node', 'tools/reference-test-parity.mjs', '--check'], 'light', ()),
    ('test-parity-cases', ['node', 'tools/collect-test-cases.mjs'], 'light', ()),
    ('viewer-pack', ['python3', '-B', 'tools/verify-viewer-pack.py'], 'cargo', ()),
    ('test-parity-contracts', ['python3', '-B', 'tools/verify-test-parity.py'], 'cargo', ('test-parity-cases',)),
    ('filesystem-case-sensitivity', ['python3', '-B', 'tools/verify-filesystem-case-sensitivity.py'], 'cargo', ()),
    ('managed-installer-interop', ['python3', '-B', 'tools/verify-managed-installer-interop.py'], 'cargo', ()),
    ('product-layers', ['python3', 'tools/audit-product-layers.py'], 'light', ()),
    ('auth-reference', ['python3', 'tools/check-auth-reference.py'], 'light', ()),
    ('cloud-reference', ['python3', 'tools/check-cloud-reference.py'], 'light', ()),
    ('editor-workbench-reference', ['node', 'tools/reference-editor-workbench.mjs', '--check'], 'light', ()),
    ('navigation-reference', ['node', 'tools/reference-navigation.mjs', '--check'], 'light', ()),
    ('code-reference', ['node', 'tools/reference-code.mjs', '--check'], 'light', ()),
    ('localization', ['python3', 'tools/import-localization.py', '--check'], 'light', ()),
    ('native-vocabulary', ['node', 'tools/check-native-vocabulary.mjs'], 'light', ()),
    ('number-format', ['node', 'tools/reference-number-format.mjs', '--check'], 'light', ()),
    ('assets', ['python3', 'tools/generate-assets-rs.py', '--check'], 'light', ()),
    ('agent-marks', ['python3', 'tools/import-agent-marks.py', '--check'], 'light', ()),
    ('ui-assets', ['node', 'tools/import-ui-assets.mjs', '--check'], 'light', ()),
    ('formats', ['python3', 'tools/import-formats.py', '--check'], 'light', ()),
    ('templates', ['python3', 'tools/import-templates.py', '--check'], 'light', ()),
    ('theme-contract', ['node', 'tools/import-theme-contract.mjs', '--check'], 'light', ()),
    ('file-icons', ['node', 'tools/import-file-icons.mjs', '--check'], 'light', ()),
    ('integration-marks', ['python3', 'tools/import-integration-marks.py', '--check'], 'light', ()),
    ('release-assets', ['python3', 'tools/import-release-assets.py', '--check'], 'light', ()),
    ('release-tools', ['python3', '-B', '-m', 'unittest', 'discover', '-s', 'tools/release'], 'light', ()),
    ('html-visual', ['node', 'tools/import-html-visual.mjs', '--check'], 'light', ()),
    ('office-viewer', ['node', 'tools/import-office-viewer.mjs', '--check'], 'light', ()),
    ('structured-viewers', ['node', 'tools/import-structured-viewers.mjs', '--check'], 'light', ()),
    ('excalidraw', ['node', 'tools/import-excalidraw.mjs', '--check'], 'light', ()),
    ('render-service', ['node', 'tools/import-render-service.mjs', '--check'], 'light', ()),
    ('document-defaults', ['node', 'tools/import-document-defaults.mjs', '--check'], 'light', ()),
    ('document-fonts', ['python3', 'tools/import-document-fonts.py', '--check'], 'light', ()),
    ('app-preview', ['node', 'tools/import-app-preview.mjs', '--check'], 'light', ()),
    ('terminal-glyphs', ['node', 'tools/import-xterm-glyphs.mjs', '--check'], 'light', ()),
    ('ui-migration', ['python3', 'tools/audit-ui-migration.py'], 'light', ()),
    ('coverage', ['python3', '-B', 'tools/verify-coverage.py'], 'cargo', ()),
    ('clippy', [CARGO, 'clippy', '--locked', '--workspace', '--all-targets', '--features', 'dev-capture', '--', '-D', 'warnings'], 'cargo', ()),
    ('release', [CARGO, 'build', '--locked', '--release'], 'cargo', ()),
    ('editor-frames', ['python3', 'tools/bench-editor.py', '--check', '--repeat', '3'], 'alone', ()),
    ('native-editor', ['python3', 'tools/verify-native-editor.py'], 'cargo', ()),
]
# The order the `cargo` lane takes: quick builds first, so test-parity-cases
# (light lane, several minutes of Node) has finished before its reader starts.
CARGO_ORDER = ['clippy', 'managed-installer-interop', 'viewer-pack', 'filesystem-case-sensitivity',
               'test-parity-contracts', 'native-editor', 'coverage', 'release']


def schedule(checks, light_slots, serial=False):
    """Yield batches of checks that may start now, given what finished.

    A generator protocol keeps the policy testable without processes: send
    it the names that finished since the last batch.
    """
    pending = list(checks)
    running = set()
    finished = set()
    lanes = {name: lane for name, _, lane, _ in checks}
    while pending or running:
        ready = []
        for check in list(pending):
            name, _, lane, needs = check
            # Running includes what this batch already started.
            busy = [lanes[other] for other in running]
            if serial:
                allowed = not busy
            elif lane == 'alone':
                # Everything else first, then this one by itself.
                allowed = not busy and all(other[2] == 'alone' for other in pending)
            elif lane == 'cargo':
                allowed = 'cargo' not in busy and 'alone' not in busy
            else:
                allowed = 'alone' not in busy and busy.count('light') < light_slots
            if allowed and all(dependency in finished or dependency not in lanes for dependency in needs):
                ready.append(check)
                pending.remove(check)
                running.add(name)
        done = yield ready
        for name in done or ():
            running.discard(name)
            finished.add(name)


def ordered(checks):
    """Light checks as listed, then the cargo lane in CARGO_ORDER, then the timed ones."""
    rank = {name: index for index, name in enumerate(CARGO_ORDER)}
    return ([check for check in checks if check[2] == 'light']
            + sorted((check for check in checks if check[2] == 'cargo'), key=lambda check: rank[check[0]])
            + [check for check in checks if check[2] == 'alone'])


def run(check):
    name, command, _, _ = check
    started = time.monotonic()
    with (OUT / f'{name}.log').open('w') as log:
        code = subprocess.run(command, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT).returncode
    return {'name': name, 'exit': code, 'seconds': round(time.monotonic() - started, 1)}


def duration(seconds):
    minutes, seconds = divmod(int(seconds), 60)
    return f'{minutes}m{seconds:02d}s' if minutes else f'{seconds}s'


FAILURE_LINE = re.compile(r'FAILED|panicked|[Ee]rror|: exit \d|timed out|not discovered|exceeded')


def excerpt(name, flagged=30, last=40):
    """The log lines that name a failure, then the end of the log.

    A gate that runs thousands of tests prints the one that failed long
    before its last line."""
    text = (OUT / f'{name}.log').read_text(errors='replace').rstrip('\n').splitlines()
    failures = [line for line in text[:-last] if FAILURE_LINE.search(line)]
    shown = failures[:flagged] + ([f'… {len(failures) - flagged} more'] if len(failures) > flagged else [])
    return '\n'.join(shown + (['…'] if shown else []) + text[-last:])


def dependency_tree():
    tree = subprocess.check_output([CARGO, 'tree', '--locked'], cwd=ROOT, text=True)
    (OUT / 'dependencies.txt').write_text(tree)
    problems = []
    if 'gpui-kit v0.8.0' not in tree or 'gpui v0.2.2' in tree:
        problems.append('the app must build on gpui-kit 0.8.0 and not gpui 0.2.2')
    if 'gpui-pre v0.3.9' not in tree:
        problems.append('the app must build on gpui-pre 0.3.9')
    for name in ['egui v', 'eframe v', 'gpui-kit-markdown-editor v']:
        if name in tree:
            problems.append(f'retired dependency in the tree: {name.strip()}')
    return problems


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--only', help='comma-separated checks to run; no receipt is written')
    parser.add_argument('--jobs', type=int, default=min(4, os.cpu_count() or 1),
                        help='light checks that may run at once (default: up to 4)')
    parser.add_argument('--serial', action='store_true', help='one check at a time, in the listed order')
    parser.add_argument('--list', action='store_true', help='print the checks and their lanes')
    args = parser.parse_args()

    names = {name for name, _, _, _ in CHECKS}
    if args.list:
        for name, _, lane, needs in ordered(CHECKS):
            print(f'{name:<30}{lane:<7}{", ".join(needs)}')
        return 0
    # A release runner without a sibling repository a check reads (the Cloud
    # backend for cloud-reference) names that check here; the receipt keeps it.
    skipped = sorted(filter(None, os.environ.get('PUPPYONE_VERIFY_SKIP', '').split(',')))
    only = sorted(filter(None, (args.only or '').split(',')))
    for label, chosen in (('PUPPYONE_VERIFY_SKIP', skipped), ('--only', only)):
        if set(chosen) - names:
            raise SystemExit(f'{label} names no such check: {", ".join(sorted(set(chosen) - names))}')

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / 'result.json').unlink(missing_ok=True)
    verified_sources = source_hashes()
    selected = [check for check in ordered(CHECKS)
                if check[0] not in skipped and (not only or check[0] in only)]
    for name in skipped:
        print(f'Skipping {name} (PUPPYONE_VERIFY_SKIP).', flush=True)

    started = time.monotonic()
    results = {}
    plan = schedule(selected, max(args.jobs, 1), serial=args.serial)
    batch = next(plan)
    with ThreadPoolExecutor(max_workers=max(args.jobs, 1) + 1) as pool:
        running = {}
        while batch is not None:
            for check in batch:
                print(f'Checking {check[0]}…', flush=True)
                running[pool.submit(run, check)] = check[0]
            if not running:
                break
            finished, _ = wait(running, return_when=FIRST_COMPLETED)
            names_done = []
            for future in finished:
                result = future.result()
                results[result['name']] = result
                names_done.append(running.pop(future))
                mark = 'passed' if result['exit'] == 0 else f'FAILED (exit {result["exit"]})'
                print(f'{result["name"]}: {mark} in {duration(result["seconds"])}', flush=True)
            try:
                batch = plan.send(names_done)
            except StopIteration:
                batch = None

    checks = [results[name] for name, _, _, _ in CHECKS if name in results]
    failed = [check for check in checks if check['exit']]
    needs = {name: dependencies for name, _, _, dependencies in CHECKS}
    for check in failed:
        upstream = [name for name in needs[check['name']] if results.get(name, {}).get('exit')]
        if upstream:
            check['afterFailed'] = upstream
    problems = dependency_tree() if not only else []
    unchanged = source_hashes() == verified_sources
    summary = {
        'passed': not failed and not problems and unchanged,
        'complete': not only,
        'seconds': round(time.monotonic() - started, 1),
        'checks': checks, 'skipped': skipped, 'dependencyProblems': problems,
        'sourceUnchangedDuringVerification': unchanged,
    }
    (OUT / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n')

    for check in failed:
        print(f'\n──── {check["name"]} (exit {check["exit"]}) · {OUT / (check["name"] + ".log")}')
        print(excerpt(check['name']))
    print(f'\n{len(checks) - len(failed)} of {len(checks)} checks passed in {duration(summary["seconds"])}'
          + (f'; {len(skipped)} skipped' if skipped else '') + '.')
    if failed:
        print('Failed: ' + ', '.join(check['name'] + (f' (after {", ".join(check["afterFailed"])} failed)'
                                                       if check.get('afterFailed') else '')
                                     for check in failed))
    for problem in problems:
        print(f'Dependency tree: {problem}')
    if not unchanged:
        print('Local implementation changed during verification; rerun against one stable source snapshot.')
    if not summary['passed']:
        return 1
    if only:
        print('Selected checks passed. Run every check to write the release receipt.')
        return 0

    receipt = {
        'framework': 'gpui-kit 0.8.0 / gpui-pre 0.3.9', 'passed': True,
        'verifiedAt': datetime.now().astimezone().isoformat(),
        'platform': platform.platform(), 'checks': checks, 'skipped': skipped,
        'baseCommit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
        'implementation': 'puppy-one-rust at baseCommit; sourceHashes record the verified files, including uncommitted changes',
        'sourceUnchangedDuringVerification': True,
        'sourceHashes': verified_sources,
        'releaseBinarySha256': None if 'release' in skipped else hashlib.sha256((Path(json.loads(
            subprocess.check_output([CARGO, 'metadata', '--locked', '--offline', '--no-deps', '--format-version=1'],
                                    cwd=ROOT, text=True))['target_directory']) / 'release/puppy-one-rust').read_bytes()).hexdigest(),
    }
    (OUT / 'result.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + '\n')
    print('GPUI verification passed.', flush=True)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
