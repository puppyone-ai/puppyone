"""The update feed's metadata, written next to the update archives the way
electron-builder writes `<channel>-mac.yml`, and read back with the rules of
`desktop-update-feed-verifier.mjs` (`parseDesktopUpdaterMetadata`), which the
app's own reader (`platform::updates::feed`) applies too. Local only: the
feed is never uploaded from here."""
import base64
import hashlib
import re
from datetime import datetime, timezone
from pathlib import Path

VERSION = re.compile(r'^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$')
SHA512_BASE64 = re.compile(r'^[A-Za-z0-9+/]+={0,2}$')
TARGET_ALIASES = {
    'mac': 'mac',
    'macos': 'mac',
    'darwin': 'mac',
    'win': 'win',
    'windows': 'win',
    'linux': 'linux',
}
PAYLOAD_RULES = {
    'mac': (re.compile(r'\.zip(?:$|[?#])', re.I), 'macOS updater metadata must include a ZIP payload'),
    'win': (re.compile(r'\.(?:exe|zip)(?:$|[?#])', re.I), 'Windows updater metadata must include an EXE or ZIP payload'),
    'linux': (re.compile(r'\.(?:appimage|deb|zip)(?:$|[?#])', re.I), 'Linux updater metadata must include an AppImage, DEB, or ZIP payload'),
}


def _target_key(target_os='mac'):
    key = TARGET_ALIASES.get((target_os or '').strip().lower())
    if not key:
        raise ValueError(f'Unsupported feed target OS: {target_os}')
    return key


def filename(channel, target_os='mac'):
    """The platform-specific feed metadata filename (`<channel>-{mac,win,linux}.yml`)."""
    return f'{channel}-{_target_key(target_os)}.yml'


def sha512(path):
    digest = hashlib.sha512()
    with open(path, 'rb') as file:
        for chunk in iter(lambda: file.read(1 << 20), b''):
            digest.update(chunk)
    return base64.b64encode(digest.digest()).decode()


def write(directory, channel, version, archives, released=None, target_os='mac'):
    """`<channel>-{mac,win,linux}.yml` beside `archives` (paths in `directory`)."""
    released = released or datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.000Z')
    files = [(Path(a).name, sha512(a), Path(a).stat().st_size) for a in archives]
    lines = [f'version: {version}', 'files:']
    for name, digest, size in files:
        lines += [f'  - url: {name}', f'    sha512: {digest}', f'    size: {size}']
    lines += [f'path: {files[0][0]}', f'sha512: {files[0][1]}', f"releaseDate: '{released}'"]
    target = Path(directory) / filename(channel, target_os)
    target.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    return target


def _scalar(value):
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in '\'"':
        return value[1:-1]
    return value


def _sha512(value):
    if not SHA512_BASE64.match(value or '') or len(value) % 4:
        return False
    try:
        raw = base64.b64decode(value, validate=True)
    except ValueError:
        return False
    return len(raw) == 64 and base64.b64encode(raw).decode() == value


def parse(source, target_os='mac'):
    """`parseDesktopUpdaterMetadata` (macOS / Windows / Linux); raises with every problem."""
    os_key = _target_key(target_os)
    if not source.strip():
        raise ValueError('Desktop updater metadata is empty.')
    meta = {'version': None, 'files': [], 'path': None, 'sha512': None, 'releaseDate': None}
    reading = False
    current = None
    for raw in source.splitlines():
        if not raw.strip() or raw.lstrip().startswith('#'):
            continue
        line = raw.strip()
        if len(raw) == len(raw.lstrip()):
            reading, current = False, None
            key, _, value = line.partition(':')
            if not _:
                continue
            key, value = key.strip(), value.strip()
            if key == 'files' and value == '':
                reading = True
            elif key in ('version', 'path', 'sha512', 'releaseDate'):
                meta[key] = _scalar(value)
            continue
        if not reading:
            continue
        start = re.match(r'^-\s+url:\s*(.+)$', line)
        if start:
            current = {'url': _scalar(start.group(1)), 'sha512': None, 'size': None}
            meta['files'].append(current)
            continue
        if current is None:
            continue
        key, _, value = line.partition(':')
        if key.strip() == 'sha512':
            current['sha512'] = _scalar(value)
        elif key.strip() == 'size':
            try:
                current['size'] = int(_scalar(value))
            except ValueError:
                current['size'] = None
    errors = []
    if not VERSION.match(str(meta['version'] or '')):
        errors.append('version must be a semantic version')
    if not meta['files']:
        errors.append('files must contain at least one update payload')
    for file in meta['files']:
        label = file['url'] or 'update file'
        if not file['url']:
            errors.append('every update file must declare a URL')
        if not _sha512(file['sha512']):
            errors.append(f'{label} must declare a base64 SHA-512 digest')
        if not isinstance(file['size'], int) or file['size'] <= 0:
            errors.append(f'{label} must declare a positive byte size')
    payload_pattern, payload_error = PAYLOAD_RULES[os_key]
    if not any(payload_pattern.search(f['url'] or '') for f in meta['files']):
        errors.append(payload_error)
    primary = next((f for f in meta['files'] if f['url'] == meta['path']), None)
    if not meta['path'] or primary is None:
        errors.append('path must identify one declared update file')
    elif meta['sha512'] != primary['sha512']:
        errors.append('top-level sha512 must match the primary update file')
    try:
        datetime.fromisoformat(str(meta['releaseDate']).replace('Z', '+00:00'))
    except ValueError:
        errors.append('releaseDate must be a valid timestamp')
    if len({f['url'] for f in meta['files']}) != len(meta['files']):
        errors.append('update file URLs must be unique')
    if errors:
        raise ValueError('Invalid Desktop updater metadata:\n' + '\n'.join(f'- {e}' for e in errors))
    return meta
