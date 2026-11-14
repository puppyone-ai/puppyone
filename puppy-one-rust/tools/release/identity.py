"""What a GPUI release build is: its channel's application identity, its
release coordinates and the public Cloud configuration it ships.

Ports `shared/desktop/{application-identity,release-identity,
return-to-app-link}.mjs` and the checks `cloud-configuration-plugin.mjs`
applies, for the GPUI app. The GPUI app keeps its own bundle identity so it
can sit beside the Electron app; it shares the product's return schemes,
because template links name them.
"""
import json
import re
import subprocess
from datetime import datetime, timezone
from urllib.parse import urlsplit

CHANNELS = ('dev', 'internal', 'stable')
PUBLISHED_CHANNELS = ('internal', 'stable')
MINIMUM_SYSTEM_VERSION = '12.0'

POLICIES = {
    'dev': {'id': 'ai.puppyone.desktop.gpui.dev', 'name': 'PuppyOne GPUI Development',
            'scheme': 'puppyone-development', 'icon': 'puppy-app-image-dev.png'},
    'internal': {'id': 'ai.puppyone.desktop.gpui.internal', 'name': 'PuppyOne GPUI Internal',
                 'scheme': 'puppyone-internal', 'icon': 'puppy-app-image.png'},
    'stable': {'id': 'ai.puppyone.desktop.gpui', 'name': 'PuppyOne GPUI',
               'scheme': 'puppyone', 'icon': 'puppy-app-image.png'},
}
BASE_VERSION = re.compile(r'^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$')
COMMIT = re.compile(r'^[a-f0-9]{40}$')
BUILD_NUMBER = re.compile(r'^[1-9]\d*$')


def policy(channel):
    if channel not in POLICIES:
        raise ValueError(f'Unsupported PuppyOne GPUI build channel: {channel}')
    return POLICIES[channel]


def release_identity(base_version, channel, commit, build_number=None, built_at=None, dirty=False):
    """`resolveDesktopReleaseIdentity`: published channels need a clean tree
    and a build number; a development build is named after its commit."""
    policy(channel)
    if not BASE_VERSION.match(base_version or ''):
        raise ValueError(f'Invalid base version: {base_version}')
    if not COMMIT.match(commit or ''):
        raise ValueError(f'Invalid commit: {commit}')
    if channel in PUBLISHED_CHANNELS and dirty:
        raise ValueError('Published PuppyOne GPUI builds require a clean source tree.')
    if channel == 'dev':
        build_id = f'g{commit[:8]}'
        version = f'{base_version}-dev.{build_id}' + ('.dirty' if dirty else '')
    else:
        if not BUILD_NUMBER.match(str(build_number or '')):
            raise ValueError(f'A {channel} build needs a positive build number.')
        build_id = str(build_number)
        version = f'{base_version}-internal.{build_id}' if channel == 'internal' else base_version
    return {
        'schemaVersion': 1, 'product': 'puppyone-desktop-gpui', 'runtime': 'gpui',
        'channel': channel, 'baseVersion': base_version, 'version': version,
        'buildId': build_id, 'commitSha': commit,
        'builtAt': built_at or datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.000Z'),
        'sourceDirty': bool(dirty),
    }


def update_feed(value):
    """`PUPPYONE_UPDATE_FEED_URL`: an HTTPS directory holding
    `<channel>-mac.yml`, without credentials or a query."""
    url = urlsplit(value or '')
    if url.scheme != 'https' or not url.hostname or url.username or url.password or url.query or url.fragment:
        raise ValueError(f'The update feed must be an HTTPS directory: {value}')
    return value.rstrip('/')


def build_environment(release, feed=None):
    """The `PUPPYONE_BUILD_*` stamps `platform::build_identity` reads, and
    the update feed `platform::updates` reads (never for dev)."""
    stamps = {
        'PUPPYONE_BUILD_CHANNEL': release['channel'],
        'PUPPYONE_BUILD_VERSION': release['version'],
        'PUPPYONE_BUILD_ID': release['buildId'],
        'PUPPYONE_BUILD_COMMIT': release['commitSha'],
        'PUPPYONE_BUILD_TIME': release['builtAt'],
        'PUPPYONE_BUILD_DIRTY': 'true' if release['sourceDirty'] else 'false',
        'MACOSX_DEPLOYMENT_TARGET': MINIMUM_SYSTEM_VERSION,
    }
    if feed and release['channel'] != 'dev':
        stamps['PUPPYONE_UPDATE_FEED_URL'] = update_feed(feed)
    return stamps


def _endpoint(value, official=True):
    """`cloud::auth::model::endpoint`: the PuppyOne host family over HTTPS, or
    loopback development over HTTP."""
    url = urlsplit(value or '')
    host = url.hostname or ''
    local = host in ('localhost', '127.0.0.1')
    if (not host or url.username or url.password or url.query or url.fragment
            or not (url.scheme == 'https' or (local and url.scheme == 'http'))
            or (official and not (host == 'puppyone.ai' or host.endswith('.puppyone.ai') or local))):
        raise ValueError(f'Not a PuppyOne Cloud endpoint: {value}')
    return url


def cloud_configuration(api, web):
    """`dist/desktop-cloud.json`, held to `Environment::new`'s rules so a
    bundle never ships a configuration the app would refuse."""
    api_url, web_url = _endpoint(api), _endpoint(web)
    if not api_url.path.rstrip('/').endswith('/api/v1') or web_url.path not in ('', '/'):
        raise ValueError('The Cloud API must end in /api/v1 and the Web URL must be an origin.')
    origin = f'{web_url.scheme}://{web_url.netloc}'
    return {'schemaVersion': 1, 'apiBase': api.rstrip('/'), 'webOrigin': origin}


def info_plist(release, document_types, cli_declaration):
    """The bundle's Info.plist (`applyMacosBuilderConfig`, `protocols`)."""
    identity = policy(release['channel'])
    return {
        'CFBundleDocumentTypes': document_types,
        **cli_declaration,
        'CFBundleExecutable': 'puppy-one-rust',
        'CFBundleIdentifier': identity['id'],
        'CFBundleName': identity['name'],
        'CFBundleDisplayName': identity['name'],
        'CFBundlePackageType': 'APPL',
        'CFBundleShortVersionString': release['baseVersion'],
        'CFBundleVersion': release['buildId'] if release['channel'] != 'dev' else release['baseVersion'],
        'CFBundleIconFile': 'icon.icns',
        'CFBundleURLTypes': [{
            'CFBundleURLName': f'Open {identity["name"]}',
            'CFBundleURLSchemes': [identity['scheme']],
            'CFBundleTypeRole': 'Viewer',
        }],
        'LSApplicationCategoryType': 'public.app-category.productivity',
        'LSMinimumSystemVersion': MINIMUM_SYSTEM_VERSION,
        'NSHighResolutionCapable': True,
    }


def source_state(root):
    """The commit being packaged and whether the tree has local changes."""
    commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
    status = subprocess.check_output(['git', 'status', '--porcelain'], cwd=root, text=True)
    return commit, bool(status.strip())


def product_version(product):
    """The product release this GPUI build implements (`package.json`)."""
    return json.loads((product / 'package.json').read_text())['version']
