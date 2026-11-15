import unittest
from unittest.mock import patch, Mock
import signal
import subprocess
from test_runner import validate_result, execute


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
