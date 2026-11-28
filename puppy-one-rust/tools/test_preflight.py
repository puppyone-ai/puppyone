import json
import unittest
from preflight import LLVM_COV, ROOT, RUST

WORKFLOWS = ROOT.parent / '.github/workflows'


class PreflightMatchesTheRunners(unittest.TestCase):
    """Preflight is only worth running if it prepares what the release runners do."""

    def test_every_workflow_that_runs_verify_uses_the_preflight_toolchain(self):
        oracle = json.loads((ROOT / 'fixtures/ui/number-format-oracle.json').read_text())
        self.assertIn('icu', oracle)
        workflow = (WORKFLOWS / 'rust-tests.yml').read_text()
        self.assertIn('tools/verify.py', workflow)
        self.assertIn(f'rustup toolchain install {RUST} ', workflow)
        self.assertIn(f'cargo-llvm-cov --version {LLVM_COV} ', workflow)
        # The Node.js whose ICU recorded the number-format oracle.
        self.assertIn('node-version: 22.22.3', workflow)
        self.assertIn('tools/requirements-verification.txt', workflow)

    def test_release_workflows_pin_toolchain_and_verify_acceptance_receipt(self):
        for name in ['desktop-internal-build.yml', 'desktop-stable-release.yml']:
            workflow = (WORKFLOWS / name).read_text()
            with self.subTest(workflow=name):
                self.assertIn(f'rustup toolchain install {RUST} ', workflow)
                self.assertIn('node-version: 22.22.3', workflow)
                self.assertIn('verify_source_receipt', workflow)
                self.assertIn('rust-tests.yml/runs', workflow)


if __name__ == '__main__':
    unittest.main()
