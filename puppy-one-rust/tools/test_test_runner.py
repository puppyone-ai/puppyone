import unittest
from unittest.mock import patch, Mock
import signal
import subprocess
from test_runner import validate_result, validate_python_result, execute, isolated_test_environment
from pathlib import Path
import os
import sys
import tempfile


class LibtestEvidence(unittest.TestCase):
    def test_rejects_zero_tests_even_when_the_process_succeeds(self):
        self.assertIsNotNone(validate_result('a::b', 0, 'running 0 tests\ntest result: ok. 0 passed; 0 failed; 0 ignored;'))

    def test_requires_the_exact_test_and_a_non_skipped_result(self):
        good = 'test a::b ... ok\n\ntest result: ok. 1 passed; 0 failed; 0 ignored;'
        self.assertIsNone(validate_result('a::b', 0, good))
        self.assertIsNotNone(validate_result('a::c', 0, good))
        self.assertIsNotNone(validate_result('a::b', 1, good))
        self.assertIsNotNone(validate_result('a::b', 0, good.replace('... ok', '... ignored')))
        self.assertIsNotNone(validate_result('a::b', 0, good.replace('0 ignored', '1 ignored')))

    def test_rejects_ambiguous_or_duplicate_execution(self):
        output = 'test a::b ... ok\ntest a::b ... ok\ntest result: ok. 1 passed; 0 failed; 0 ignored;'
        self.assertIsNotNone(validate_result('a::b', 0, output))

    def test_expected_panic_annotation_keeps_the_exact_test_identity(self):
        output = ('test a::b - should panic ... ok\n\n'
                  'test result: ok. 1 passed; 0 failed; 0 ignored;')
        self.assertIsNone(validate_result('a::b', 0, output))
        self.assertIsNotNone(validate_result('a::c', 0, output))
        self.assertIsNotNone(validate_result('a::b', 101, output.replace('... ok', '... FAILED')))
        self.assertIsNotNone(validate_result('a::b', 0, output.replace('... ok', '... ignored')))
        self.assertIsNotNone(validate_result('a::b', 0, 'test a::b ... ok\n' + output))

    def test_real_stderr_diagnostics_cannot_split_a_libtest_result_line(self):
        # Raw logging on another thread bypasses libtest's capture. These
        # ordered writes reproduce a recovery diagnostic between name and ok.
        code, output = execute([sys.executable, '-c',
            "import os;"
            "os.write(1,b'test a::b ... ');"
            "os.write(2,b'Agent display feed entered recovery\\n');"
            "os.write(1,b'ok\\n\\ntest result: ok. 1 passed; 0 failed; 0 ignored;\\n')"])
        self.assertEqual(code, 0)
        self.assertIn('Agent display feed entered recovery', output)
        self.assertIsNone(validate_result('a::b', code, output))

    def test_timeout_terminates_the_cli_process_group_and_drains_output(self):
        child = Mock(pid=12345)
        child.communicate.side_effect = [subprocess.TimeoutExpired('fixture', 1), ('partial\n', None)]
        with patch('test_runner.subprocess.Popen', return_value=child) as start, patch('test_runner.os.killpg') as kill:
            code, output = execute(['fixture'], timeout=1)
        self.assertEqual(code, 124)
        self.assertIn('partial\n', output)
        self.assertTrue(start.call_args.kwargs['start_new_session'])
        kill.assert_called_once_with(12345, signal.SIGKILL)
        self.assertEqual(child.communicate.call_count, 2)


class ApplicationDataIsolation(unittest.TestCase):
    def test_real_child_writes_only_to_a_fresh_profile_and_cleanup_preserves_the_parent(self):
        with tempfile.TemporaryDirectory() as parent:
            sentinel = Path(parent) / 'sentinel'
            sentinel.write_text('user state')
            profiles = []
            with patch.dict(os.environ, {'PUPPYONE_RUST_DATA_DIR': parent}):
                for _ in range(2):
                    with isolated_test_environment({'PUPPYONE_FIXTURE_VALUE': 'kept'}) as env:
                        profiles.append(Path(env['PUPPYONE_RUST_DATA_DIR']))
                        self.assertNotEqual(profiles[-1], Path(parent))
                        code, output = execute([sys.executable, '-c',
                            "import os;from pathlib import Path;"
                            "Path(os.environ['PUPPYONE_RUST_DATA_DIR'],'owned').write_text(os.environ['PUPPYONE_FIXTURE_VALUE'])"], env=env)
                        self.assertEqual(code, 0, output)
                        self.assertEqual((profiles[-1] / 'owned').read_text(), 'kept')
                    self.assertFalse(profiles[-1].exists())
                self.assertEqual(os.environ['PUPPYONE_RUST_DATA_DIR'], parent)
            self.assertNotEqual(*profiles)
            self.assertEqual(sentinel.read_text(), 'user state')
            self.assertEqual(list(Path(parent).iterdir()), [sentinel])

    def test_an_explicit_gate_profile_remains_owned_by_its_caller(self):
        with tempfile.TemporaryDirectory() as profile:
            with isolated_test_environment({'PUPPYONE_RUST_DATA_DIR': profile}) as env:
                self.assertEqual(env['PUPPYONE_RUST_DATA_DIR'], profile)
            self.assertTrue(Path(profile).is_dir())

class NativeFixtureEvidence(unittest.TestCase):
    def test_feature_gated_integration_tests_record_their_real_support_binary(self):
        import hashlib
        import json
        from test_runner import run_gate
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            harness, probe = root / 'integration', root / 'native-probe'
            harness.write_bytes(b'libtest fixture')
            probe.write_bytes(b'native executable fixture')
            artifacts = '\n'.join(json.dumps({
                'reason': 'compiler-artifact', 'profile': {'test': is_test},
                'target': {'name': name}, 'executable': str(path),
            }) for name, path, is_test in [
                ('native_integration', harness, True), ('native-probe', probe, False),
            ])
            calls = []
            def execute_fixture(command, **kwargs):
                calls.append(command)
                if '--no-run' in command:
                    self.assertEqual(command[-2:], ['--features', 'dev-capture'])
                    return 0, artifacts
                if '--list' in command:
                    self.assertEqual(command[0], str(harness))
                    return 0, 'real_native: test\n'
                self.assertEqual(command[0], str(harness))
                self.assertIn('--include-ignored', command)
                return 0, 'test real_native ... ok\ntest result: ok. 1 passed; 0 failed; 0 ignored;'
            with patch('test_runner.ROOT', root), patch('test_runner.source_hashes', return_value={'fixture': 'identity'}), patch('test_runner.execute', side_effect=execute_fixture):
                receipt = run_gate('native', [{
                    'package': 'po-editor', 'target': 'native_integration',
                    'features': ['dev-capture'], 'test': 'real_native',
                }])
            self.assertTrue(receipt['passed'])
            self.assertEqual(receipt['features'], ['dev-capture'])
            self.assertEqual(receipt['supportBinaryHashes'], {'native-probe': hashlib.sha256(probe.read_bytes()).hexdigest()})
            self.assertEqual(len(calls), 3)

class UnittestEvidence(unittest.TestCase):
    def test_requires_exactly_the_named_python_test_to_pass(self):
        good = 'test_a (test_x.Case.test_a) ... ok\n\n----\nRan 1 test in 0.001s\n\nOK\n'
        self.assertIsNone(validate_python_result('Case.test_a', 0, good))
        self.assertIsNotNone(validate_python_result('Case.test_b', 0, good))
        self.assertIsNotNone(validate_python_result('Case.test_a', 1, good))
        self.assertIsNotNone(validate_python_result('Case.test_a', 0, good.replace('... ok', '... skipped "x"')))
        self.assertIsNotNone(validate_python_result('Case.test_a', 0, good.replace('Ran 1 test', 'Ran 0 tests')))
        self.assertIsNotNone(validate_python_result('Case.test_a', 0,
            'test_a (test_x.Case.test_a) ... ok\n' + good))

    def test_a_real_unittest_run_is_recognised(self):
        with tempfile.TemporaryDirectory() as directory:
            Path(directory, 'test_probe.py').write_text(
                'import unittest\nclass Case(unittest.TestCase):\n    def test_a(self):\n        pass\n'
                '    def test_b(self):\n        self.fail()\n')
            for name, passes in [('Case.test_a', True), ('Case.test_b', False)]:
                code, output = execute([sys.executable, '-B', '-m', 'unittest', '-v', f'test_probe.{name}'],
                                       env=dict(os.environ, PYTHONPATH=directory), cwd=directory)
                self.assertEqual(validate_python_result(name, code, output) is None, passes, output)

