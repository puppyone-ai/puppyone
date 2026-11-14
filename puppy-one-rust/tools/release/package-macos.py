#!/usr/bin/env python3
"""Package a GPUI release build for macOS, locally: build the executable with
the release's coordinates stamped in, assemble the bundle with its channel's
identity, icon, public Cloud configuration and build information. Nothing is
uploaded or published.

    VITE_DESKTOP_CLOUD_API_URL=https://api.puppyone.ai/api/v1 \\
    VITE_DESKTOP_CLOUD_WEB_URL=https://puppyone.ai \\
    python3 tools/release/package-macos.py --channel internal --build-number 12

Published channels (internal, stable) need a clean tree, a build number and
a passing `tools/verify.py` receipt for the source being packaged. `--dry-run`
prints the plan and builds nothing.
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(ROOT / 'tools'))
import bundle  # noqa: E402
import icon  # noqa: E402
import identity  # noqa: E402
from product_source import product_root  # noqa: E402


def verified_source():
    """A passing verification of exactly the source being packaged."""
    receipt = json.loads((ROOT / 'artifacts/gpui-verification/result.json').read_text())
    if not receipt.get('passed') or not receipt.get('sourceUnchangedDuringVerification', True):
        raise SystemExit('tools/verify.py did not pass for this source')
    for name, expected in receipt.get('sourceHashes', {}).items():
        path = ROOT / name
        if not path.is_file() or bundle.digest(path) != expected:
            raise SystemExit(f'Source changed after verification: {name}')


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--channel', choices=identity.CHANNELS, required=True)
    parser.add_argument('--build-number', help='Required for internal and stable')
    parser.add_argument('--base-version', help="Defaults to the pinned product's version")
    parser.add_argument('--out', type=Path, default=ROOT / 'artifacts/release')
    parser.add_argument('--skip-build', action='store_true', help='Reuse the stamped target/package build')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()

    commit, dirty = identity.source_state(ROOT)
    base_version = args.base_version or identity.product_version(product_root())
    try:
        release = identity.release_identity(base_version, args.channel, commit,
                                            args.build_number, dirty=dirty)
        cloud = identity.cloud_configuration(os.environ.get('VITE_DESKTOP_CLOUD_API_URL'),
                                             os.environ.get('VITE_DESKTOP_CLOUD_WEB_URL'))
    except ValueError as error:
        raise SystemExit(str(error))
    policy = identity.policy(args.channel)
    app = args.out / args.channel / f'{policy["name"]}.app'
    stamps = identity.build_environment(release)
    print(f'{policy["name"]} {release["version"]} ({policy["id"]}) → {app}')
    print(f'Cloud: {cloud["apiBase"]} · {cloud["webOrigin"]}')
    if args.dry_run:
        print('Build environment: ' + ' '.join(f'{k}={v}' for k, v in stamps.items()))
        return
    if args.channel in identity.PUBLISHED_CHANNELS:
        verified_source()

    # Its own target directory: the stamps and deployment target rebuild
    # every crate, which must not undo the verification build in target/.
    target = ROOT / 'target/package'
    if not args.skip_build:
        subprocess.run(['cargo', 'build', '--release', '--locked'], cwd=ROOT, check=True,
                       env={**os.environ, **stamps, 'CARGO_TARGET_DIR': str(target)})
    binary = target / 'release' / bundle.EXECUTABLE
    stamped = subprocess.run([str(binary), '--puppyone-build-identity'], capture_output=True, text=True)
    if stamped.returncode != 0 or json.loads(stamped.stdout or '{}').get('version') != release['version']:
        raise SystemExit(f'{binary} is not stamped as {release["version"]}; build it with this script')

    if app.exists():
        shutil.rmtree(app)
    info = identity.info_plist(release, bundle.document_types(), bundle.cli_declaration())
    bundle.assemble(app, binary, info, resources={
        'desktop-cloud.json': json.dumps(cloud).encode(),
        'build-info.json': (json.dumps(release, indent=2) + '\n').encode(),
    })
    icon.build(ROOT / 'assets/release' / policy['icon'], app / 'Contents/Resources/icon.icns')
    print(f'Packaged {app}')


if __name__ == '__main__':
    main()
