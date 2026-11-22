"""macOS target packager delegator.

Preserves `tools/release/package-macos.py` as the canonical macOS packaging
implementation so existing macOS release pipelines and upgrade contracts stay
unchanged.
"""
import subprocess
import sys
from pathlib import Path

RELEASE_DIR = Path(__file__).resolve().parents[1]
TARGET_OS = 'mac'


def package(args):
    """Forward unified CLI arguments to `tools/release/package-macos.py`."""
    script = RELEASE_DIR / 'package-macos.py'
    cmd = [sys.executable, str(script), '--channel', args.channel]
    if args.build_number:
        cmd += ['--build-number', args.build_number]
    if args.base_version:
        cmd += ['--base-version', args.base_version]
    if args.built_at:
        cmd += ['--built-at', args.built_at]
    if args.out:
        cmd += ['--out', str(args.out)]
    if args.flat_out:
        cmd.append('--flat-out')
    if args.build_info_out:
        cmd += ['--build-info-out', str(args.build_info_out)]
    if args.skip_build:
        cmd.append('--skip-build')
    if args.update_feed_url:
        cmd += ['--update-feed-url', args.update_feed_url]
    if args.dry_run:
        cmd.append('--dry-run')
    if args.release:
        cmd.append('--release')
    subprocess.run(cmd, check=True)
