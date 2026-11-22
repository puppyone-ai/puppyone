#!/usr/bin/env python3
"""Unified cross-platform release packager driven by `tools/release/targets/`.

All targets share the exact same Release Identity (`identity.py`) and platform
update feed contract (`feed.py`).

Examples:
    VITE_DESKTOP_CLOUD_API_URL=https://api.puppyone.ai/api/v1 \\
    VITE_DESKTOP_CLOUD_WEB_URL=https://puppyone.ai \\
    python3 tools/release/package.py --target windows --channel dev --dry-run
"""
import argparse
import os
import platform
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))
if str(ROOT / 'tools') not in sys.path:
    sys.path.insert(0, str(ROOT / 'tools'))

import identity  # noqa: E402
import targets  # noqa: E402


def _default_target():
    system = platform.system()
    if system == 'Darwin':
        return 'macos'
    if system == 'Windows':
        return 'windows'
    return 'linux'


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--target', choices=('macos', 'windows', 'linux'), default=_default_target(),
                        help='Target OS to package for (defaults to host OS)')
    parser.add_argument('--channel', choices=identity.CHANNELS, required=True)
    parser.add_argument('--build-number', help='Required for internal and stable')
    parser.add_argument('--base-version', help='Defaults to the repository package.json version')
    parser.add_argument('--built-at', default=os.environ.get('PUPPYONE_BUILD_TIMESTAMP'),
                        help='Canonical UTC ISO timestamp (YYYY-MM-DDTHH:MM:SS.000Z)')
    parser.add_argument('--out', type=Path, default=ROOT / 'artifacts/release')
    parser.add_argument('--flat-out', action='store_true',
                        help='Write artifacts directly into --out instead of --out/<channel>')
    parser.add_argument('--build-info-out', type=Path,
                        help='Also write canonical build-info.json to this path')
    parser.add_argument('--skip-build', action='store_true', help='Reuse the stamped target/package build')
    parser.add_argument('--update-feed-url', default=os.environ.get('PUPPYONE_UPDATE_FEED_URL'),
                        help='HTTPS directory holding <channel>-{mac,win,linux}.yml')
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--release', action='store_true',
                        help='Stable only: fail unless release signing/notarization credentials are complete')
    args = parser.parse_args(argv)
    targets.for_target(args.target).package(args)


if __name__ == '__main__':
    main()
