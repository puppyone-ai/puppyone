#!/usr/bin/env python3
"""`verifyMacReleaseArtifacts` for a GPUI release directory: the app, the DMG,
the update ZIP and `<channel>-mac.yml` naming that ZIP with its checksum.
Stable apps must carry a Developer ID signature Gatekeeper accepts as
notarized, with the ticket stapled; other channels a valid (ad hoc)
signature.

    python3 tools/release/verify-macos-release.py artifacts/release/stable
"""
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import feed  # noqa: E402
import sign  # noqa: E402


def main():
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    directory = Path(sys.argv[1])
    channel = directory.name
    apps = sorted(directory.glob('*.app'))
    dmgs = sorted(directory.glob('*.dmg'))
    zips = sorted(directory.glob('*.zip'))
    metadata = directory / f'{channel}-mac.yml'
    if not apps:
        raise SystemExit('No packaged macOS .app was found for signature verification.')
    if not dmgs:
        raise SystemExit('No macOS DMG release artifact was produced.')
    if not zips:
        raise SystemExit('No macOS ZIP release artifact was produced for auto-update.')
    if not metadata.is_file():
        raise SystemExit(f'No {metadata.name} update metadata was produced.')
    for app in apps:
        if channel == 'stable':
            sign.verify_release_app(app)
        else:
            subprocess.run(['codesign', '--verify', '--deep', '--strict', '--verbose=2', str(app)], check=True)
    parsed = feed.parse(metadata.read_text())
    for file in parsed['files']:
        archive = directory / file['url']
        if not archive.is_file() or archive.stat().st_size != file['size'] or feed.sha512(archive) != file['sha512']:
            raise SystemExit(f'{file["url"]} does not match {metadata.name}')
    print(f'{channel}: {len(apps)} app, {len(dmgs)} DMG, {len(zips)} ZIP and {metadata.name} verified')


if __name__ == '__main__':
    main()
