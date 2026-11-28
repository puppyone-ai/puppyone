#!/usr/bin/env python3
"""`verifyMacReleaseArtifacts` and `verifyPackagedDesktopBuild` for a GPUI
release directory: the app (its metadata, the identity its executable
reports, its update feed and its icon), the DMG, the update ZIP and
`<channel>-mac.yml` naming that ZIP with its checksum, all for one build
(packaged.py). Stable apps must carry a Developer ID signature Gatekeeper
accepts as notarized, with the ticket stapled; other channels a valid (ad
hoc) signature.

    python3 tools/release/verify-macos-release.py artifacts/release/stable --release-tag v0.5.0
"""
import argparse
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import identity  # noqa: E402
import packaged  # noqa: E402
import sign  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('directory', type=Path)
    parser.add_argument('--channel', choices=identity.CHANNELS,
                        help='Defaults to the directory basename (e.g. artifacts/release/stable)')
    parser.add_argument('--release-tag', help='The tag the build must exactly match (v<version>)')
    parser.add_argument('--update-feed-url',
                        help='The feed the app was packaged with, when not its channel\'s canonical feed')
    args = parser.parse_args()
    directory = args.directory
    channel = args.channel or directory.name
    if channel not in identity.CHANNELS:
        raise SystemExit(f'Cannot infer release channel from {directory}; pass --channel')
    try:
        verified = packaged.verify_macos(directory, channel, tag=args.release_tag,
                                         update_feed=args.update_feed_url)
    except (OSError, ValueError) as error:
        raise SystemExit(str(error)) from error
    app = verified['application']
    if channel == 'stable':
        sign.verify_release_app(app)
    else:
        subprocess.run(['codesign', '--verify', '--deep', '--strict', '--verbose=2', str(app)], check=True)
    print(f'{channel}: {app.name}, {", ".join(p.name for p in verified["distributables"])} '
          f'and {verified["metadata"].name} verified')


if __name__ == '__main__':
    main()
