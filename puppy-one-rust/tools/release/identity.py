"""What a GPUI release build is: its channel's application identity, its
release coordinates and the public Cloud configuration it ships.

Ports `shared/desktop/{application-identity,distribution-contract,release-identity,
return-to-app-link}.mjs` and the checks `cloud-configuration-plugin.mjs`
applies. Published channels (`internal`, `stable`) use the exact same bundle
identity, display name, return scheme, and update feed URLs as the shipped
Electron app so installed users receive in-place OTA upgrades; `dev` stays
visually distinct (`PuppyOne Rust Dev`, Blue-`D` icon).
"""
import json
import re
import subprocess
from datetime import datetime, timezone
from urllib.parse import urlsplit

CHANNELS = ('dev', 'internal', 'stable')
PUBLISHED_CHANNELS = ('internal', 'stable')
TARGET_OSES = ('mac', 'win', 'linux')
TARGET_OS_ALIASES = {
    'mac': 'mac',
    'macos': 'mac',
    'darwin': 'mac',
    'win': 'win',
    'windows': 'win',
    'linux': 'linux',
}
MINIMUM_SYSTEM_VERSION = '12.0'

POLICIES = {
    'dev': {'id': 'ai.puppyone.desktop.gpui.dev', 'name': 'PuppyOne Rust Dev',
            'scheme': 'puppyone-development', 'icon': 'puppy-app-image-gpui-dev.png',
            'feed': None},
    'internal': {'id': 'ai.puppyone.desktop.internal', 'name': 'PuppyOne Internal',
                 'scheme': 'puppyone-internal', 'icon': 'puppy-app-image.png',
                 'feed': 'https://downloads.puppyone.ai/desktop/internal/mac/latest'},
    'stable': {'id': 'ai.puppyone.desktop', 'name': 'PuppyOne',
               'scheme': 'puppyone', 'icon': 'puppy-app-image.png',
               'feed': 'https://updates.puppyone.ai/desktop/stable/mac/latest'},
}


def normalize_target_os(target_os='mac'):
    key = TARGET_OS_ALIASES.get((target_os or '').strip().lower())
    if not key:
        raise ValueError(f'Unsupported target OS: {target_os}')
    return key


def platform_feed(channel, target_os='mac'):
    """The default HTTPS update feed directory for `channel` on `target_os`.
    Appends Windows and Linux feeds without altering macOS feed URLs."""
    policy(channel)
    os_key = normalize_target_os(target_os)
    if channel == 'dev':
        return None
    if channel == 'internal':
        return f'https://downloads.puppyone.ai/desktop/internal/{os_key}/latest'
    return f'https://updates.puppyone.ai/desktop/stable/{os_key}/latest'
BASE_VERSION = re.compile(r'^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$')
COMMIT = re.compile(r'^[a-f0-9]{40}$')
BUILD_NUMBER = re.compile(r'^[1-9]\d*$')
CANONICAL_TIMESTAMP = re.compile(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$')


def policy(channel):
    if channel not in POLICIES:
        raise ValueError(f'Unsupported PuppyOne Desktop build channel: {channel}')
    return POLICIES[channel]


def release_identity(base_version, channel, commit, build_number=None, built_at=None, dirty=False):
    """`resolveDesktopBuildIdentity`: published channels need a clean tree
    and a build number; a development build is named after its commit."""
    policy(channel)
    if not BASE_VERSION.match(base_version or ''):
        raise ValueError(f'Invalid base version: {base_version}')
    if not COMMIT.match(commit or ''):
        raise ValueError(f'Invalid commit: {commit}')
    if channel in PUBLISHED_CHANNELS and dirty:
        raise ValueError('Published PuppyOne Desktop builds require a clean source tree.')
    resolved_built_at = built_at or datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.000Z')
    if not CANONICAL_TIMESTAMP.match(resolved_built_at):
        raise ValueError(f'builtAt must be a canonical UTC ISO timestamp: {resolved_built_at}')
    if channel == 'dev':
        build_id = f'g{commit[:8]}'
        platform_build_number = None
        version = f'{base_version}-dev.{build_id}' + ('.dirty' if dirty else '')
    else:
        if not BUILD_NUMBER.match(str(build_number or '')):
            raise ValueError(f'A {channel} build needs a positive build number.')
        build_id = str(build_number)
        platform_build_number = build_id
        version = f'{base_version}-internal.{build_id}' if channel == 'internal' else base_version
    return {
        'schemaVersion': 1, 'product': 'puppyone-desktop', 'runtime': 'gpui',
        'channel': channel, 'baseVersion': base_version, 'version': version,
        'buildId': build_id, 'platformBuildNumber': platform_build_number,
        'commitSha': commit, 'builtAt': resolved_built_at,
        'sourceDirty': bool(dirty),
    }


def build_info(release):
    """The one `build-info.json` a build carries (in the bundle, and beside it
    for the release workflow): the same bytes everywhere."""
    return (json.dumps(release, indent=2) + '\n').encode()


def check_release_tag(release, tag):
    """`expectedTag`: a published build's tag is `v<version>`, exactly."""
    expected = f'v{release["version"]}'
    if tag != expected:
        raise ValueError(f'The release tag {tag!r} must exactly match {expected!r}.')


def update_feed(value):
    """`PUPPYONE_UPDATE_FEED_URL`: an HTTPS directory holding
    `<channel>-mac.yml`, without credentials or a query."""
    url = urlsplit(value or '')
    if url.scheme != 'https' or not url.hostname or url.username or url.password or url.query or url.fragment:
        raise ValueError(f'The update feed must be an HTTPS directory: {value}')
    return value.rstrip('/')


def build_environment(release, feed=None, target_os='mac'):
    """The `PUPPYONE_BUILD_*` stamps `platform::build_identity` reads, and
    the update feed `platform::updates` reads (defaults to the channel's
    production feed URL for `target_os`; never stamped for dev)."""
    os_key = normalize_target_os(target_os)
    stamps = {
        'PUPPYONE_BUILD_CHANNEL': release['channel'],
        'PUPPYONE_BUILD_VERSION': release['version'],
        'PUPPYONE_BUILD_ID': release['buildId'],
        'PUPPYONE_BUILD_COMMIT': release['commitSha'],
        'PUPPYONE_BUILD_TIME': release['builtAt'],
        'PUPPYONE_BUILD_DIRTY': 'true' if release['sourceDirty'] else 'false',
    }
    if os_key == 'mac':
        stamps['MACOSX_DEPLOYMENT_TARGET'] = MINIMUM_SYSTEM_VERSION
    if os_key == 'linux' and release['channel'] != 'dev':
        stamps['PUPPYONE_LINUX_RELEASE_MARKER'] = f'release:{release["channel"]}:{release["version"]}'
    effective_feed = platform_feed(release['channel'], os_key) if feed is None else feed
    if effective_feed and release['channel'] != 'dev':
        stamps['PUPPYONE_UPDATE_FEED_URL'] = update_feed(effective_feed)
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
