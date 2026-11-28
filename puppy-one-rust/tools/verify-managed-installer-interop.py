#!/usr/bin/env python3
"""Real TS/Rust installer processes sharing disposable homes; no network or user CLI."""
import argparse
from datetime import datetime, timezone
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import tarfile
import tempfile
import time
from source_identity import ROOT, source_hashes


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'artifacts/managed-installer-interop')
    args = parser.parse_args()
    out = args.output.resolve()
    out.mkdir(parents=True, exist_ok=True)
    (out / 'result.json').unlink(missing_ok=True)
    before = source_hashes()
    pinned = json.loads((ROOT / 'fixtures/test-parity-reference.json').read_text())
    reference = (ROOT / os.environ.get('PUPPYONE_PARITY_ROOT', pinned['checkout'])).resolve()
    actual = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=reference, text=True).strip()
    assert actual == pinned['commit'], 'Select the frozen TS checkout with PUPPYONE_PARITY_ROOT'
    for name in ['electron/main/local-agent-activation/managed-artifact-installer.mjs', 'package-lock.json']:
        assert hashlib.sha256((reference / name).read_bytes()).hexdigest() == pinned['inputs'][name], name
    cargo = shutil.which('cargo') or str(Path.home() / '.cargo/bin/cargo')
    node = shutil.which('node') or str(Path.home() / '.local/bin/node')
    with (out / 'build.log').open('w') as log:
        subprocess.run([cargo, 'build', '--locked', '--offline', '-p', 'po-platform',
                        '--example', 'managed_installer_fixture'], cwd=ROOT, check=True,
                       stdout=log, stderr=subprocess.STDOUT, timeout=1200)
    metadata = json.loads(subprocess.check_output([cargo, 'metadata', '--locked', '--offline',
                         '--no-deps', '--format-version=1'], cwd=ROOT, text=True))
    binary = Path(metadata['target_directory']) / 'debug/examples/managed_installer_fixture'
    checks = []
    children = []
    serial = 0

    class Child:
        def __init__(self, language, home, archive, hold):
            nonlocal serial
            serial += 1
            self.name = f'{serial:02d}-{language}'
            self.control = home.parent / self.name
            self.control.mkdir()
            config = self.control / 'config.json'
            config.write_text(json.dumps(dict(home=str(home), archive=str(archive),
                                             control=str(self.control), hold=hold)))
            command = [str(binary), str(config)] if language == 'rust' else [
                node, str(ROOT / 'tools/fixtures/managed-installer-interop.mjs'), str(reference), str(config)]
            environment = {key: value for key, value in os.environ.items()
                           if key in {'PATH', 'TMPDIR', 'SystemRoot'}}
            environment.update(HOME=str(home), LANG='C', PUPPYONE_RUST_DATA_DIR=str(home / 'app-data'))
            self.log = out / f'{self.name}.log'
            with self.log.open('w') as log:
                self.process = subprocess.Popen(command, cwd=ROOT, env=environment,
                                                stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
            children.append(self)

        def ready(self):
            deadline = time.monotonic() + 8
            while not (self.control / 'ready').exists():
                assert self.process.poll() is None, self.log.read_text()
                assert time.monotonic() < deadline, f'{self.name} did not enter its real lease'
                time.sleep(.01)

        def send(self, name):
            (self.control / name).touch()

        def result(self, expected, downloads=None, commits=None):
            self.process.wait(timeout=25)
            content = self.log.read_text()
            assert self.process.returncode == 0, content
            lines = [line for line in content.splitlines() if line.startswith('{')]
            assert len(lines) == 1, content
            result = json.loads(lines[0])
            assert result['status'] == expected, (self.name, result, expected)
            if downloads is not None:
                assert result['downloads'] == downloads, (self.name, result)
            if commits is not None:
                assert result['commits'] == commits, (self.name, result)
            return result

        def close(self):
            if self.process.poll() is not None:
                return
            self.send('cancel')
            try:
                self.process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(self.process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                self.process.wait(timeout=3)

    def installed(home):
        root = home / '.puppyone/agent-runtimes/codex'
        assert not (root / 'install.lock').exists()
        assert sorted(entry.name for entry in root.iterdir()) == ['current', 'interop-1']
        assert os.readlink(root / 'current') == 'interop-1'
        assert (root / 'current/codex').read_bytes() == b'fixture binary'
        receipt = json.loads((root / 'interop-1/installation.json').read_text())
        assert receipt == dict(version='interop-1', digest='interop-fixture-digest',
                               source='https://registry.npmjs.org/interop-fixture.tgz')

    def cancelled(home):
        root = home / '.puppyone/agent-runtimes/codex'
        assert list(root.iterdir()) == [], 'cancelled installation left a lease, staging, or committed payload'

    def identity(lock):
        stat = lock.stat()
        return stat.st_dev, stat.st_ino

    with tempfile.TemporaryDirectory(prefix='puppyone-installer-interop-') as temporary:
        directory = Path(temporary).resolve()
        archive = directory / 'fixture.tgz'
        with tarfile.open(archive, 'w:gz') as stream:
            header = tarfile.TarInfo('package/codex')
            header.mode = 0o755
            header.size = len(b'fixture binary')
            stream.addfile(header, io.BytesIO(b'fixture binary'))

        def home_for(case):
            home = directory / case / 'home'
            home.mkdir(parents=True)
            (home / '.interop-fixture').touch()
            return home

        try:
            for owner_language, contender_language in [('rust', 'typescript'), ('typescript', 'rust')]:
                case = f'{owner_language}-owner-excludes-{contender_language}-and-shares-committed-receipt'
                home = home_for(case)
                lock = home / '.puppyone/agent-runtimes/codex/install.lock'
                owner = Child(owner_language, home, archive, True)
                owner.ready()
                original = identity(lock)
                contender = Child(contender_language, home, archive, False)
                contender.result('installation-busy', downloads=0, commits=0)
                assert identity(lock) == original
                owner.send('release')
                owner.result('installed', downloads=1, commits=1)
                installed(home)
                reuse = Child(contender_language, home, archive, False)
                reuse.result('installed', downloads=0, commits=1)
                installed(home)
                checks.append(dict(name=case, passed=True))
                print(case + ': passed', flush=True)

                case = f'{owner_language}-cancellation-allows-{contender_language}-to-install'
                home = home_for(case)
                owner = Child(owner_language, home, archive, True)
                owner.ready()
                owner.send('cancel')
                owner.result('interrupted', downloads=1, commits=0)
                cancelled(home)
                replacement = Child(contender_language, home, archive, False)
                replacement.result('installed', downloads=1, commits=1)
                installed(home)
                checks.append(dict(name=case, passed=True))
                print(case + ': passed', flush=True)

                case = f'{owner_language}-lost-lease-cannot-remove-{contender_language}-replacement'
                home = home_for(case)
                lock = home / '.puppyone/agent-runtimes/codex/install.lock'
                owner = Child(owner_language, home, archive, True)
                owner.ready()
                # Only this fixture's lock is replaced. A distinct process must
                # own the replacement before the first owner observes its loss.
                lock.rmdir()
                replacement = Child(contender_language, home, archive, True)
                replacement.ready()
                replacement_identity = identity(lock)
                owner.result('installation-busy', downloads=1, commits=0)
                assert replacement.process.poll() is None
                assert identity(lock) == replacement_identity, 'retired owner removed a replacement lease'
                replacement.send('release')
                replacement.result('installed', downloads=1, commits=1)
                installed(home)
                checks.append(dict(name=case, passed=True))
                print(case + ': passed', flush=True)

            case = 'simultaneous-mixed-processes-admit-exactly-one-owner'
            home = home_for(case)
            racers = [Child(language, home, archive, True)
                      for language in ['rust', 'typescript'] * 4]
            deadline = time.monotonic() + 8
            while True:
                owners = [child for child in racers if (child.control / 'ready').exists()]
                if owners:
                    break
                assert time.monotonic() < deadline, 'no concurrent installer acquired the lease'
                time.sleep(.01)
            assert len(owners) == 1
            owner = owners[0]
            for contender in racers:
                if contender is not owner:
                    contender.result('installation-busy', downloads=0, commits=0)
            assert sum((child.control / 'ready').exists() for child in racers) == 1
            owner.send('release')
            owner.result('installed', downloads=1, commits=1)
            installed(home)
            checks.append(dict(name=case, passed=True))
            print(case + ': passed', flush=True)

            for language in ['rust', 'typescript']:
                case = f'{language}-reclaims-a-stale-shared-lock'
                home = home_for(case)
                lock = home / '.puppyone/agent-runtimes/codex/install.lock'
                lock.mkdir(parents=True)
                stale = time.time() - 60
                os.utime(lock, (stale, stale))
                child = Child(language, home, archive, False)
                child.result('installed', downloads=1, commits=1)
                installed(home)
                checks.append(dict(name=case, passed=True))
                print(case + ': passed', flush=True)
        finally:
            for child in children:
                child.close()
    assert all(child.process.poll() is not None for child in children)
    assert not directory.exists()
    assert source_hashes() == before, 'Source changed during interop verification'
    result = dict(passed=True, sourceUnchangedDuringVerification=True, sourceHashes=before,
                  sourceCommit=subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
                  referenceCommit=pinned['commit'], checks=checks, cleanupVerified=True,
                  childProcessCount=len(children), verifiedAt=datetime.now(timezone.utc).isoformat(),
                  qualification='Actual TS and Rust lease/extraction/commit engines; local archive transport and CLI verification fixtures; no real vendor network download.')
    (out / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
    print(f'{len(checks)} interop scenarios passed; {len(children)} child processes settled; fixture cleanup verified.')


if __name__ == '__main__':
    main()
