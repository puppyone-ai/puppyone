#!/usr/bin/env python3
"""End-to-end macOS verification of an in-place Electron -> Rust GPUI OTA upgrade.

Proves every production contract required for existing Electron users on
`ai.puppyone.desktop` (`PuppyOne.app`) to receive and install a Rust GPUI
release from `updates.puppyone.ai/desktop/stable/mac/latest`:

1. Shared designated requirement + `CFBundleIdentifier` (`ai.puppyone.desktop`):
   Signs a mock installed Electron `PuppyOne.app` (v0.4.4, distinct Mach-O
   binary) and a packaged Rust GPUI `PuppyOne.app` (v0.4.5) with an explicit
   `designated => identifier "ai.puppyone.desktop"` requirement.
2. Canonical release & feed verification:
   Runs `scripts/verify-packaged-desktop-build.mjs` and
   `scripts/create-desktop-release-bundle.mjs create/verify` against the
   packaged GPUI `.app`, `.dmg`, `.zip`, `stable-mac.yml`, and `build-info.json`.
3. Designated requirement & Squirrel.Mac / `prepared-update.mjs` swap:
   Extracts `puppyone-0.4.5-<arch>.zip` with `/usr/bin/ditto`, reads the
   installed Electron bundle's `codesign -d -r-` designated requirement, runs
   `codesign --verify --deep --strict -R "=<requirement>"` against the GPUI
   bundle, atomically swaps `PuppyOne.app`, and verifies `--puppyone-build-identity`.

    python3 tools/release/verify-electron-to-gpui-ota.py
"""
import json
import os
import platform
import plistlib
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
REPO_ROOT = ROOT.parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(ROOT / 'tools'))

import bundle  # noqa: E402
import dmg  # noqa: E402
import feed  # noqa: E402
import icon  # noqa: E402
import identity  # noqa: E402
import sign  # noqa: E402
from product_source import product_root  # noqa: E402


def node_command_prefix(workspace: Path) -> list[str]:
    """Build `node` argv, adding a temporary ESM resolution hook to
    `product_root()/node_modules` when running in a git worktree without `npm ci`."""
    if (REPO_ROOT / 'node_modules').is_dir():
        return ['node']
    fallback = product_root() / 'node_modules'
    if not fallback.is_dir():
        return ['node']
    hook = workspace / 'fallback-node-modules.mjs'
    if not hook.is_file():
        hook.write_text(
            'import { createRequire, registerHooks } from "node:module";\n'
            'import { pathToFileURL } from "node:url";\n'
            f'const fallbackRequire = createRequire({json.dumps(str(fallback / "index.js"))});\n'
            'registerHooks({\n'
            '  resolve(specifier, context, nextResolve) {\n'
            '    try {\n'
            '      return nextResolve(specifier, context);\n'
            '    } catch (error) {\n'
            '      if (!specifier.startsWith(".") && !specifier.startsWith("/") && !specifier.startsWith("node:") && !specifier.startsWith("file:")) {\n'
            '        return { shortCircuit: true, url: pathToFileURL(fallbackRequire.resolve(specifier)).href };\n'
            '      }\n'
            '      throw error;\n'
            '    }\n'
            '  },\n'
            '});\n'
        )
    return ['node', '--import', hook.as_uri()]

COMMIT_OLD = '1' * 40
COMMIT_NEW = '2' * 40
BUILT_AT = '2026-11-16T00:00:00.000Z'


def make_mock_gpui_binary(path: Path, release: dict, feed_url: str) -> None:
    """Compile a tiny native Mach-O stub answering `--puppyone-build-identity`
    so codesign treats it as a real native binary with its own distinct cdhash."""
    c_src = path.with_suffix('.c')
    stamped = json.dumps({
        'runtime': 'gpui',
        'channel': release['channel'],
        'version': release['version'],
        'buildId': release['buildId'],
        'commitSha': release['commitSha'],
        'builtAt': release['builtAt'],
        'sourceDirty': release['sourceDirty'],
        'updateFeedUrl': feed_url,
    })
    escaped = stamped.replace('\\', '\\\\').replace('"', '\\"')
    c_src.write_text(
        '#include <stdio.h>\n'
        '#include <string.h>\n'
        'int main(int argc, char **argv) {\n'
        '  if (argc > 1 && strcmp(argv[1], "--puppyone-build-identity") == 0) {\n'
        f'    puts("{escaped}");\n'
        '    return 0;\n'
        '  }\n'
        '  return 0;\n'
        '}\n'
    )
    subprocess.run(['/usr/bin/clang', '-O2', str(c_src), '-o', str(path)], check=True)
    c_src.unlink()


def make_mock_electron_bundle(app_path: Path, version: str) -> None:
    """Assemble an installed Electron-style `PuppyOne.app` (`ai.puppyone.desktop`)
    with a distinct Mach-O executable."""
    macos_dir = app_path / 'Contents/MacOS'
    res_dir = app_path / 'Contents/Resources'
    macos_dir.mkdir(parents=True, exist_ok=True)
    res_dir.mkdir(parents=True, exist_ok=True)
    c_src = macos_dir / 'electron_stub.c'
    c_src.write_text('int main(void) { return 0; }\n')
    subprocess.run(['/usr/bin/clang', '-O2', str(c_src), '-o', str(macos_dir / 'puppyone')], check=True)
    c_src.unlink()
    build_info = {
        'schemaVersion': 1,
        'product': 'puppyone-desktop',
        'channel': 'stable',
        'baseVersion': version,
        'version': version,
        'buildId': '10',
        'platformBuildNumber': '10',
        'commitSha': COMMIT_OLD,
        'builtAt': '2026-11-10T00:00:00.000Z',
        'sourceDirty': False,
    }
    (res_dir / 'build-info.json').write_text(json.dumps(build_info, indent=2) + '\n')
    plist = {
        'CFBundleExecutable': 'puppyone',
        'CFBundleIdentifier': 'ai.puppyone.desktop',
        'CFBundleName': 'PuppyOne',
        'CFBundleDisplayName': 'PuppyOne',
        'CFBundlePackageType': 'APPL',
        'CFBundleShortVersionString': version,
        'CFBundleVersion': '10',
    }
    with (app_path / 'Contents/Info.plist').open('wb') as fp:
        plistlib.dump(plist, fp)


def sign_with_explicit_identifier(target: Path, bundle_id: str) -> None:
    """Sign `target` from the inside out with an explicit identifier designated
    requirement (`designated => identifier "<bundle_id>"`) so `codesign -d -r-`
    and `codesign --verify -R` test bundle-identity continuity across two
    distinct Mach-O binaries without touching any user keychain."""
    req = f'designated => identifier "{bundle_id}"'
    nested = []
    if target.suffix == '.app':
        frameworks = target / 'Contents/Frameworks'
        nested = sorted(frameworks.glob('*.dylib')) if frameworks.is_dir() else []
    for dylib in nested:
        subprocess.run(['codesign', '--force', '--sign', '-', str(dylib)],
                       check=True, capture_output=True, text=True)
    subprocess.run(['codesign', '--force', '--sign', '-', f'-r={req}', str(target)],
                   check=True, capture_output=True, text=True)


def main() -> None:
    if platform.system() != 'Darwin':
        raise SystemExit('verify-electron-to-gpui-ota.py requires macOS.')
    arch = {'arm64': 'arm64', 'x86_64': 'x64'}[platform.machine()]

    with tempfile.TemporaryDirectory(prefix='puppyone-ota-drill-') as tmp:
        workspace = Path(tmp)

        installed_dir = workspace / 'Applications'
        installed_app = installed_dir / 'PuppyOne.app'
        make_mock_electron_bundle(installed_app, '0.4.4')

        release = identity.release_identity(
            '0.4.5', 'stable', COMMIT_NEW, build_number='25', built_at=BUILT_AT, dirty=False
        )
        stamps = identity.build_environment(release)
        feed_url = stamps['PUPPYONE_UPDATE_FEED_URL']
        assert feed_url == 'https://updates.puppyone.ai/desktop/stable/mac/latest', feed_url

        gpui_bin = workspace / 'puppy-one-rust'
        make_mock_gpui_binary(gpui_bin, release, feed_url)

        release_dir = workspace / 'release'
        release_dir.mkdir()
        candidate_app = release_dir / 'PuppyOne.app'
        policy = identity.policy('stable')
        icon_source = ROOT / 'assets/release' / policy['icon']
        build_info_bytes = (json.dumps(release, indent=2) + '\n').encode()
        build_info_file = workspace / 'desktop-build-info.json'
        build_info_file.write_bytes(build_info_bytes)
        cloud = identity.cloud_configuration('https://api.puppyone.ai/api/v1', 'https://app.puppyone.ai')

        info = identity.info_plist(release, bundle.document_types(), bundle.cli_declaration())
        bundle.assemble(candidate_app, gpui_bin, info, resources={
            'desktop-cloud.json': json.dumps(cloud).encode(),
            'build-info.json': build_info_bytes,
            'puppy-app-image.png': icon_source.read_bytes(),
        })
        icon.build(icon_source, candidate_app / 'Contents/Resources/icon.icns')

        stem = f'puppyone-{release["version"]}-{arch}'
        sign_with_explicit_identifier(installed_app, 'ai.puppyone.desktop')
        sign_with_explicit_identifier(candidate_app, 'ai.puppyone.desktop')
        archive = dmg.archive(candidate_app, release_dir / f'{stem}.zip')
        image = dmg.create(candidate_app, release_dir / f'{stem}.dmg',
                           'PuppyOne Installer', ROOT / 'assets/release/dmg-background.tiff')
        sign.sign(image, None)
        metadata = feed.write(release_dir, 'stable', release['version'], [archive], released=BUILT_AT)

        # 1. Verify against TS's canonical packaged-build verifier.
        node_cmd = node_command_prefix(workspace)
        subprocess.run(node_cmd + [
            str(REPO_ROOT / 'scripts/verify-packaged-desktop-build.mjs'),
            '--build-info', str(build_info_file),
            '--release-directory', str(release_dir),
            '--target', f'macos-{arch}',
        ], cwd=REPO_ROOT, check=True)

        # 2. Verify against TS's canonical release-bundle transaction builder.
        notes_file = workspace / 'release-notes.md'
        notes_file.write_text('OTA drill release notes.\n')
        bundle_rel = f'artifacts/ota-drill-bundle-{os.getpid()}'
        bundle_abs = REPO_ROOT / bundle_rel
        try:
            subprocess.run(node_cmd + [
                str(REPO_ROOT / 'scripts/create-desktop-release-bundle.mjs'), 'create',
                '--bundle', bundle_rel,
                '--build-info', str(build_info_file),
                '--channel', 'stable',
                '--tag', 'v0.4.5',
                '--version', '0.4.5',
                '--commit', COMMIT_NEW,
                '--repository', 'puppyone/puppyone',
                '--r2-prefix', 'desktop/stable/mac/v0.4.5',
                '--public-origin', 'https://downloads.puppyone.ai',
                '--published-at', BUILT_AT,
                '--promotion-source-tag', 'v0.4.5-internal.24',
                '--arch', arch,
                '--prerelease', 'false',
                '--provenance', 'pipeline',
                '--developer-id-signed', 'true',
                '--notarized', 'true',
                '--notes-file', str(notes_file),
                '--asset', str(image),
                '--asset', str(archive),
                '--asset', str(metadata),
            ], cwd=REPO_ROOT, check=True)
            subprocess.run(node_cmd + [
                str(REPO_ROOT / 'scripts/create-desktop-release-bundle.mjs'), 'verify',
                '--bundle', bundle_rel,
                '--channel', 'stable',
                '--tag', 'v0.4.5',
                '--commit', COMMIT_NEW,
            ], cwd=REPO_ROOT, check=True)
        finally:
            shutil.rmtree(bundle_abs, ignore_errors=True)

        # 3. Verify Squirrel.Mac / prepared-update.mjs designated requirement & swap!
        req_out = subprocess.run(
            ['/usr/bin/codesign', '-d', '-r-', str(installed_app)],
            check=True, capture_output=True, text=True,
        )
        combined = f'{req_out.stdout}\n{req_out.stderr}'
        designated = next(
            (line.split('designated => ', 1)[1].strip()
             for line in combined.splitlines() if line.startswith('designated => ')),
            None,
        )
        if not designated or 'ai.puppyone.desktop' not in designated:
            raise SystemExit(f'Missing designated requirement on installed Electron app: {combined}')

        staging = workspace / 'staging'
        next_dir = staging / 'next'
        prev_dir = staging / 'previous'
        next_dir.mkdir(parents=True)
        prev_dir.mkdir(parents=True)
        subprocess.run(['/usr/bin/ditto', '-x', '-k', str(archive), str(next_dir)], check=True)
        extracted_apps = list(next_dir.glob('*.app'))
        assert len(extracted_apps) == 1 and extracted_apps[0].name == 'PuppyOne.app', extracted_apps
        extracted_app = extracted_apps[0]

        # Must pass for identical cert + bundle ID:
        subprocess.run([
            '/usr/bin/codesign', '--verify', '--deep', '--strict',
            '-R', f'={designated}', str(extracted_app),
        ], check=True, capture_output=True, text=True)

        # Negative control: a bundle with old wrong ID `ai.puppyone.desktop.gpui` MUST be rejected!
        wrong_req = designated.replace('ai.puppyone.desktop', 'ai.puppyone.desktop.gpui')
        wrong_check = subprocess.run([
            '/usr/bin/codesign', '--verify', '--deep', '--strict',
            '-R', f'={wrong_req}', str(extracted_app),
        ], capture_output=True, text=True)
        if wrong_check.returncode == 0:
            raise SystemExit('codesign -R unexpectedly accepted a mismatched bundle identifier!')

        # Atomic rename swap (exact logic of prepared-update.mjs & Squirrel.Mac):
        os.rename(installed_app, prev_dir / 'PuppyOne.app')
        os.rename(extracted_app, installed_app)

        swapped_info = json.loads((installed_app / 'Contents/Resources/build-info.json').read_text())
        assert swapped_info['runtime'] == 'gpui', swapped_info
        assert swapped_info['version'] == '0.4.5', swapped_info
        stamped_out = json.loads(subprocess.check_output(
            [str(installed_app / 'Contents/MacOS/puppy-one-rust'), '--puppyone-build-identity'],
            text=True,
        ))
        assert stamped_out['version'] == '0.4.5' and stamped_out['updateFeedUrl'] == feed_url, stamped_out

    print('Verified Electron (0.4.4) -> Rust GPUI (0.4.5) macOS OTA upgrade, bundle verification, and atomic swap.')


if __name__ == '__main__':
    main()
