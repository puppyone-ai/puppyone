"""Windows target packager: staging, NSIS installer rendering, Authenticode
signing plan & invocation, portable archive, and `<channel>-win.yml` feed.
"""
import base64
import json
import os
import platform
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

RELEASE_DIR = Path(__file__).resolve().parents[1]
ROOT = RELEASE_DIR.parents[1]
if str(RELEASE_DIR) not in sys.path:
    sys.path.insert(0, str(RELEASE_DIR))
if str(ROOT / 'tools') not in sys.path:
    sys.path.insert(0, str(ROOT / 'tools'))

import bundle  # noqa: E402
import feed  # noqa: E402
import identity  # noqa: E402

TARGET_OS = 'win'
EXECUTABLE = 'puppy-one-rust.exe'
DEFAULT_TIMESTAMP_URL = 'http://timestamp.digicert.com'
NSIS_TEMPLATE = RELEASE_DIR / 'nsis' / 'installer.nsi'

THIRD_PARTY_LICENSES = [
    (ROOT / 'licenses/render-service/MERMAID_LICENSE.txt', 'MERMAID_LICENSE.txt'),
    (ROOT / 'licenses/render-service/KATEX_LICENSE.txt', 'KATEX_LICENSE.txt'),
    (ROOT / 'README.md', 'README.md'),
    (ROOT / 'THIRD_PARTY.md', 'THIRD_PARTY.md'),
    (ROOT.parent / 'LICENSE', 'LICENSE'),
    (ROOT / 'assets/OpenSans-OFL.txt', 'OpenSans-OFL.txt'),
    (ROOT / 'assets/fonts/document/PT_Serif_OFL.txt', 'PTSerif-OFL.txt'),
    (ROOT / 'assets/agents/lobe-icons-license.txt', 'AGENT_ICONS_LICENSE.txt'),
]


def _has(env, key):
    return bool((env.get(key) or '').strip())


def _subject_fields(subject):
    """Split an X.500 subject (`CN=PuppyOne, O="PuppyOne, Inc.", C=US`, as
    .NET's `X509Certificate2.Subject` prints it) into `(key, value)` pairs.
    Commas inside double quotes belong to the value; `""` is a literal quote."""
    fields, part, quoted, i = [], [], False, 0
    while i < len(subject):
        char = subject[i]
        if char == '"':
            if quoted and subject[i + 1:i + 2] == '"':
                part.append('"')
                i += 2
                continue
            quoted = not quoted
        elif char == ',' and not quoted:
            fields.append(''.join(part))
            part = []
        else:
            part.append(char)
        i += 1
    fields.append(''.join(part))
    pairs = []
    for field in fields:
        key, sep, value = field.partition('=')
        if sep:
            pairs.append((key.strip().upper(), value.strip()))
    return pairs


def publisher_names(env):
    """The Authenticode publisher names the built app trusts for its updates
    (`PUPPYONE_WIN_EXPECTED_PUBLISHERS` in `platform::updates::installer`).

    `PUPPYONE_WIN_EXPECTED_PUBLISHERS` lists them explicitly, separated by `;`
    (old and new names during a certificate rotation). Otherwise the common
    name of `WINDOWS_SIGNER_SUBJECT`, the signing certificate's subject the
    Electron release also pins, is used."""
    explicit = env.get('PUPPYONE_WIN_EXPECTED_PUBLISHERS') or ''
    names = [name.strip() for name in explicit.replace('\n', ';').split(';') if name.strip()]
    if names:
        return names
    subject = (env.get('WINDOWS_SIGNER_SUBJECT') or '').strip()
    return [value for key, value in _subject_fields(subject) if key == 'CN' and value]


def signing_plan(channel, env):
    """Authenticode signing plan for Windows releases.

    Dev and internal builds remain unsigned; stable builds sign with
    `signtool.exe` and RFC 3161 SHA-256 timestamping when configured via:
    - `WIN_CSC_LINK` (path or base64 PFX) + `WIN_CSC_KEY_PASSWORD`, or
    - `WIN_CSC_THUMBPRINT` (installed certificate SHA-1 thumbprint);
    and name the publishers their updates must come from (`publisher_names`).
    """
    errors = []
    signing = None
    timestamp_url = (env.get('WIN_TIMESTAMP_URL') or DEFAULT_TIMESTAMP_URL).strip()
    if _has(env, 'WIN_CSC_LINK'):
        if _has(env, 'WIN_CSC_KEY_PASSWORD'):
            signing = {
                'mode': 'pfx',
                'pfx': env['WIN_CSC_LINK'].strip(),
                'password': env['WIN_CSC_KEY_PASSWORD'],
                'timestamp_url': timestamp_url,
            }
        else:
            errors.append('WIN_CSC_LINK must be protected by WIN_CSC_KEY_PASSWORD')
    elif _has(env, 'WIN_CSC_THUMBPRINT'):
        signing = {
            'mode': 'thumbprint',
            'thumbprint': env['WIN_CSC_THUMBPRINT'].strip(),
            'timestamp_url': timestamp_url,
        }
    else:
        errors.append('set WIN_CSC_LINK (+ WIN_CSC_KEY_PASSWORD) or WIN_CSC_THUMBPRINT for Authenticode signing')

    if channel != 'stable':
        return {'signing': None, 'release': False, 'errors': [], 'publishers': []}
    publishers = publisher_names(env)
    if not publishers:
        errors.append(
            'set WINDOWS_SIGNER_SUBJECT (or PUPPYONE_WIN_EXPECTED_PUBLISHERS) so updates trust only this publisher'
        )
    return {
        'signing': signing,
        'release': signing is not None and bool(publishers),
        'errors': errors,
        'publishers': publishers,
    }


def _nsis_escape(value):
    return str(value).replace('$', '$$').replace('"', '$\\"')


def render_nsis(out_script, *, release, policy, stage_dir, out_installer, template=NSIS_TEMPLATE):
    """Write a concrete NSIS script combining release defines with `installer.nsi`."""
    header = '\n'.join([
        f'!define PRODUCT_NAME "{_nsis_escape(policy["name"])}"',
        f'!define PRODUCT_ID "{_nsis_escape(policy["id"])}"',
        f'!define PRODUCT_VERSION "{_nsis_escape(release["version"])}"',
        f'!define URL_SCHEME "{_nsis_escape(policy["scheme"])}"',
        f'!define EXECUTABLE_NAME "{_nsis_escape(EXECUTABLE)}"',
        f'!define STAGE_DIR "{_nsis_escape(stage_dir)}"',
        f'!define OUT_FILE "{_nsis_escape(out_installer)}"',
        '',
    ])
    body = Path(template).read_text(encoding='utf-8')
    out_script = Path(out_script)
    out_script.parent.mkdir(parents=True, exist_ok=True)
    out_script.write_text(header + body, encoding='utf-8')
    return out_script


def stage(stage_dir, binary, release, cloud, policy, *, pdfium=None, resources=None):
    """Assemble the Windows application directory prior to NSIS / ZIP packaging."""
    stage_dir = Path(stage_dir)
    if stage_dir.exists():
        shutil.rmtree(stage_dir)
    res_dir = stage_dir / 'resources'
    res_dir.mkdir(parents=True, exist_ok=True)

    exe_dst = stage_dir / EXECUTABLE
    shutil.copy2(binary, exe_dst)

    pdfium_path = Path(pdfium) if pdfium is not None else (ROOT / 'vendor/pdfium/bin/pdfium.dll')
    if pdfium_path.is_file():
        shutil.copy2(pdfium_path, stage_dir / 'pdfium.dll')
        license_path = pdfium_path.parent.parent / 'LICENSE'
        if license_path.is_file():
            shutil.copy2(license_path, res_dir / 'PDFIUM_LICENSE.txt')

    for src, name in THIRD_PARTY_LICENSES:
        if src.is_file():
            shutil.copy2(src, res_dir / name)

    icon_source = ROOT / 'assets/release' / policy['icon']
    if icon_source.is_file():
        shutil.copy2(icon_source, res_dir / 'puppy-app-image.png')

    (res_dir / 'desktop-cloud.json').write_text(json.dumps(cloud), encoding='utf-8')
    (res_dir / 'build-info.json').write_text(json.dumps(release, indent=2) + '\n', encoding='utf-8')
    for name, data in (resources or {}).items():
        (res_dir / name).write_bytes(data)

    if bundle.digest(exe_dst) != bundle.digest(binary):
        raise SystemExit(f'Staged Windows binary mismatch: {exe_dst}')
    return stage_dir


def archive_zip(stage_dir, out_zip):
    """Create a portable Windows ZIP archive from `stage_dir`."""
    stage_dir = Path(stage_dir)
    out_zip = Path(out_zip)
    out_zip.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out_zip, 'w', compression=zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(stage_dir.rglob('*')):
            if path.is_file():
                zf.write(path, path.relative_to(stage_dir).as_posix())
    return out_zip


def sign_binary(target, signing):
    """Sign a Windows PE executable or NSIS installer via `signtool.exe`."""
    if signing is None:
        return
    signtool = shutil.which('signtool') or shutil.which('signtool.exe')
    if not signtool:
        raise SystemExit('signtool.exe is required for Windows Authenticode signing')
    base = [signtool, 'sign', '/fd', 'SHA256']
    ts_url = (signing.get('timestamp_url') or '').strip()
    if ts_url and ts_url.lower() != 'none':
        base.extend(['/tr', ts_url, '/td', 'SHA256'])
    if signing['mode'] == 'thumbprint':
        subprocess.run(base + ['/sha1', signing['thumbprint'], str(target)], check=True)
        return
    with tempfile.TemporaryDirectory(prefix='puppyone-win-sign-') as tmp:
        pfx = Path(tmp) / 'cert.pfx'
        link = signing['pfx']
        pfx.write_bytes(Path(link).read_bytes() if Path(link).is_file() else base64.b64decode(link))
        subprocess.run(base + ['/f', str(pfx), '/p', signing['password'], str(target)], check=True)


def _arch():
    machine = platform.machine().lower()
    if machine in ('arm64', 'aarch64'):
        return 'arm64'
    return 'x64'


def package(args):
    commit, dirty = identity.source_state(ROOT)
    repo_root = ROOT.parent
    base_version = args.base_version or identity.product_version(repo_root)
    release = identity.release_identity(
        base_version, args.channel, commit, args.build_number, built_at=args.built_at, dirty=dirty
    )
    cloud = identity.cloud_configuration(
        os.environ.get('VITE_DESKTOP_CLOUD_API_URL'),
        os.environ.get('VITE_DESKTOP_CLOUD_WEB_URL'),
    )
    policy = identity.policy(args.channel)
    stamps = identity.build_environment(release, args.update_feed_url, target_os=TARGET_OS)
    signing = signing_plan(args.channel, os.environ)
    if signing['publishers']:
        stamps['PUPPYONE_WIN_EXPECTED_PUBLISHERS'] = ';'.join(signing['publishers'])
    out = args.out if args.flat_out else args.out / args.channel
    stem = f'puppyone-{release["version"]}-win-{_arch()}'
    installer = out / f'{stem}-setup.exe'

    print(f'{policy["name"]} {release["version"]} ({policy["id"]}) → {installer}')
    print(f'Cloud: {cloud["apiBase"]} · {cloud["webOrigin"]}')
    print(f'Update feed: {stamps.get("PUPPYONE_UPDATE_FEED_URL", "none (updates disabled)")}')
    if signing['signing']:
        print(f'Signing: Authenticode ({signing["signing"]["mode"]})')
    else:
        print('Signing: unsigned')
    if signing['publishers']:
        print('Trusted update publishers: ' + '; '.join(signing['publishers']))
    for error in signing['errors']:
        print(f'warning: not release-ready: {error}', file=sys.stderr)
    if args.release and (args.channel != 'stable' or not signing['release']):
        raise SystemExit(
            '--release needs a stable build with complete Windows Authenticode credentials and a trusted publisher'
        )
    if args.dry_run:
        print('Build environment: ' + ' '.join(f'{k}={v}' for k, v in stamps.items()))
        return

    target = ROOT / 'target/package-win'
    if not args.skip_build:
        subprocess.run(
            ['cargo', 'build', '--release', '--locked'],
            cwd=ROOT,
            check=True,
            env={**os.environ, **stamps, 'CARGO_TARGET_DIR': str(target)},
        )
    binary = target / 'release' / EXECUTABLE
    if not binary.is_file():
        raise SystemExit(f'Built Windows binary missing: {binary}')

    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    if args.build_info_out:
        args.build_info_out.parent.mkdir(parents=True, exist_ok=True)
        args.build_info_out.write_text(json.dumps(release, indent=2) + '\n', encoding='utf-8')

    stage_dir = out / 'stage'
    stage(stage_dir, binary, release, cloud, policy)
    if signing['signing']:
        sign_binary(stage_dir / EXECUTABLE, signing['signing'])

    portable = archive_zip(stage_dir, out / f'{stem}.zip')
    nsi_script = render_nsis(
        out / f'{stem}.nsi',
        release=release,
        policy=policy,
        stage_dir=stage_dir,
        out_installer=installer,
    )
    artifacts = []
    feed_artifacts = []
    makensis = shutil.which('makensis')
    if makensis:
        subprocess.run([makensis, '/V2', str(nsi_script)], check=True)
        if signing['signing']:
            sign_binary(installer, signing['signing'])
        artifacts.append(installer)
        feed_artifacts.append(installer)
    artifacts.append(portable)

    if feed_artifacts:
        metadata = feed.write(out, args.channel, release['version'], feed_artifacts, released=release['builtAt'], target_os=TARGET_OS)
        feed.parse(metadata.read_text(encoding='utf-8'), target_os=TARGET_OS)
        for artifact in (*artifacts, metadata):
            print(f'Packaged {artifact}')
    else:
        for artifact in artifacts:
            print(f'Packaged {artifact} (makensis unavailable; skipped Windows update feed)')
