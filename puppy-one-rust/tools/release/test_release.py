"""Unit tests for the release tooling: `python3 -m unittest discover -s tools/release`."""
import tempfile
import unittest
from pathlib import Path

import bundle
import feed
import icon
import identity
import sign

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

    def test_every_channel_icon_builds_a_complete_icns(self):
        for channel in identity.CHANNELS:
            source = bundle.ROOT / 'assets/release' / identity.policy(channel)['icon']
            with tempfile.TemporaryDirectory() as out:
                destination = Path(out) / 'icon.icns'
                icon.build(source, destination)
                self.assertEqual(destination.read_bytes()[:4], b'icns')


if __name__ == '__main__':
    unittest.main()
