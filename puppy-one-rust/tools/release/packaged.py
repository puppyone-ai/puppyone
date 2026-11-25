"""`packaged-desktop-build-verifier.mjs` for a GPUI macOS release directory:
the packaged app's metadata, the identity its executable reports, its update
feed, its icon, the artifact names and the release tag all name one build.
An Internal app carrying the Stable feed, another channel's artwork or a
DMG named after another version is refused before anything is published.
"""
import json
import plistlib
import re
import subprocess
from pathlib import Path

import feed
import icon
import identity

EXECUTABLE = 'puppy-one-rust'
# What the executable reports and build-info.json records alike.
SHARED = ('runtime', 'channel', 'version', 'buildId', 'commitSha', 'builtAt', 'sourceDirty')


def read_identity(app):
    """What the packaged executable says it is (`--puppyone-build-identity`)."""
    executable = Path(app) / 'Contents/MacOS' / EXECUTABLE
    result = subprocess.run([str(executable), '--puppyone-build-identity'],
                            capture_output=True, text=True, timeout=60)
    if result.returncode != 0:
        raise ValueError(f'{app} does not report its build identity')
    return json.loads(result.stdout)


def verify_macos(directory, channel, *, report=read_identity, verify_icon=icon.verify_app,
                 tag=None, update_feed=None):
    """Raises `ValueError` (or `FileNotFoundError`) for the first thing that
    does not agree; returns the verified app and its distributables."""
    directory = Path(directory)
    policy = identity.policy(channel)
    app = directory / f'{policy["name"]}.app'
    others = [p.name for p in directory.glob('*.app') if p != app]
    if not app.is_dir() or others:
        raise ValueError(f'The release must hold exactly {app.name}; found {others or "none"}')
    contents = app / 'Contents'
    build_info = json.loads((contents / 'Resources/build-info.json').read_text())
    version = build_info.get('version')
    if build_info.get('channel') != channel or build_info.get('runtime') != 'gpui':
        raise ValueError(f'build-info.json is not a GPUI {channel} build')
    if tag is not None:
        identity.check_release_tag(build_info, tag)

    info = plistlib.loads((contents / 'Info.plist').read_bytes())
    expected = {
        'CFBundleIdentifier': policy['id'],
        'CFBundleName': policy['name'],
        'CFBundleDisplayName': policy['name'],
        'CFBundleExecutable': EXECUTABLE,
        'CFBundleShortVersionString': build_info.get('baseVersion'),
        'CFBundleVersion': build_info.get('buildId') if channel != 'dev' else build_info.get('baseVersion'),
    }
    for key, value in expected.items():
        if info.get(key) != value:
            raise ValueError(f'Info.plist {key} is {info.get(key)!r}, not {value!r}')

    embedded = report(app)
    for key in SHARED:
        if embedded.get(key) != build_info.get(key):
            raise ValueError(f'The packaged executable reports {key} {embedded.get(key)!r}, '
                             f'but build-info.json records {build_info.get(key)!r}')
    canonical = update_feed or identity.platform_feed(channel, 'mac')
    if embedded.get('updateFeedUrl') != canonical:
        raise ValueError(f'The {channel} app embeds the update feed {embedded.get("updateFeedUrl")!r}, '
                         f'not its canonical update feed {canonical!r}')

    verify_icon(app, channel)

    stem = re.compile(rf'^puppyone-{re.escape(version)}-(arm64|x64)\.(dmg|zip)$')
    dmgs = sorted(directory.glob('*.dmg'))
    zips = sorted(directory.glob('*.zip'))
    for artifact in dmgs + zips:
        if not stem.match(artifact.name):
            raise ValueError(f'{artifact.name} is not named after {version}')
    if len(dmgs) != 1 or len(zips) != 1:
        raise ValueError('The release must hold one DMG and one update ZIP')
    metadata = directory / feed.filename(channel)
    parsed = feed.parse(metadata.read_text())
    if parsed['version'] != version or parsed['path'] != zips[0].name:
        raise ValueError(f'{metadata.name} names {parsed["version"]} {parsed["path"]}, '
                         f'not {version} {zips[0].name}')
    for file in parsed['files']:
        archive = directory / file['url']
        if not archive.is_file() or archive.stat().st_size != file['size'] or feed.sha512(archive) != file['sha512']:
            raise ValueError(f'{file["url"]} does not match {metadata.name}')
    return {'application': app, 'distributables': [dmgs[0], zips[0]], 'metadata': metadata}
