"""Signing and notarizing a GPUI release on macOS, with the product's rules
(`macos.mjs`, `macos-release-policy.mjs`, `macos-release-artifacts.mjs`).

A stable release is signed with a Developer ID Application certificate,
with the hardened runtime and a secure timestamp, and notarized and stapled.
Dev and internal builds are signed ad hoc, as the product's are
(`identity: "-"`). Credentials come only from the environment, under the
product's names:

- signing: `CSC_NAME` (an identity in the login keychain), or `CSC_LINK`
  (a .p12 file path or its base64) with `CSC_KEY_PASSWORD`, imported into a
  temporary keychain for the run;
- notarization, one complete set of: `APPLE_API_KEY` (path to the .p8) +
  `APPLE_API_KEY_ID` + `APPLE_API_ISSUER`; `APPLE_ID` +
  `APPLE_APP_SPECIFIC_PASSWORD` + `APPLE_TEAM_ID`; or
  `APPLE_KEYCHAIN_PROFILE`.
"""
import base64
import re
import secrets
import subprocess
import tempfile
from contextlib import contextmanager
from pathlib import Path

# Apple's Developer ID intermediates (apple.com/certificateauthority), which
# a fresh build machine may not have: codesign needs them to build the chain
# from a Developer ID Application certificate to Apple's root.
CERTIFICATES = Path(__file__).resolve().parent / 'certs'

NOTARIZATION_MODES = [
    ('App Store Connect API key', ['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER']),
    ('Apple ID', ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']),
    ('notarytool keychain profile', ['APPLE_KEYCHAIN_PROFILE']),
]


def _has(env, key):
    return bool((env.get(key) or '').strip())


def plan(channel, env):
    """What this run signs with, and the reasons a stable release would not
    be ready (`inspectMacReleaseReadiness`). Dev and internal builds are
    always ad hoc and never notarized."""
    errors = []
    signing = None
    if _has(env, 'CSC_LINK'):
        if _has(env, 'CSC_KEY_PASSWORD'):
            signing = {'p12': env['CSC_LINK'], 'password': env['CSC_KEY_PASSWORD']}
        else:
            errors.append('CSC_LINK must be protected by CSC_KEY_PASSWORD')
    elif _has(env, 'CSC_NAME'):
        signing = {'identity': env['CSC_NAME']}
    else:
        errors.append('set CSC_LINK or CSC_NAME for Developer ID signing')
    notarization = next((label for label, keys in NOTARIZATION_MODES
                         if all(_has(env, k) for k in keys)), None)
    if not notarization:
        partial = [(label, [k for k in keys if not _has(env, k)]) for label, keys in NOTARIZATION_MODES
                   if any(_has(env, k) for k in keys)]
        errors += [f'{label} notarization credentials are incomplete: missing {", ".join(missing)}'
                   for label, missing in partial]
        if not partial:
            errors.append('configure one complete notarization credential set')
    if channel != 'stable':
        return {'signing': None, 'notarization': None, 'release': False, 'errors': []}
    return {'signing': signing, 'notarization': notarization,
            'release': signing is not None and notarization is not None, 'errors': errors}


def _describe(command):
    """The tool and what it acted on, never the other arguments: some are passwords."""
    tool = Path(command[0]).name
    return f'{tool} {command[1]}' if tool in ('security', 'xcrun') else f'{tool} {Path(command[-1]).name}'


def _run(command, **kwargs):
    result = subprocess.run(command, text=True, capture_output=True, **kwargs)
    if result.returncode:
        raise SystemExit(f'{_describe(command)} failed with exit {result.returncode}:\n'
                         f'{(result.stderr or result.stdout).strip()}')
    return result.stdout


def _search_list():
    listed = _run(['security', 'list-keychains', '-d', 'user'])
    return [line.strip().strip('"') for line in listed.splitlines() if line.strip()]


@contextmanager
def keychain(signing):
    """The identity to sign with: the named one, or the .p12 imported into
    a temporary keychain that is deleted afterwards."""
    if signing is None or 'identity' in signing:
        yield (signing or {}).get('identity'), None
        return
    with tempfile.TemporaryDirectory(prefix='puppyone-signing-') as directory:
        p12 = Path(directory) / 'certificate.p12'
        link = signing['p12']
        p12.write_bytes(Path(link).read_bytes() if Path(link).is_file() else base64.b64decode(link))
        path = str(Path(directory) / 'release.keychain-db')
        password = secrets.token_hex(16)
        searched = _search_list()
        _run(['security', 'create-keychain', '-p', password, path])
        try:
            _run(['security', 'set-keychain-settings', '-lut', '3600', path])
            _run(['security', 'unlock-keychain', '-p', password, path])
            # codesign resolves the identity's certificate chain only through
            # keychains on the search list, not the one --keychain names.
            _run(['security', 'list-keychains', '-d', 'user', '-s', path, *searched])
            for certificate in sorted(CERTIFICATES.glob('*.cer')):
                _run(['security', 'import', str(certificate), '-k', path])
            _run(['security', 'import', str(p12), '-k', path, '-P', signing['password'],
                  '-T', '/usr/bin/codesign'])
            _run(['security', 'set-key-partition-list', '-S', 'apple-tool:,apple:', '-s',
                  '-k', password, path])
            identities = _run(['security', 'find-identity', '-v', '-p', 'codesigning', path])
            match = re.search(r'"(Developer ID Application:[^"]+)"', identities) \
                or re.search(r'\d+\) [0-9A-F]{40} "([^"]+)"', identities)
            if not match:
                raise SystemExit('CSC_LINK holds no code signing identity')
            yield match.group(1), path
        finally:
            subprocess.run(['security', 'list-keychains', '-d', 'user', '-s', *searched], capture_output=True)
            subprocess.run(['security', 'delete-keychain', path], capture_output=True)


def sign(target, identity, keychain_path=None):
    """Signs `target` (an app, from the inside out, or a DMG). A release
    identity adds the hardened runtime and a secure timestamp; without one
    the signature is ad hoc."""
    target = Path(target)
    nested = []
    if target.suffix == '.app':
        frameworks = target / 'Contents/Frameworks'
        nested = sorted(frameworks.glob('*.dylib')) if frameworks.is_dir() else []
    base = ['codesign', '--force']
    if identity:
        base += ['--sign', identity, '--timestamp']
        if keychain_path:
            base += ['--keychain', keychain_path]
    else:
        base += ['--sign', '-']
    for path in nested:
        _run(base + [str(path)])
    runtime = ['--options', 'runtime'] if identity and target.suffix == '.app' else []
    _run(base + runtime + [str(target)])
    _run(['codesign', '--verify', '--strict', '--verbose=2']
         + (['--deep'] if target.suffix == '.app' else []) + [str(target)])


def notarize(target, mode, env):
    """`notarytool submit --wait`, then staple the ticket to `target`."""
    target = Path(target)
    credentials = {
        'App Store Connect API key': ['--key', env.get('APPLE_API_KEY', ''),
                                      '--key-id', env.get('APPLE_API_KEY_ID', ''),
                                      '--issuer', env.get('APPLE_API_ISSUER', '')],
        'Apple ID': ['--apple-id', env.get('APPLE_ID', ''),
                     '--password', env.get('APPLE_APP_SPECIFIC_PASSWORD', ''),
                     '--team-id', env.get('APPLE_TEAM_ID', '')],
        'notarytool keychain profile': ['--keychain-profile', env.get('APPLE_KEYCHAIN_PROFILE', '')],
    }[mode]
    with tempfile.TemporaryDirectory(prefix='puppyone-notarize-') as directory:
        upload = target
        if target.suffix == '.app':
            upload = Path(directory) / f'{target.stem}.zip'
            _run(['ditto', '-c', '-k', '--keepParent', str(target), str(upload)])
        result = _run(['xcrun', 'notarytool', 'submit', str(upload), '--wait', *credentials])
        if not re.search(r'status:\s*Accepted', result):
            raise SystemExit(f'Notarization was not accepted for {target.name}:\n{result}')
    _run(['xcrun', 'stapler', 'staple', str(target)])
    _run(['xcrun', 'stapler', 'validate', str(target)])


def verify_release_app(app):
    """`verifyMacReleaseArtifacts`: a Developer ID signature Gatekeeper
    accepts as notarized, with its ticket stapled."""
    _run(['codesign', '--verify', '--deep', '--strict', '--verbose=2', str(app)])
    signature = subprocess.run(['codesign', '-dv', '--verbose=4', str(app)],
                               capture_output=True, text=True).stderr
    if 'Authority=Developer ID Application:' not in signature:
        raise SystemExit(f'{Path(app).name} is not signed with a Developer ID Application certificate')
    gatekeeper = subprocess.run(['spctl', '--assess', '--type', 'execute', '--verbose=4', str(app)],
                                capture_output=True, text=True)
    report = gatekeeper.stdout + gatekeeper.stderr
    if gatekeeper.returncode or 'source=Notarized Developer ID' not in report:
        raise SystemExit(f'{Path(app).name} was not accepted as a notarized Developer ID app:\n{report}')
    _run(['xcrun', 'stapler', 'validate', str(app)])

