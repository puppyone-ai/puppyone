"""A missing or ambiguous Rust binary must never qualify live interop."""
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('cloud_interop_gate', Path(__file__).with_name('verify-cloud-interop.py'))
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


class InteropBuildDiscoveryTests(unittest.TestCase):
    def artifact(self, **overrides):
        return json.dumps(dict(reason='compiler-artifact', profile={'test': True},
                               target={'name': 'po_workspace'}, executable='/tmp/test-binary', **overrides))

    def test_requires_the_workspace_test_executable_not_a_normal_library_build(self):
        self.assertEqual(gate.built_workspace_binary('compiler diagnostic\n' + self.artifact()), Path('/tmp/test-binary'))
        for output in ['', '{}', json.dumps({'reason': 'compiler-artifact', 'profile': {'test': False},
                                           'target': {'name': 'po_workspace'}, 'executable': '/tmp/library'}),
                       json.dumps({'reason': 'compiler-artifact', 'profile': {'test': True},
                                   'target': {'name': 'another_target'}, 'executable': '/tmp/other'})]:
            with self.assertRaises(ValueError):
                gate.built_workspace_binary(output)

    def test_rejects_competing_workspace_test_executables(self):
        first = self.artifact()
        second = first.replace('/tmp/test-binary', '/tmp/stale-binary')
        with self.assertRaises(ValueError):
            gate.built_workspace_binary(first + '\n' + second)

    def test_reference_drift_or_read_failure_cannot_leave_a_passing_receipt(self):
        with patch.object(gate, 'reference_state', return_value='new-tree'):
            self.assertFalse(gate.reference_unchanged(Path('/reference'), 'pin', 'old-tree'))
        for error in [ValueError('modified source'), OSError('missing checkout')]:
            with patch.object(gate, 'reference_state', side_effect=error):
                self.assertFalse(gate.reference_unchanged(Path('/reference'), 'pin', 'old-tree'))
