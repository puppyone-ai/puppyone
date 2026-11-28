#!/usr/bin/env python3
"""Package a GPUI release build for macOS, locally: build the executable with
the release's coordinates stamped in, assemble the bundle with its channel's
identity, icon, public Cloud configuration and build information, sign it
(Developer ID and notarization for stable when the credentials are in the
environment, ad hoc otherwise; see sign.py), and make the installer disk
image, the update archive and its feed metadata (`<channel>-mac.yml`).
Nothing is uploaded or published.

    VITE_DESKTOP_CLOUD_API_URL=https://api.puppyone.ai/api/v1 \\
    VITE_DESKTOP_CLOUD_WEB_URL=https://puppyone.ai \\
    python3 tools/release/package-macos.py --channel internal --build-number 12

Published channels (internal, stable) need a clean tree, a build number and
a passing `tools/verify.py` receipt for the source being packaged. `--dry-run`
prints the plan and builds nothing; `--release` refuses to package a stable
build that could not be signed and notarized.
"""
import platform
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
import dmg  # noqa: E402
import feed  # noqa: E402
import icon  # noqa: E402
import identity  # noqa: E402
import packaged  # noqa: E402
import sign  # noqa: E402
from product_source import product_root  # noqa: E402
from source_identity import verify_source_receipt  # noqa: E402


def verified_source():
    """A passing verification of exactly the source being packaged."""
    receipt = json.loads((ROOT / 'artifacts/gpui-verification/result.json').read_text())
    try:
        verify_source_receipt(receipt, ROOT)
    except ValueError as error:
        raise SystemExit(str(error)) from error


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--channel', choices=identity.CHANNELS, required=True)
    parser.add_argument('--build-number', help='Required for internal and stable')
    parser.add_argument('--base-version', help="Defaults to the repository package.json version")
    parser.add_argument('--built-at', default=os.environ.get('PUPPYONE_BUILD_TIMESTAMP'),
                        help='Canonical UTC ISO timestamp (YYYY-MM-DDTHH:MM:SS.000Z)')
    parser.add_argument('--out', type=Path, default=ROOT / 'artifacts/release')
    parser.add_argument('--flat-out', action='store_true',
                        help='Write artifacts directly into --out instead of --out/<channel>')
    parser.add_argument('--build-info-out', type=Path,
                        help='Also write canonical build-info.json to this path (e.g. generated/desktop-build-info.json)')
    parser.add_argument('--skip-build', action='store_true', help='Reuse the stamped target/package build')
    parser.add_argument('--update-feed-url', default=os.environ.get('PUPPYONE_UPDATE_FEED_URL'),
                        help='HTTPS directory the app checks for <channel>-mac.yml (defaults to the channel production feed)')
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--release', action='store_true',
                        help='Stable only: fail unless it can be Developer ID signed and notarized')
    parser.add_argument('--expected-tag', help='The release tag this build must exactly match (v<version>)')
    args = parser.parse_args()

    commit, dirty = identity.source_state(ROOT)
    repo_root = ROOT.parent
    base_version = args.base_version or identity.product_version(
        repo_root if (repo_root / 'package.json').is_file() else product_root()
    )
    try:
        release = identity.release_identity(base_version, args.channel, commit,
                                            args.build_number, built_at=args.built_at, dirty=dirty)
        cloud = identity.cloud_configuration(os.environ.get('VITE_DESKTOP_CLOUD_API_URL'),
                                             os.environ.get('VITE_DESKTOP_CLOUD_WEB_URL'))
        if args.expected_tag is not None:
            identity.check_release_tag(release, args.expected_tag)
    except ValueError as error:
        raise SystemExit(str(error))
    policy = identity.policy(args.channel)
    out = args.out if args.flat_out else args.out / args.channel
    app = out / f'{policy["name"]}.app'
    try:
        stamps = identity.build_environment(release, args.update_feed_url)
    except ValueError as error:
        raise SystemExit(str(error))
    signing = sign.plan(args.channel, os.environ)
    print(f'{policy["name"]} {release["version"]} ({policy["id"]}) → {app}')
    print(f'Cloud: {cloud["apiBase"]} · {cloud["webOrigin"]}')
    print(f'Update feed: {stamps.get("PUPPYONE_UPDATE_FEED_URL", "none (updates disabled)")}')
    if signing['release']:
        print(f'Signing: Developer ID, notarized ({signing["notarization"]})')
    else:
        print('Signing: ad hoc, not notarized')
        for error in signing['errors']:
            print(f'warning: not release-ready: {error}', file=sys.stderr)
    if args.release and (args.channel != 'stable' or not signing['release']):
        raise SystemExit('--release needs a stable build with complete signing and notarization credentials')
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
    stamped_json = json.loads(stamped.stdout or '{}') if stamped.returncode == 0 else {}
    if (stamped.returncode != 0
            or stamped_json.get('version') != release['version']
            or stamped_json.get('updateFeedUrl') != stamps.get('PUPPYONE_UPDATE_FEED_URL')):
        raise SystemExit(f'{binary} is not stamped as {release["version"]} ({stamps.get("PUPPYONE_UPDATE_FEED_URL")}); build it with this script')

    # The channel's folder holds this build's artifacts only.
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    build_info_bytes = identity.build_info(release)
    if args.build_info_out:
        args.build_info_out.parent.mkdir(parents=True, exist_ok=True)
        args.build_info_out.write_bytes(build_info_bytes)
    icon_source = icon.source_for(args.channel)
    info = identity.info_plist(release, bundle.document_types(), bundle.cli_declaration())
    bundle.assemble(app, binary, info, resources={
        'desktop-cloud.json': json.dumps(cloud).encode(),
        'build-info.json': build_info_bytes,
        'puppy-app-image.png': icon_source.read_bytes(),
    })
    icon.build_for(args.channel, app)

    arch = {'arm64': 'arm64', 'x86_64': 'x64'}[platform.machine()]
    stem = f'puppyone-{release["version"]}-{arch}'
    with sign.keychain(signing['signing'] if signing['release'] else None) as (signer, keychain):
        sign.sign(app, signer, keychain)
        if signing['release']:
            sign.notarize(app, signing['notarization'], os.environ)
            sign.verify_release_app(app)
        archive = dmg.archive(app, out / f'{stem}.zip')
        image = dmg.create(app, out / f'{stem}.dmg', f'{policy["name"]} Installer',
                           ROOT / 'assets/release/dmg-background.tiff')
        sign.sign(image, signer, keychain)
        if signing['release']:
            sign.notarize(image, signing['notarization'], os.environ)
    metadata = feed.write(out, args.channel, release['version'], [archive], released=release['builtAt'])
    packaged.verify_macos(out, args.channel, tag=args.expected_tag,
                          update_feed=stamps.get('PUPPYONE_UPDATE_FEED_URL'))
    for artifact in (app, archive, image, metadata):
        print(f'Packaged {artifact}')


if __name__ == '__main__':
    main()
