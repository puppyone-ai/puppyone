#!/usr/bin/env python3
"""Run what the release workflows run, on this Mac, before dispatching a release.

    python3 tools/preflight.py              # prepare what is missing, then run everything
    python3 tools/preflight.py --check-env  # only report what the environment lacks

It prepares the same environment Desktop Internal and Stable Release build on
the runner (the pinned toolchain, the product baseline and the reviewed TS
reference checkouts, the verification Python, the pinned native engines), then
runs every release step that needs no signing or publishing credentials:

  1. the release workflows' own tooling tests (policy, updater P0, packaging);
  2. tools/verify.py, every check;
  3. the Electron-to-GPUI update drill;
  4. a dry run of the Internal package, which resolves its release identity.

Every step runs even after an earlier one fails, and the summary lists all
failures. cloud-reference is skipped as on the runners unless
PUPPYONE_VERIFY_SKIP says otherwise.
"""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parent
# The toolchain the release and acceptance workflows install.
RUST = '1.97.1'
LLVM_COV = '0.9.1'
VENV = ROOT / 'target/verification-python'


def output(command, cwd=ROOT, env=None):
    try:
        return subprocess.run(command, cwd=cwd, env=env, text=True, capture_output=True).stdout.strip()
    except FileNotFoundError:
        return ''


def worktrees():
    """Checkouts of this repository by commit, so an existing one is reused."""
    found = {}
    path = None
    for line in output(['git', 'worktree', 'list', '--porcelain']).splitlines():
        if line.startswith('worktree '):
            path = Path(line.removeprefix('worktree '))
        elif line.startswith('HEAD ') and path is not None:
            found.setdefault(line.removeprefix('HEAD '), path)
    return found


class Environment:
    def __init__(self, setup):
        self.setup = setup
        self.problems = []
        self.dirty = []
        self.notes = []
        self.env = dict(os.environ)
        # Rustup's default location, for shells that have not sourced it.
        cargo_bin = Path.home() / '.cargo/bin'
        if cargo_bin.is_dir() and str(cargo_bin) not in self.env['PATH'].split(os.pathsep):
            self.env['PATH'] = f'{cargo_bin}{os.pathsep}{self.env["PATH"]}'

    def problem(self, text, fix=None):
        self.problems.append(text + (f'\n    fix: {fix}' if fix else ''))

    def run(self, command, cwd=ROOT):
        print(f'  $ {" ".join(str(part) for part in command)}', flush=True)
        return subprocess.run(command, cwd=cwd, env=self.env).returncode == 0

    def toolchain(self):
        rustc = output(['rustc', '--version'], env=self.env)
        if f'rustc {RUST} ' not in rustc + ' ':
            self.problem(f'rustc is {rustc or "missing"}; the workflows build with {RUST}',
                         f'rustup toolchain install {RUST} --component rustfmt --component clippy '
                         f'--component llvm-tools-preview && rustup override set {RUST} (in {ROOT})')
        installed = output(['cargo', 'llvm-cov', '--version'], env=self.env)
        if LLVM_COV not in installed:
            if not (self.setup and self.run(['cargo', 'install', 'cargo-llvm-cov', '--version', LLVM_COV, '--locked'])):
                self.problem(f'cargo-llvm-cov {LLVM_COV} is not installed ({installed or "missing"})',
                             f'cargo install cargo-llvm-cov --version {LLVM_COV} --locked')
        oracle = json.loads((ROOT / 'fixtures/ui/number-format-oracle.json').read_text())['icu']
        icu = output(['node', '-p', 'process.versions.icu'], env=self.env)
        if icu != oracle:
            self.problem(f'Node.js has ICU {icu or "missing"}; the number-format oracle was recorded with ICU {oracle}',
                         'use Node.js 22.22.3, as the workflows do')

    def python(self):
        probe = 'import fontTools, brotli, zopfli'
        if subprocess.run(['python3', '-c', probe], env=self.env, capture_output=True).returncode == 0:
            return
        if self.setup and not (VENV / 'bin/python').exists():
            self.run([sys.executable, '-m', 'venv', str(VENV)])
            self.run([str(VENV / 'bin/python'), '-m', 'pip', 'install', '-q', '-r', 'tools/requirements-verification.txt'])
        self.env['PATH'] = f'{VENV / "bin"}{os.pathsep}{self.env["PATH"]}'
        if subprocess.run(['python3', '-c', probe], env=self.env, capture_output=True).returncode:
            self.problem('the verification Python packages are missing',
                         f'{sys.executable} -m venv {VENV} && {VENV}/bin/pip install -r tools/requirements-verification.txt')

    def checkout(self, label, pin, variable, default_name):
        """A checkout of the pinned commit: the configured one, any worktree at it, or a new one."""
        config = json.loads((ROOT / pin).read_text())
        commit = config['commit']
        candidates = [Path(self.env[variable])] if self.env.get(variable) else []
        candidates += [(ROOT / config['checkout']).resolve(), worktrees().get(commit)]
        path = next((path for path in candidates
                     if path and path.is_dir() and output(['git', 'rev-parse', 'HEAD'], cwd=path) == commit), None)
        if path is None and self.setup:
            path = REPO.parent / default_name
            if path.exists() or not self.run(['git', 'worktree', 'add', '--detach', str(path), commit]):
                path = None
        if path is None:
            self.problem(f'no {label} checkout at {commit[:9]} ({pin})',
                         f'git worktree add --detach {REPO.parent / default_name} {commit}')
            return
        if not (path / 'node_modules').exists() and not (self.setup and self.run(['npm', 'ci'], cwd=path)):
            self.problem(f'the {label} checkout {path} has no node_modules', f'npm --prefix {path} ci')
        self.env[variable] = str(path)
        self.notes.append(f'{label}: {path}')

    def repository(self):
        if not (REPO / 'node_modules').exists() and not (self.setup and self.run(['npm', 'ci'], cwd=REPO)):
            self.problem(f'{REPO} has no node_modules (the HTML editor bundle and the release tooling read it)',
                         f'npm --prefix {REPO} ci')
        # A release builds only committed source; the checks still run.
        self.dirty = output(['git', 'status', '--porcelain', '--untracked-files=normal'], cwd=REPO).splitlines()

    def engines(self):
        if not self.setup:
            return
        for command in (['python3', 'tools/fetch-pdfium.py'], ['python3', 'tools/release/package-excalidraw-pack.py']):
            if not self.run(command):
                self.problem(f'{" ".join(command)} failed')

    def prepare(self):
        self.toolchain()
        self.python()
        self.checkout('product baseline', 'product-source.json', 'PUPPYONE_PRODUCT_ROOT',
                      Path(json.loads((ROOT / 'product-source.json').read_text())['checkout']).name)
        self.checkout('TS acceptance reference', 'fixtures/test-parity-reference.json', 'PUPPYONE_PARITY_ROOT',
                      'puppyone-parity-reference')
        self.repository()
        self.engines()
        self.env.setdefault('PUPPYONE_VERIFY_SKIP', 'cloud-reference')


def steps(jobs):
    tests = ['tests/integration/terminal/startup/terminalPreviewLauncher.test.mjs',
             'tests/integration/release/build-identity/desktopReleaseMetadata.test.mjs',
             'tests/integration/release/packaging/packagedDesktopBuildVerifier.test.mjs',
             'tests/architecture/release/build-identity/macosReleasePolicy.test.mjs']
    return [
        ('release workflow policy', ['node', 'scripts/check-macos-release-config.mjs'], REPO),
        ('updater P0 tests', ['npm', 'run', 'test:updater-p0'], REPO),
        ('release tooling tests', ['npm', 'test', '--', *tests], REPO),
        ('verify.py', ['python3', 'tools/verify.py', '--jobs', str(jobs)], ROOT),
        ('Electron-to-GPUI update drill', ['python3', 'tools/release/verify-electron-to-gpui-ota.py'], ROOT),
        ('Internal package dry run', ['python3', 'tools/release/package-macos.py', '--channel', 'internal',
                                      '--build-number', '0', '--dry-run'], ROOT),
    ]


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--check-env', action='store_true', help='report what the environment lacks and stop')
    parser.add_argument('--jobs', type=int, default=min(4, os.cpu_count() or 1), help='passed to verify.py')
    args = parser.parse_args()

    print('Preparing the release environment…', flush=True)
    environment = Environment(setup=not args.check_env)
    environment.prepare()
    for note in environment.notes:
        print(f'  {note}')
    if args.check_env or environment.problems:
        for problem in environment.problems:
            print(f'✗ {problem}')
        if not environment.problems:
            print('Environment ready.')
        return 1 if environment.problems else 0

    env = dict(environment.env,
               # Internal builds pair with the Qubits staging Cloud.
               VITE_DESKTOP_CLOUD_API_URL='https://qubits-api.puppyone.ai/api/v1',
               VITE_DESKTOP_CLOUD_WEB_URL='https://qubits-try.puppyone.ai')
    results = []
    started = time.monotonic()
    for name, command, cwd in steps(args.jobs):
        print(f'\n━━━━ {name}', flush=True)
        begun = time.monotonic()
        code = subprocess.run(command, cwd=cwd, env=env).returncode
        results.append((name, code, time.monotonic() - begun))

    print('\n━━━━ Preflight summary')
    for name, code, seconds in results:
        minutes, rest = divmod(int(seconds), 60)
        print(f'{"✓" if code == 0 else "✗"} {name:<32} {minutes}m{rest:02d}s' + (f'  exit {code}' if code else ''))
    if environment.dirty:
        print('✗ clean source tree: a release builds only committed source')
        for line in environment.dirty[:10]:
            print(f'      {line}')
    failed = [name for name, code, _ in results if code] + (['clean source tree'] if environment.dirty else [])
    total = int(time.monotonic() - started)
    print(f'{len(results) - sum(1 for _, code, _ in results if code)} of {len(results)} steps passed in '
          f'{total // 60}m{total % 60:02d}s.' + (f' Failed: {", ".join(failed)}.' if failed else ' Ready to release.'))
    print(f'verify.py logs: {ROOT / "artifacts/gpui-verification"}')
    return 1 if failed else 0


if __name__ == '__main__':
    raise SystemExit(main())
