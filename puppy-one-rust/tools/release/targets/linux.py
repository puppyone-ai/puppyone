"""Linux target packager: AppDir / AppImage + `.deb` staging, `.desktop` URL
scheme registration, SHA-256 checksums, and `<channel>-linux.yml` feed.
"""
import hashlib
import json
import os
import platform
import re
import shutil
import stat
import subprocess
import sys
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

TARGET_OS = 'linux'
EXECUTABLE = 'puppy-one-rust'

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


def _make_executable(path):
    mode = path.stat().st_mode
    path.chmod(mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


def _deb_package_name(channel):
    return {
        'stable': 'puppyone',
        'internal': 'puppyone-internal',
        'dev': 'puppyone-dev',
    }[channel]


def _deb_version(version):
    # Debian versions allow alphanumerics and .+-~; preserve semver cleanly.
    return re.sub(r'[^0-9A-Za-z.+~-]', '.', version)


def _arch():
    machine = platform.machine().lower()
    if machine in ('arm64', 'aarch64'):
        return ('arm64', 'arm64')
    return ('x64', 'amd64')


def desktop_entry(policy, *, exec_cmd=EXECUTABLE, icon_name='puppyone'):
    """Render an XDG `.desktop` entry registering the channel's `puppyone://` scheme."""
    return '\n'.join([
        '[Desktop Entry]',
        'Type=Application',
        f'Name={policy["name"]}',
        f'Exec={exec_cmd} %u',
        f'Icon={icon_name}',
        'Terminal=false',
        'Categories=Office;Utility;',
        f'StartupWMClass={policy["id"]}',
        f'MimeType=x-scheme-handler/{policy["scheme"]};text/markdown;text/csv;text/html;',
        '',
    ])


def _copy_shared_resources(share_dir, release, cloud, policy, pdfium_path):
    share_dir.mkdir(parents=True, exist_ok=True)
    for src, name in THIRD_PARTY_LICENSES:
        if src.is_file():
            shutil.copy2(src, share_dir / name)
    if pdfium_path and pdfium_path.is_file():
        lic = pdfium_path.parent.parent / 'LICENSE'
        if lic.is_file():
            shutil.copy2(lic, share_dir / 'PDFIUM_LICENSE.txt')
    icon_source = ROOT / 'assets/release' / policy['icon']
    if icon_source.is_file():
        shutil.copy2(icon_source, share_dir / 'puppy-app-image.png')
    (share_dir / 'desktop-cloud.json').write_text(json.dumps(cloud), encoding='utf-8')
    (share_dir / 'build-info.json').write_text(json.dumps(release, indent=2) + '\n', encoding='utf-8')


def stage_appdir(appdir, binary, release, cloud, policy, *, pdfium=None):
    """Assemble a standard Linux AppDir suitable for `appimagetool`."""
    appdir = Path(appdir)
    if appdir.exists():
        shutil.rmtree(appdir)
    bin_dir = appdir / 'usr/bin'
    lib_dir = appdir / 'usr/lib'
    share_dir = appdir / 'usr/share/puppyone'
    apps_dir = appdir / 'usr/share/applications'
    icons_dir = appdir / 'usr/share/icons/hicolor/512x512/apps'
    for d in (bin_dir, lib_dir, share_dir, apps_dir, icons_dir):
        d.mkdir(parents=True, exist_ok=True)

    exe_dst = bin_dir / EXECUTABLE
    shutil.copy2(binary, exe_dst)
    _make_executable(exe_dst)

    pdfium_path = Path(pdfium) if pdfium is not None else (ROOT / 'vendor/pdfium/lib/libpdfium.so')
    if pdfium_path.is_file():
        shutil.copy2(pdfium_path, lib_dir / 'libpdfium.so')

    _copy_shared_resources(share_dir, release, cloud, policy, pdfium_path)

    icon_source = ROOT / 'assets/release' / policy['icon']
    if icon_source.is_file():
        shutil.copy2(icon_source, icons_dir / 'puppyone.png')
        shutil.copy2(icon_source, appdir / 'puppyone.png')

    entry_text = desktop_entry(policy, exec_cmd=EXECUTABLE, icon_name='puppyone')
    desktop_name = f'{policy["id"]}.desktop'
    (apps_dir / desktop_name).write_text(entry_text, encoding='utf-8')
    (appdir / desktop_name).write_text(entry_text, encoding='utf-8')

    apprun = appdir / 'AppRun'
    apprun.write_text(
        '#!/bin/sh\n'
        'HERE="$(dirname "$(readlink -f "$0")")"\n'
        'export LD_LIBRARY_PATH="${HERE}/usr/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"\n'
        f'exec "${{HERE}}/usr/bin/{EXECUTABLE}" "$@"\n',
        encoding='utf-8',
    )
    _make_executable(apprun)

    if bundle.digest(exe_dst) != bundle.digest(binary):
        raise SystemExit(f'Staged Linux AppDir binary mismatch: {exe_dst}')
    return appdir


def stage_deb_root(deb_root, binary, release, cloud, policy, *, deb_arch='amd64', pdfium=None):
    """Assemble a Debian package root (`DEBIAN/control` + `/usr/...`) for `dpkg-deb`."""
    deb_root = Path(deb_root)
    if deb_root.exists():
        shutil.rmtree(deb_root)
    debian_dir = deb_root / 'DEBIAN'
    bin_dir = deb_root / 'usr/bin'
    lib_dir = deb_root / 'usr/lib/puppyone'
    share_dir = deb_root / 'usr/share/puppyone'
    apps_dir = deb_root / 'usr/share/applications'
    icons_dir = deb_root / 'usr/share/icons/hicolor/512x512/apps'
    for d in (debian_dir, bin_dir, lib_dir, share_dir, apps_dir, icons_dir):
        d.mkdir(parents=True, exist_ok=True)

    exe_dst = bin_dir / EXECUTABLE
    shutil.copy2(binary, exe_dst)
    _make_executable(exe_dst)

    pdfium_path = Path(pdfium) if pdfium is not None else (ROOT / 'vendor/pdfium/lib/libpdfium.so')
    if pdfium_path.is_file():
        shutil.copy2(pdfium_path, lib_dir / 'libpdfium.so')

    _copy_shared_resources(share_dir, release, cloud, policy, pdfium_path)

    icon_source = ROOT / 'assets/release' / policy['icon']
    if icon_source.is_file():
        shutil.copy2(icon_source, icons_dir / 'puppyone.png')

    entry_text = desktop_entry(policy, exec_cmd=f'/usr/bin/{EXECUTABLE}', icon_name='puppyone')
    (apps_dir / f'{policy["id"]}.desktop').write_text(entry_text, encoding='utf-8')

    pkg_name = _deb_package_name(release['channel'])
    control = '\n'.join([
        f'Package: {pkg_name}',
        f'Version: {_deb_version(release["version"])}',
        'Section: editors',
        'Priority: optional',
        f'Architecture: {deb_arch}',
        'Maintainer: PuppyOne <release@puppyone.ai>',
        'Depends: libc6, libvulkan1, libxkbcommon0, libfontconfig1, libwayland-client0 | libx11-6',
        f'Description: {policy["name"]} native desktop application',
        ' Cross-platform Rust/GPUI workspace and knowledge editor.',
        '',
    ])
    (debian_dir / 'control').write_text(control, encoding='utf-8')

    if bundle.digest(exe_dst) != bundle.digest(binary):
        raise SystemExit(f'Staged Linux deb binary mismatch: {exe_dst}')
    return deb_root


def write_checksums(out_dir, artifacts):
    """Write `SHA256SUMS.txt` covering all packaged Linux artifacts."""
    lines = []
    for path in artifacts:
        p = Path(path)
        digest = hashlib.sha256(p.read_bytes()).hexdigest()
        lines.append(f'{digest}  {p.name}')
    target = Path(out_dir) / 'SHA256SUMS.txt'
    target.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    return target


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
    arch, deb_arch = _arch()
    out = args.out if args.flat_out else args.out / args.channel
    stem = f'puppyone-{release["version"]}-linux-{arch}'

    print(f'{policy["name"]} {release["version"]} ({policy["id"]}) → {out / (stem + ".AppImage")}')
    print(f'Cloud: {cloud["apiBase"]} · {cloud["webOrigin"]}')
    print(f'Update feed: {stamps.get("PUPPYONE_UPDATE_FEED_URL", "none (updates disabled)")}')
    print('Verification: SHA-256 checksums (SHA256SUMS.txt)')
    if args.dry_run:
        print('Build environment: ' + ' '.join(f'{k}={v}' for k, v in stamps.items()))
        return

    target = ROOT / 'target/package-linux'
    if not args.skip_build:
        subprocess.run(
            ['cargo', 'build', '--release', '--locked'],
            cwd=ROOT,
            check=True,
            env={**os.environ, **stamps, 'CARGO_TARGET_DIR': str(target)},
        )
    binary = target / 'release' / EXECUTABLE
    if not binary.is_file():
        raise SystemExit(f'Built Linux binary missing: {binary}')

    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    if args.build_info_out:
        args.build_info_out.parent.mkdir(parents=True, exist_ok=True)
        args.build_info_out.write_text(json.dumps(release, indent=2) + '\n', encoding='utf-8')

    appdir = stage_appdir(out / f'{stem}.AppDir', binary, release, cloud, policy)
    deb_root = stage_deb_root(out / f'{stem}.deb.staging', binary, release, cloud, policy, deb_arch=deb_arch)

    artifacts = []
    appimagetool = shutil.which('appimagetool')
    if appimagetool:
        appimage = out / f'{stem}.AppImage'
        subprocess.run([appimagetool, str(appdir), str(appimage)], check=True)
        artifacts.append(appimage)

    dpkg_deb = shutil.which('dpkg-deb')
    if dpkg_deb:
        deb_file = out / f'{stem}.deb'
        subprocess.run([dpkg_deb, '--build', '--root-owner-group', str(deb_root), str(deb_file)], check=True)
        artifacts.append(deb_file)

    if artifacts:
        checksums = write_checksums(out, artifacts)
        metadata = feed.write(out, args.channel, release['version'], artifacts, released=release['builtAt'], target_os=TARGET_OS)
        feed.parse(metadata.read_text(encoding='utf-8'), target_os=TARGET_OS)
        for artifact in (*artifacts, checksums, metadata):
            print(f'Packaged {artifact}')
    else:
        print(f'Staged {appdir} and {deb_root} (neither appimagetool nor dpkg-deb found in PATH)')
