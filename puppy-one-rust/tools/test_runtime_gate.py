import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('runtime_gate', Path(__file__).with_name('verify-agent-runtimes.py'))
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


class RuntimeScope(unittest.TestCase):
    def test_default_runs_each_handshake_without_inference(self):
        selected = gate.select_checks()
        self.assertEqual(set(selected), {'puppyone-native', 'pty', *gate.HANDSHAKES})
        self.assertEqual(len(selected), 6)

    def test_live_scope_has_all_four_independent_roundtrips(self):
        self.assertEqual(set(gate.select_checks(live=True)), set(gate.CHECKS))

    def test_compatibility_alias_expands_without_duplicates(self):
        self.assertEqual(gate.select_checks(['handshakes', 'handshake-codex']), gate.HANDSHAKES)

    def test_explicit_inference_cannot_bypass_opt_in(self):
        for runtime in gate.INFERENCE:
            with self.subTest(runtime=runtime):
                with self.assertRaises(ValueError):
                    gate.select_checks([runtime])
                self.assertEqual(gate.select_checks([runtime], live=True), [runtime])
        with self.assertRaises(ValueError):
            gate.select_checks(['absent'], live=True)
