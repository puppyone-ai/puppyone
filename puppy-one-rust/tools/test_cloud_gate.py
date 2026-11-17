import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('cloud_gate', Path(__file__).with_name('verify-cloud-acceptance.py'))
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


class CloudScope(unittest.TestCase):
    def test_default_never_sends_email(self):
        self.assertEqual(gate.select_checks(), ['project', 'computers', 'space'])

    def test_mail_requires_separate_explicit_approval_and_selection(self):
        with self.assertRaises(ValueError):
            gate.select_checks(['invitation-email'])
        self.assertNotIn('invitation-email', gate.select_checks(allow_email=True))
        self.assertEqual(gate.select_checks(['invitation-email', 'invitation-email'], allow_email=True), ['invitation-email'])
        with self.assertRaises(ValueError):
            gate.select_checks(['unknown'], allow_email=True)
