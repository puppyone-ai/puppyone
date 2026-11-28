import copy
import unittest
from parity_inventory import case_inventory


class CaseAccountingTests(unittest.TestCase):
    def setUp(self):
        self.collected = {'referenceCommit': 'pin', 'files': [{
            'path': 'test.ts', 'sha256': 'hash',
            'cases': [{'name': 'parameterized', 'skipped': False},
                      {'name': 'parameterized', 'skipped': True}]}]}
        self.manifest = {'referenceCommit': 'pin', 'contracts': [{
            'typescript': [{'path': 'test.ts', 'sha256': 'hash'}]}]}

    def test_file_reference_is_not_case_coverage_and_skips_stay_visible(self):
        result = case_inventory(self.manifest, self.collected, ['test.ts'], ['smoke.mjs'])
        self.assertEqual(result['reviewedCaseCount'], 0)
        self.assertEqual(len(result['unreviewedCases']), 2)
        self.assertEqual(len(result['skippedCases']), 1)
        self.assertEqual(result['unreviewedAuxiliaryFiles'], ['smoke.mjs'])

    def test_duplicate_parameter_names_are_distinct_and_duplicate_citations_do_not_inflate(self):
        citation = self.manifest['contracts'][0]['typescript'][0]
        citation['cases'] = [{'index': 0, 'name': 'parameterized'}]
        self.manifest['contracts'].append(copy.deepcopy(self.manifest['contracts'][0]))
        result = case_inventory(self.manifest, self.collected, ['test.ts'], [])
        self.assertEqual(result['reviewedCaseCount'], 1)
        self.assertEqual(result['unreviewedCases'][0]['index'], 1)

    def test_reference_discovery_hash_index_and_name_drift_fail_closed(self):
        citation = self.manifest['contracts'][0]['typescript'][0]
        citation['cases'] = [{'index': 0, 'name': 'parameterized'}]
        for key, value in [('sha256', 'drift'), ('cases', [{'index': -1, 'name': 'parameterized'}]),
                           ('cases', [{'index': 0, 'name': 'different'}])]:
            changed = copy.deepcopy(self.manifest)
            changed['contracts'][0]['typescript'][0][key] = value
            with self.assertRaises(ValueError):
                case_inventory(changed, self.collected, ['test.ts'], [])
        for runtime in [[], ['test.ts', 'missing.ts']]:
            with self.assertRaises(ValueError):
                case_inventory(self.manifest, self.collected, runtime, [])
        self.manifest['referenceCommit'] = 'different'
        with self.assertRaises(ValueError):
            case_inventory(self.manifest, self.collected, ['test.ts'], [])

    def test_known_differences_are_reported_apart_and_never_count_as_reviewed(self):
        gap = {'path': 'test.ts', 'sha256': 'hash', 'cases': [{'index': 1, 'name': 'parameterized'}]}
        excluded = {'path': 'test.ts', 'sha256': 'hash', 'cases': [{'index': 0, 'name': 'parameterized'}]}
        self.manifest['knownDifferences'] = [
            {'id': 'gap', 'kind': 'gap', 'reason': 'why', 'owner': 'doc.md', 'typescript': [gap]},
            {'id': 'scope', 'kind': 'out-of-scope', 'reason': 'why', 'owner': 'decision.md', 'typescript': [excluded]}]
        result = case_inventory(self.manifest, self.collected, ['test.ts'], [])
        self.assertEqual(result['reviewedCaseCount'], 0)
        self.assertEqual([case['index'] for case in result['knownGapCases']], [1])
        self.assertEqual([case['index'] for case in result['outOfScopeCases']], [0])
        self.assertEqual(result['unreviewedCases'], [])
        for field, value in [('reason', None), ('owner', None), ('kind', 'waived')]:
            changed = copy.deepcopy(self.manifest)
            changed['knownDifferences'][0][field] = value
            with self.assertRaises(ValueError):
                case_inventory(changed, self.collected, ['test.ts'], [])
        twice = copy.deepcopy(self.manifest)
        twice['knownDifferences'][1]['typescript'] = [gap]
        with self.assertRaises(ValueError):
            case_inventory(twice, self.collected, ['test.ts'], [])
        self.manifest['contracts'][0]['typescript'][0]['cases'] = [{'index': 1, 'name': 'parameterized'}]
        with self.assertRaises(ValueError):
            case_inventory(self.manifest, self.collected, ['test.ts'], [])
