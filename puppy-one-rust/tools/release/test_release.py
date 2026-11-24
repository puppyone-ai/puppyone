"""Unit tests for the release tooling: `python3 -m unittest discover -s tools/release`."""
import importlib.util
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

import bundle
import feed
import icon
import identity
import packaged
import sign
import targets
from targets import linux as linux_target
from targets import windows as windows_target

COMMIT = 'a' * 40


class ReleaseIdentityTest(unittest.TestCase):
    """`release-identity.test.mjs`'s cases for the GPUI build."""

    def test_versions_follow_the_channel(self):
        dev = identity.release_identity('0.4.4', 'dev', COMMIT, dirty=True)
        self.assertEqual(dev['version'], '0.4.4-dev.gaaaaaaaa.dirty')
        self.assertEqual(dev['buildId'], 'gaaaaaaaa')
        self.assertIsNone(dev['platformBuildNumber'])
        self.assertEqual(dev['product'], 'puppyone-desktop')
        internal = identity.release_identity('0.4.4', 'internal', COMMIT, '12')
        self.assertEqual(internal['version'], '0.4.4-internal.12')
        self.assertEqual(internal['platformBuildNumber'], '12')
        stable = identity.release_identity('0.4.4', 'stable', COMMIT, '12')
        self.assertEqual(stable['version'], '0.4.4')
        self.assertEqual(stable['platformBuildNumber'], '12')
        self.assertEqual(stable['product'], 'puppyone-desktop')
        self.assertEqual(stable['runtime'], 'gpui')

    def test_published_builds_refuse_what_cannot_be_released(self):
        for args in [('0.4', 'stable', COMMIT, '1'), ('0.4.4-beta.1', 'dev', COMMIT),
                     ('0.4.4', 'stable', 'abc', '1'), ('0.4.4', 'dev', COMMIT.upper()),
                     ('0.4.4', 'stable', COMMIT, None), ('0.4.4', 'internal', COMMIT, '0'),
                     ('0.4.4', 'qubits', COMMIT, '1'),
                     ('0.4.4', 'stable', COMMIT, '1', '2026-11-15'),
                     ('0.4.4', 'dev', COMMIT, None, '2026-11-15 10:00:00Z')]:
            with self.assertRaises(ValueError, msg=args):
                identity.release_identity(*args)
        with self.assertRaises(ValueError):
            identity.release_identity('0.4.4', 'stable', COMMIT, '1', dirty=True)
        with self.assertRaises(ValueError):
            identity.release_identity('0.4.4', 'internal', COMMIT, '1', dirty=True)

    def test_only_dev_internal_and_stable_are_channels(self):
        for channel in ('beta', 'preview', 'rc', 'archive', 'production'):
            with self.assertRaisesRegex(ValueError, 'Unsupported PuppyOne Desktop build channel', msg=channel):
                identity.release_identity('0.4.4', channel, COMMIT, '1')

    def test_stamps_name_every_coordinate_and_default_production_feeds(self):
        release = identity.release_identity('0.4.4', 'internal', COMMIT, '3', built_at='2026-11-14T00:00:00.000Z')
        stamps = identity.build_environment(release)
        self.assertEqual(stamps['PUPPYONE_BUILD_VERSION'], '0.4.4-internal.3')
        self.assertEqual(stamps['PUPPYONE_BUILD_DIRTY'], 'false')
        self.assertEqual(stamps['MACOSX_DEPLOYMENT_TARGET'], identity.MINIMUM_SYSTEM_VERSION)
        self.assertEqual(stamps['PUPPYONE_UPDATE_FEED_URL'], 'https://downloads.puppyone.ai/desktop/internal/mac/latest')
        stable_stamps = identity.build_environment(
            identity.release_identity('0.4.4', 'stable', COMMIT, '3', built_at='2026-11-14T00:00:00.000Z')
        )
        self.assertEqual(stable_stamps['PUPPYONE_UPDATE_FEED_URL'], 'https://updates.puppyone.ai/desktop/stable/mac/latest')


class CloudConfigurationTest(unittest.TestCase):
    """`Environment::new`'s allowlist, so a bundle never ships what the app refuses."""

    def test_puppyone_hosts_and_loopback_are_accepted(self):
        self.assertEqual(identity.cloud_configuration('https://api.puppyone.ai/api/v1/', 'https://puppyone.ai/'),
                         {'schemaVersion': 1, 'apiBase': 'https://api.puppyone.ai/api/v1',
                          'webOrigin': 'https://puppyone.ai'})
        identity.cloud_configuration('http://127.0.0.1:9090/api/v1', 'http://localhost:3000')

    def test_anything_else_is_refused(self):
        for api, web in [(None, 'https://puppyone.ai'),
                         ('http://api.puppyone.ai/api/v1', 'https://puppyone.ai'),
                         ('https://api.example.com/api/v1', 'https://puppyone.ai'),
                         ('https://api.puppyone.ai/v1', 'https://puppyone.ai'),
                         ('https://api.puppyone.ai/api/v1', 'https://puppyone.ai/app'),
                         ('https://u:p@api.puppyone.ai/api/v1', 'https://puppyone.ai'),
                         ('https://api.puppyone.ai/api/v1?x=1', 'https://puppyone.ai')]:
            with self.assertRaises(ValueError, msg=(api, web)):
                identity.cloud_configuration(api, web)


class InfoPlistTest(unittest.TestCase):
    def test_the_bundle_declares_its_channel(self):
        release = identity.release_identity('0.4.4', 'internal', COMMIT, '7')
        info = identity.info_plist(release, bundle.document_types(), bundle.cli_declaration())
        self.assertEqual(info['CFBundleIdentifier'], 'ai.puppyone.desktop.internal')
        self.assertEqual(info['CFBundleName'], 'PuppyOne Internal')
        self.assertEqual(info['CFBundleShortVersionString'], '0.4.4')
        self.assertEqual(info['CFBundleVersion'], '7')
        self.assertEqual(info['CFBundleURLTypes'][0]['CFBundleURLSchemes'], ['puppyone-internal'])
        self.assertEqual(info['LSMinimumSystemVersion'], '12.0')
        self.assertEqual(info['CFBundleIconFile'], 'icon.icns')
        # One icon source: no asset-catalog name or App Image file competes.
        self.assertNotIn('CFBundleIconName', info)
        self.assertEqual(info['PuppyOneCliUserDataName'], 'PuppyOne GPUI')
        self.assertIn('md', info['CFBundleDocumentTypes'][0]['CFBundleTypeExtensions'])
        stable = identity.info_plist(identity.release_identity('0.4.4', 'stable', COMMIT, '9'),
                                     bundle.document_types(), bundle.cli_declaration())
        self.assertEqual(stable['CFBundleIdentifier'], 'ai.puppyone.desktop')
        self.assertEqual(stable['CFBundleName'], 'PuppyOne')
        self.assertEqual(stable['CFBundleURLTypes'][0]['CFBundleURLSchemes'], ['puppyone'])
        dev = identity.info_plist(identity.release_identity('0.4.4', 'dev', COMMIT),
                                  bundle.document_types(), bundle.cli_declaration())
        self.assertEqual(dev['CFBundleIdentifier'], 'ai.puppyone.desktop.gpui.dev')
        self.assertEqual(dev['CFBundleName'], 'PuppyOne Rust Dev')
        self.assertEqual(dev['CFBundleVersion'], '0.4.4')
        self.assertEqual(dev['CFBundleURLTypes'][0]['CFBundleURLSchemes'], ['puppyone-development'])


class SigningPlanTest(unittest.TestCase):
    """`macos-release-policy.test.mjs`'s credential cases."""

    def test_dev_and_internal_are_always_ad_hoc(self):
        env = {'CSC_NAME': 'Developer ID Application: X', 'APPLE_KEYCHAIN_PROFILE': 'p'}
        for channel in ('dev', 'internal'):
            self.assertEqual(sign.plan(channel, env),
                             {'signing': None, 'notarization': None, 'release': False, 'errors': []})

    def test_stable_needs_a_signer_and_one_complete_notarization_set(self):
        self.assertEqual(sign.plan('stable', {})['errors'],
                         ['set CSC_LINK or CSC_NAME for Developer ID signing',
                          'configure one complete notarization credential set'])
        ready = sign.plan('stable', {'CSC_NAME': 'Developer ID Application: X',
                                     'APPLE_ID': 'a', 'APPLE_APP_SPECIFIC_PASSWORD': 'b', 'APPLE_TEAM_ID': 'c'})
        self.assertTrue(ready['release'])
        self.assertEqual(ready['notarization'], 'Apple ID')
        self.assertEqual(ready['errors'], [])
        partial = sign.plan('stable', {'CSC_LINK': '/x.p12', 'APPLE_API_KEY': 'k'})
        self.assertFalse(partial['release'])
        self.assertEqual(partial['errors'], [
            'CSC_LINK must be protected by CSC_KEY_PASSWORD',
            'App Store Connect API key notarization credentials are incomplete: missing '
            'APPLE_API_KEY_ID, APPLE_API_ISSUER'])


class FeedTest(unittest.TestCase):
    """`desktopUpdateFeedVerifier.test.mjs`: what is written reads back."""

    def test_written_metadata_passes_the_verifier(self):
        with tempfile.TemporaryDirectory() as out:
            archive = Path(out) / 'puppyone-0.4.5-arm64.zip'
            archive.write_bytes(b'archive')
            meta = feed.parse(feed.write(out, 'stable', '0.4.5', [archive],
                                         released='2026-11-15T00:00:00.000Z').read_text())
            self.assertEqual(meta['version'], '0.4.5')
            self.assertEqual(meta['files'][0]['size'], 7)
            self.assertEqual(meta['sha512'], feed.sha512(archive))

    def test_broken_metadata_is_refused(self):
        with self.assertRaises(ValueError) as refused:
            feed.parse('version: v1\nfiles:\n  - url: a.dmg\n    sha512: abc\n    size: 0\npath: b\nsha512: x\nreleaseDate: soon\n')
        for problem in ['version must be', 'base64 SHA-512', 'positive byte size', 'ZIP payload',
                        'path must identify', 'releaseDate']:
            self.assertIn(problem, str(refused.exception))

    def test_only_https_feeds_are_stamped_and_never_for_dev(self):
        release = identity.release_identity('0.4.4', 'internal', COMMIT, '3')
        feed_url = 'https://updates.puppyone.ai/desktop/gpui/internal/mac/latest/'
        self.assertEqual(identity.build_environment(release, feed_url)['PUPPYONE_UPDATE_FEED_URL'],
                         feed_url.rstrip('/'))
        self.assertNotIn('PUPPYONE_UPDATE_FEED_URL',
                         identity.build_environment(identity.release_identity('0.4.4', 'dev', COMMIT), feed_url))
        with self.assertRaises(ValueError):
            identity.build_environment(release, 'http://updates.puppyone.ai/x')


@unittest.skipUnless(sys.platform == 'darwin', 'requires macOS iconutil/sips')
class IconTest(unittest.TestCase):
    """`macosAppIcon.test.mjs`: input validation and the ten representations."""

    def test_a_png_header_without_valid_pixels_is_refused(self):
        source = bundle.ROOT / 'assets/release' / identity.policy('stable')['icon']
        header = source.read_bytes()[:33]
        with tempfile.TemporaryDirectory() as out:
            for name, data in [('empty.png', header), ('corrupt.png', header + b'\0' * 64 + b'IEND')]:
                bad = Path(out) / name
                bad.write_bytes(data)
                with self.assertRaises(Exception, msg=name):
                    icon.build(bad, Path(out) / 'icon.icns')
                self.assertFalse((Path(out) / 'icon.icns').exists())

    def test_wrong_retina_sizes_and_another_channels_artwork_are_refused(self):
        import shutil
        import subprocess
        stable = (bundle.ROOT / 'assets/release' / identity.policy('stable')['icon']).read_bytes()
        dev = (bundle.ROOT / 'assets/release' / identity.policy('dev')['icon']).read_bytes()
        self.assertNotEqual(stable, dev)
        with tempfile.TemporaryDirectory() as out:
            built = Path(out) / 'icon.icns'
            source = Path(out) / 'stable.png'
            source.write_bytes(stable)
            icon.build(source, built)
            icon.verify(built, stable)
            with self.assertRaisesRegex(ValueError, "App Image"):
                icon.verify(built, dev)
            # The former converter wrote 1x pixels into the @2x slots.
            iconset = Path(out) / 'wrong.iconset'
            subprocess.run(['/usr/bin/iconutil', '-c', 'iconset', str(built), '-o', str(iconset)], check=True)
            shutil.copyfile(iconset / 'icon_16x16.png', iconset / 'icon_16x16@2x.png')
            wrong = Path(out) / 'wrong.icns'
            subprocess.run(['/usr/bin/iconutil', '-c', 'icns', str(iconset), '-o', str(wrong)], check=True)
            with self.assertRaisesRegex(ValueError, r'icon_16x16@2x\.png is (missing|not 32 px)'):
                icon.verify(wrong, stable)

    def test_a_bundle_icon_passes_only_with_its_own_channels_artwork(self):
        import plistlib
        with tempfile.TemporaryDirectory() as out:
            app = Path(out) / 'PuppyOne.app'
            resources = app / 'Contents/Resources'
            resources.mkdir(parents=True)
            (app / 'Contents/Info.plist').write_bytes(plistlib.dumps({'CFBundleIconFile': 'icon.icns'}))
            icon.build_for('stable', app)
            (resources / 'puppy-app-image.png').write_bytes(icon.source_for('stable').read_bytes())
            icon.verify_app(app, 'stable')
            (resources / 'puppy-app-image.png').write_bytes(icon.source_for('dev').read_bytes())
            with self.assertRaisesRegex(ValueError, 'selected channel'):
                icon.verify_app(app, 'stable')
            (app / 'Contents/Info.plist').write_bytes(plistlib.dumps({'CFBundleIconFile': 'icon.icns',
                                                                       'CFBundleIconName': 'AppIcon'}))
            with self.assertRaisesRegex(ValueError, 'CFBundleIconFile'):
                icon.verify_app(app, 'stable')

    def test_every_channel_icon_builds_a_complete_icns(self):
        for channel in identity.CHANNELS:
            source = bundle.ROOT / 'assets/release' / identity.policy(channel)['icon']
            with tempfile.TemporaryDirectory() as out:
                destination = Path(out) / 'icon.icns'
                icon.build(source, destination)
                self.assertEqual(destination.read_bytes()[:4], b'icns')


class CrossPlatformFeedAndIdentityTest(unittest.TestCase):
    def test_platform_feeds_append_windows_and_linux_without_changing_macos(self):
        self.assertEqual(
            identity.platform_feed('stable', 'mac'),
            'https://updates.puppyone.ai/desktop/stable/mac/latest',
        )
        self.assertEqual(
            identity.platform_feed('stable', 'windows'),
            'https://updates.puppyone.ai/desktop/stable/win/latest',
        )
        self.assertEqual(
            identity.platform_feed('internal', 'linux'),
            'https://downloads.puppyone.ai/desktop/internal/linux/latest',
        )
        self.assertIsNone(identity.platform_feed('dev', 'windows'))
        release = identity.release_identity('0.4.5', 'stable', COMMIT, '10', built_at='2026-11-20T00:00:00.000Z')
        win_env = identity.build_environment(release, target_os='windows')
        self.assertNotIn('MACOSX_DEPLOYMENT_TARGET', win_env)
        self.assertEqual(win_env['PUPPYONE_UPDATE_FEED_URL'], 'https://updates.puppyone.ai/desktop/stable/win/latest')
        linux_env = identity.build_environment(release, target_os='linux')
        self.assertNotIn('MACOSX_DEPLOYMENT_TARGET', linux_env)
        self.assertEqual(linux_env['PUPPYONE_UPDATE_FEED_URL'], 'https://updates.puppyone.ai/desktop/stable/linux/latest')
        self.assertEqual(linux_env['PUPPYONE_LINUX_RELEASE_MARKER'], 'release:stable:0.4.5')
        dev_release = identity.release_identity('0.4.5', 'dev', COMMIT, built_at='2026-11-20T00:00:00.000Z')
        self.assertNotIn('PUPPYONE_LINUX_RELEASE_MARKER', identity.build_environment(dev_release, target_os='linux'))

    def test_windows_and_linux_feeds_roundtrip_and_validate_payloads(self):
        with tempfile.TemporaryDirectory() as out:
            installer = Path(out) / 'puppyone-0.4.5-win-x64-setup.exe'
            installer.write_bytes(b'MZ-fake-nsis')
            win_meta_path = feed.write(
                out, 'stable', '0.4.5', [installer], released='2026-11-20T00:00:00.000Z', target_os='win'
            )
            self.assertEqual(win_meta_path.name, 'stable-win.yml')
            win_meta = feed.parse(win_meta_path.read_text(encoding='utf-8'), target_os='win')
            self.assertEqual(win_meta['path'], installer.name)
            with self.assertRaisesRegex(ValueError, 'EXE installer payload'):
                feed.parse(win_meta_path.read_text(encoding='utf-8').replace('.exe', '.zip'), target_os='win')
            with self.assertRaisesRegex(ValueError, 'EXE installer payload'):
                feed.parse(win_meta_path.read_text(encoding='utf-8').replace('.exe', '.dmg'), target_os='win')

            appimage = Path(out) / 'puppyone-0.4.5-linux-x64.AppImage'
            appimage.write_bytes(b'ELF-fake-appimage')
            linux_meta_path = feed.write(
                out, 'internal', '0.4.5-internal.2', [appimage], released='2026-11-20T00:00:00.000Z', target_os='linux'
            )
            self.assertEqual(linux_meta_path.name, 'internal-linux.yml')
            linux_meta = feed.parse(linux_meta_path.read_text(encoding='utf-8'), target_os='linux')
            self.assertEqual(linux_meta['path'], appimage.name)
            with self.assertRaisesRegex(ValueError, 'AppImage, DEB, or ZIP'):
                feed.parse(linux_meta_path.read_text(encoding='utf-8').replace('.AppImage', '.dmg'), target_os='linux')


class WindowsTargetTest(unittest.TestCase):
    def test_authenticode_signing_plan_validates_credentials(self):
        self.assertEqual(
            windows_target.signing_plan('dev', {}),
            {'signing': None, 'release': False, 'errors': [], 'publishers': []},
        )
        self.assertEqual(
            windows_target.signing_plan('internal', {'WIN_CSC_THUMBPRINT': 'abc'}),
            {'signing': None, 'release': False, 'errors': [], 'publishers': []},
        )
        missing = windows_target.signing_plan('stable', {})
        self.assertFalse(missing['release'])
        self.assertEqual(len(missing['errors']), 2)

        partial = windows_target.signing_plan(
            'stable', {'WIN_CSC_LINK': 'cert.pfx', 'WINDOWS_SIGNER_SUBJECT': 'CN=PuppyOne'}
        )
        self.assertFalse(partial['release'])
        self.assertIn('WIN_CSC_KEY_PASSWORD', partial['errors'][0])

        credentials = {'WIN_CSC_LINK': 'cert.pfx', 'WIN_CSC_KEY_PASSWORD': 'secret'}
        unpinned = windows_target.signing_plan('stable', credentials)
        self.assertFalse(unpinned['release'])
        self.assertEqual(unpinned['signing']['mode'], 'pfx')
        self.assertIn('WINDOWS_SIGNER_SUBJECT', unpinned['errors'][0])

        ready = windows_target.signing_plan(
            'stable',
            {**credentials, 'WINDOWS_SIGNER_SUBJECT': 'CN=PuppyOne Inc., O=PuppyOne Inc., C=US'},
        )
        self.assertTrue(ready['release'])
        self.assertEqual(ready['signing']['mode'], 'pfx')
        self.assertEqual(ready['errors'], [])
        self.assertEqual(ready['publishers'], ['PuppyOne Inc.'])

    def test_publisher_names_pin_the_signer_common_name(self):
        names = windows_target.publisher_names
        self.assertEqual(names({}), [])
        self.assertEqual(
            names({'WINDOWS_SIGNER_SUBJECT': 'CN="PuppyOne, Inc.", O="PuppyOne, Inc.", L=San Francisco, C=US'}),
            ['PuppyOne, Inc.'],
        )
        self.assertEqual(names({'WINDOWS_SIGNER_SUBJECT': 'CN="Say ""Hi"" Ltd", C=US'}), ['Say "Hi" Ltd'])
        self.assertEqual(names({'WINDOWS_SIGNER_SUBJECT': 'O=PuppyOne Inc., C=US'}), [])
        self.assertEqual(
            names({
                'PUPPYONE_WIN_EXPECTED_PUBLISHERS': 'PuppyOne Legacy; PuppyOne, Inc.',
                'WINDOWS_SIGNER_SUBJECT': 'CN=Ignored',
            }),
            ['PuppyOne Legacy', 'PuppyOne, Inc.'],
        )

    def test_staging_nsis_rendering_and_portable_zip(self):
        release = identity.release_identity('0.4.5', 'stable', COMMIT, '12', built_at='2026-11-20T00:00:00.000Z')
        cloud = identity.cloud_configuration('https://api.puppyone.ai/api/v1', 'https://puppyone.ai')
        policy = identity.policy('stable')
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            fake_exe = root / 'puppy-one-rust.exe'
            fake_exe.write_bytes(b'MZ-binary')
            fake_pdfium_root = root / 'pdfium'
            (fake_pdfium_root / 'bin').mkdir(parents=True)
            fake_dll = fake_pdfium_root / 'bin/pdfium.dll'
            fake_dll.write_bytes(b'MZ-pdfium')
            (fake_pdfium_root / 'LICENSE').write_text('BSD', encoding='utf-8')

            stage_dir = windows_target.stage(
                root / 'stage', fake_exe, release, cloud, policy, pdfium=fake_dll
            )
            self.assertTrue((stage_dir / 'puppy-one-rust.exe').is_file())
            self.assertTrue((stage_dir / 'pdfium.dll').is_file())
            self.assertTrue((stage_dir / 'resources/desktop-cloud.json').is_file())
            self.assertTrue((stage_dir / 'resources/build-info.json').is_file())
            self.assertTrue((stage_dir / 'resources/PDFIUM_LICENSE.txt').is_file())

            script = windows_target.render_nsis(
                root / 'installer.nsi',
                release=release,
                policy=policy,
                stage_dir=stage_dir,
                out_installer=root / 'puppyone-setup.exe',
            )
            rendered = script.read_text(encoding='utf-8')
            self.assertIn('!define URL_SCHEME "puppyone"', rendered)
            self.assertIn('Software\\Classes\\${URL_SCHEME}', rendered)
            self.assertIn('Section "Uninstall"', rendered)

            archive = windows_target.archive_zip(stage_dir, root / 'puppyone-win.zip')
            with zipfile.ZipFile(archive) as zf:
                names = set(zf.namelist())
                self.assertIn('puppy-one-rust.exe', names)
                self.assertIn('pdfium.dll', names)
                self.assertIn('resources/build-info.json', names)


class LinuxTargetTest(unittest.TestCase):
    def test_appdir_deb_staging_and_checksums(self):
        release = identity.release_identity('0.4.5', 'internal', COMMIT, '4', built_at='2026-11-20T00:00:00.000Z')
        cloud = identity.cloud_configuration('https://api.puppyone.ai/api/v1', 'https://puppyone.ai')
        policy = identity.policy('internal')
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            fake_bin = root / 'puppy-one-rust'
            fake_bin.write_bytes(b'\x7fELF-binary')
            fake_pdfium_root = root / 'pdfium'
            (fake_pdfium_root / 'lib').mkdir(parents=True)
            fake_so = fake_pdfium_root / 'lib/libpdfium.so'
            fake_so.write_bytes(b'\x7fELF-pdfium')
            (fake_pdfium_root / 'LICENSE').write_text('BSD', encoding='utf-8')

            appdir = linux_target.stage_appdir(
                root / 'PuppyOne.AppDir', fake_bin, release, cloud, policy, pdfium=fake_so
            )
            self.assertTrue((appdir / 'AppRun').is_file())
            self.assertTrue((appdir / 'usr/bin/puppy-one-rust').is_file())
            self.assertTrue((appdir / 'usr/lib/libpdfium.so').is_file())
            desktop_text = (appdir / f'{policy["id"]}.desktop').read_text(encoding='utf-8')
            self.assertIn('MimeType=x-scheme-handler/puppyone-internal;', desktop_text)

            deb_root = linux_target.stage_deb_root(
                root / 'deb-root', fake_bin, release, cloud, policy, deb_arch='amd64', pdfium=fake_so
            )
            control = (deb_root / 'DEBIAN/control').read_text(encoding='utf-8')
            self.assertIn('Package: puppyone-internal', control)
            self.assertIn('Version: 0.4.5-internal.4', control)
            self.assertIn('Architecture: amd64', control)
            self.assertTrue((deb_root / 'usr/lib/puppyone/libpdfium.so').is_file())

            checksums = linux_target.write_checksums(root, [fake_bin])
            self.assertIn('puppy-one-rust', checksums.read_text(encoding='utf-8'))

            import shutil
            import subprocess
            dpkg_deb = shutil.which('dpkg-deb')
            if dpkg_deb:
                deb_out = root / 'puppyone-internal.deb'
                subprocess.run(
                    [dpkg_deb, '--build', '--root-owner-group', str(deb_root), str(deb_out)],
                    check=True,
                    capture_output=True,
                )
                self.assertTrue(deb_out.is_file())
                info = subprocess.check_output([dpkg_deb, '--info', str(deb_out)], text=True)
                self.assertIn('Package: puppyone-internal', info)
                contents = subprocess.check_output([dpkg_deb, '--contents', str(deb_out)], text=True)
                self.assertIn('usr/bin/puppy-one-rust', contents)
                self.assertIn('usr/lib/puppyone/libpdfium.so', contents)
                self.assertIn(f'usr/share/applications/{policy["id"]}.desktop', contents)

    def test_target_registry_dispatches_all_three_platforms(self):
        self.assertIs(targets.for_target('macos'), targets.macos)
        self.assertIs(targets.for_target('windows'), targets.windows)
        self.assertIs(targets.for_target('linux'), targets.linux)
        with self.assertRaises(ValueError):
            targets.for_target('plan9')


class PdfiumPinTableTest(unittest.TestCase):
    def test_all_six_desktop_targets_have_pinned_sha256_digests(self):
        spec = importlib.util.spec_from_file_location('fetch_pdfium', bundle.ROOT / 'tools/fetch-pdfium.py')
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        expected = {'mac-arm64', 'mac-x64', 'win-x64', 'win-arm64', 'linux-x64', 'linux-arm64'}
        self.assertEqual(set(mod.ASSETS.keys()), expected)
        for target_id, (archive, digest, rel_lib) in mod.ASSETS.items():
            self.assertTrue(archive.endswith('.tgz'), target_id)
            self.assertEqual(len(digest), 64, target_id)
            self.assertTrue(all(c in '0123456789abcdef' for c in digest), target_id)
            self.assertTrue(str(rel_lib), target_id)



class PackagedBuildTest(unittest.TestCase):
    """`packagedDesktopBuildVerifier.test.mjs`: the packaged app, what its
    executable reports, its feed, its icon and the artifacts name one build."""

    def release(self, out, channel='internal', feed_url=None, reports=None):
        import json
        import plistlib
        import stat
        build = identity.release_identity('1.4.0', channel, COMMIT, '72', built_at='2026-07-26T10:00:00.000Z')
        policy = identity.policy(channel)
        app = Path(out) / f'{policy["name"]}.app'
        resources = app / 'Contents/Resources'
        executable = app / 'Contents/MacOS/puppy-one-rust'
        resources.mkdir(parents=True)
        executable.parent.mkdir(parents=True)
        (resources / 'build-info.json').write_bytes(identity.build_info(build))
        reported = {key: build[key] for key in packaged.SHARED}
        reported['updateFeedUrl'] = feed_url or identity.platform_feed(channel, 'mac')
        reported.update(reports or {})
        # The executable reports what it was stamped with, as the real one does.
        executable.write_text(f"#!/bin/sh\ncat <<'JSON'\n{json.dumps(reported)}\nJSON\n")
        executable.chmod(executable.stat().st_mode | stat.S_IEXEC)
        with (app / 'Contents/Info.plist').open('wb') as f:
            plistlib.dump(identity.info_plist(build, [], {}), f)
        stem = f'puppyone-{build["version"]}-arm64'
        (Path(out) / f'{stem}.dmg').write_bytes(b'dmg')
        archive = Path(out) / f'{stem}.zip'
        archive.write_bytes(b'zip')
        feed.write(out, channel, build['version'], [archive], released=build['builtAt'])
        return app, build

    def test_the_app_its_executable_its_feed_and_the_artifacts_name_one_build(self):
        with tempfile.TemporaryDirectory() as out:
            app, build = self.release(out)
            checked = []
            verified = packaged.verify_macos(out, 'internal', tag='v1.4.0-internal.72',
                                             verify_icon=lambda a, c: checked.append((a, c)))
            self.assertEqual(verified['application'], app)
            self.assertEqual([p.name for p in verified['distributables']],
                             ['puppyone-1.4.0-internal.72-arm64.dmg', 'puppyone-1.4.0-internal.72-arm64.zip'])
            self.assertEqual(checked, [(app, 'internal')])
            # A DMG named after another version is not this build's.
            (Path(out) / 'puppyone-1.4.0-internal.71-arm64.dmg').write_bytes(b'old')
            with self.assertRaisesRegex(ValueError, 'not named after'):
                packaged.verify_macos(out, 'internal', verify_icon=lambda a, c: None)

    def test_an_internal_app_carrying_the_stable_feed_is_refused(self):
        with tempfile.TemporaryDirectory() as out:
            self.release(out, feed_url=identity.platform_feed('stable', 'mac'))
            with self.assertRaisesRegex(ValueError, 'canonical update feed'):
                packaged.verify_macos(out, 'internal', verify_icon=lambda a, c: None)
        # Nor one whose Info.plist names the Stable app.
        with tempfile.TemporaryDirectory() as out:
            import plistlib
            app, _ = self.release(out)
            info = plistlib.loads((app / 'Contents/Info.plist').read_bytes())
            info['CFBundleIdentifier'] = identity.policy('stable')['id']
            (app / 'Contents/Info.plist').write_bytes(plistlib.dumps(info))
            with self.assertRaisesRegex(ValueError, 'CFBundleIdentifier'):
                packaged.verify_macos(out, 'internal', verify_icon=lambda a, c: None)
        # Nor one whose executable was built as another version.
        with tempfile.TemporaryDirectory() as out:
            self.release(out, reports={'version': '1.4.0-internal.71'})
            with self.assertRaisesRegex(ValueError, 'reports version'):
                packaged.verify_macos(out, 'internal', verify_icon=lambda a, c: None)

    def test_a_failing_icon_check_fails_the_release(self):
        def invalid(app, channel):
            raise ValueError('Invalid native icon')
        with tempfile.TemporaryDirectory() as out:
            self.release(out)
            with self.assertRaisesRegex(ValueError, 'Invalid native icon'):
                packaged.verify_macos(out, 'internal', verify_icon=invalid)


class IconInputTest(unittest.TestCase):
    """`macosAppIcon.test.mjs`: the icon tool's inputs and the bundle's icon
    files, checked before any native tool runs."""

    def test_another_channels_artwork_or_an_unapproved_output_is_refused(self):
        stable = icon.source_for('stable')
        bundle_icon = Path('/tmp/PuppyOne Rust Dev.app/Contents/Resources/icon.icns')
        with self.assertRaisesRegex(ValueError, 'canonical PNG'):
            icon.build_inputs('dev', stable, bundle_icon)
        with self.assertRaisesRegex(ValueError, "app bundle"):
            icon.build_inputs('stable', stable, Path('/tmp/anywhere/icon.icns'))
        self.assertEqual(icon.build_inputs('stable', stable, bundle_icon.parent / 'icon.icns')[0], stable)
        with self.assertRaisesRegex(ValueError, 'Unsupported'):
            icon.source_for('unknown')

    def bundle(self, out):
        import plistlib
        resources = Path(out) / 'PuppyOne.app/Contents/Resources'
        resources.mkdir(parents=True)
        (resources / 'icon.icns').write_bytes(b'icns')
        (resources / 'puppy-app-image.png').write_bytes(icon.source_for('stable').read_bytes())
        (resources.parent / 'Info.plist').write_bytes(plistlib.dumps({'CFBundleIconFile': 'icon.icns'}))
        return resources

    def test_a_missing_icon_icns_is_refused(self):
        with tempfile.TemporaryDirectory() as out:
            resources = self.bundle(out)
            (resources / 'icon.icns').unlink()
            with self.assertRaisesRegex(FileNotFoundError, 'icon.icns'):
                icon.verify_app(resources.parents[1], 'stable')

    def test_a_missing_app_image_is_refused(self):
        with tempfile.TemporaryDirectory() as out:
            resources = self.bundle(out)
            (resources / 'puppy-app-image.png').unlink()
            with self.assertRaisesRegex(FileNotFoundError, 'puppy-app-image.png'):
                icon.verify_app(resources.parents[1], 'stable')


class BuildInfoTest(unittest.TestCase):
    """`desktopBuildIdentity.test.mjs`: `writes one build-info file and
    validates the release tag`."""

    def test_one_build_info_and_the_release_tag_must_match_exactly(self):
        import json
        release = identity.release_identity('1.4.0', 'internal', COMMIT, '42',
                                            built_at='2026-07-26T10:00:00.000Z')
        self.assertEqual(json.loads(identity.build_info(release)), release)
        identity.check_release_tag(release, 'v1.4.0-internal.42')
        with self.assertRaisesRegex(ValueError, 'must exactly match'):
            identity.check_release_tag(release, 'v1.4.0-internal.41')


if __name__ == '__main__':
    unittest.main()
