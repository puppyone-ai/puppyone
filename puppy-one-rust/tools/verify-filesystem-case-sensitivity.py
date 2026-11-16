#!/usr/bin/env python3
"""Exercise native rename identity on an actually case-sensitive filesystem."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

from test_runner import ROOT, run_gate


def main():
    name = 'filesystem-case-sensitivity'
    out = ROOT / 'artifacts' / name
    out.mkdir(parents=True, exist_ok=True)
    receipt = out / 'result.json'
    receipt.unlink(missing_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix='puppyone-case-volume-'))
    mount = temporary / 'volume'
    mount.mkdir()
    logs = []
    mounted = False
    report = None

    def command(args):
        result = subprocess.run(args, text=True, capture_output=True, timeout=60)
        logs.append({'command': args, 'exit': result.returncode,
                     'stdout': result.stdout, 'stderr': result.stderr})
        (out / 'volume.json').write_text(json.dumps(logs, indent=2) + '\n')
        result.check_returncode()

    try:
        if sys.platform == 'darwin':
            image = temporary / 'case.dmg'
            command(['/usr/bin/hdiutil', 'create', '-size', '32m', '-fs', 'HFSX',
                     '-volname', 'PuppyoneCaseTests', str(image)])
            command(['/usr/bin/hdiutil', 'attach', '-nobrowse', '-mountpoint',
                     str(mount), str(image)])
            mounted = True
            assert os.path.ismount(mount), 'hdiutil did not mount the requested fixture'
        elif sys.platform != 'linux':
            raise RuntimeError('This gate requires macOS or Linux native rename support')
        (mount / 'probe').write_bytes(b'lower')
        with (mount / 'PROBE').open('xb') as file:
            file.write(b'upper')
        assert (mount / 'probe').read_bytes() == b'lower'
        assert (mount / 'PROBE').read_bytes() == b'upper'
        report = run_gate(name, [{
            'package': 'po-workspace',
            'test': 'workspace::local_compatibility_tests::case_only_renames_follow_filesystem_identity_without_replacing_distinct_files',
        }], env=dict(os.environ, PUPPYONE_CASE_SENSITIVE_TEST_ROOT=str(mount)), metadata={
            'fixture': 'temporary HFSX disk image' if mounted else 'temporary native directory',
            'caseSensitiveProbePassed': True,
            'scope': 'Native rename onto a distinct existing filename with equal lowercase spelling',
        })
        # No successful receipt may survive a failure to unmount this fixture.
        receipt.unlink(missing_ok=True)
    finally:
        try:
            # Also handle a successful attach whose command timed out while
            # returning output, before the mounted flag could be set.
            if mounted or os.path.ismount(mount):
                command(['/usr/bin/hdiutil', 'detach', str(mount)])
            shutil.rmtree(temporary)
        except BaseException:
            receipt.unlink(missing_ok=True)
            raise
    assert report is not None
    report['fixtureReleased'] = True
    receipt.write_text(json.dumps(report, indent=2) + '\n')
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
