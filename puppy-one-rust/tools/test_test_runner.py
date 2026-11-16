import unittest
from unittest.mock import patch, Mock
import signal
import subprocess
from test_runner import validate_result, execute, isolated_test_environment
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
