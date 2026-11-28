"""The native copy keeps the product's vocabulary: `check-native-vocabulary.mjs`
applies the product's own generated rules and matcher, imported from the pinned
checkout, to assets/native-locales.json against a baseline that may only
shrink."""
import json
import os
import subprocess
import unittest
from pathlib import Path

from product_source import product_root

ROOT = Path(__file__).resolve().parents[1]

# Calls the pinned product gate on a planted catalog.
MATCHER = r"""
import path from 'node:path';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const product = process.env.PUPPYONE_PRODUCT_ROOT;
const gate = await import(pathToFileURL(path.join(product, 'scripts/check-user-vocabulary.mjs')).href);
const {rules} = JSON.parse(readFileSync(path.join(product, gate.rulesPath), 'utf8'));
const violations = gate.findVocabularyViolations(rules, [{file: 'native', catalog: {
  inflected: 'Backups are ready',
  identifiers: 'Review {pullRequest} at https://example.test/docs/pull-requests',
  plural: '{count, plural, one {# Merge} other {# Merges}}',
  clone: 'Clone the repository',
  number: 3,
  flag: true,
  longer: 'Backupper',
}}]);
const compared = gate.compareVocabularyBaseline(['native gone Backup', 'native clone Clone'], violations);
console.log(JSON.stringify({
  violations,
  added: compared.added.map((violation) => violation.id),
  stale: compared.stale,
}));
"""


class NativeVocabularyTests(unittest.TestCase):
    def env(self):
        return {**os.environ, 'PUPPYONE_PRODUCT_ROOT': str(product_root())}

    def test_the_native_copy_passes_with_its_committed_baseline(self):
        result = subprocess.run(
            ['node', 'tools/check-native-vocabulary.mjs'],
            cwd=ROOT, env=self.env(), capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('Native vocabulary verified', result.stdout)

    def test_the_product_matcher_reads_only_user_facing_copy(self):
        result = subprocess.run(
            ['node', '--input-type=module', '-e', MATCHER],
            cwd=ROOT, env=self.env(), capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        found = json.loads(result.stdout)
        messages = {v['id']: v['message'] for v in found['violations']}
        # An inflected form and the copy inside plural bodies are caught;
        # placeholders, links, values that are not strings and a longer
        # unrelated word are not.
        self.assertEqual(sorted(messages), [
            'native clone Clone', 'native inflected Backup', 'native plural Merge'])
        # Each report names the word, its concept and the replacement, or
        # asks for the consequence when the concept has no user-facing word.
        self.assertIn('"Backup" is system-view wording for', messages['native inflected Backup'])
        self.assertIn('say ', messages['native inflected Backup'])
        self.assertIn('describe the consequence instead', messages['native clone Clone'])
        # Only strings the baseline does not record fail; an exemption whose
        # string is gone is stale, so the baseline can only shrink.
        self.assertEqual(found['added'], ['native inflected Backup', 'native plural Merge'])
        self.assertEqual(found['stale'], ['native gone Backup'])


if __name__ == '__main__':
    unittest.main()
