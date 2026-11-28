from pathlib import Path
import unittest
from coverage_report import measure, failures


class ProductionCoverage(unittest.TestCase):
    def fixture(self, body):
        root = Path('/tmp/coverage-fixture')
        index = {'files': [{'path': 'src/editor/a.rs', 'excluded': [{'start': 10, 'end': 20}]}]}
        return measure(f'SF:{root}/src/editor/a.rs\n{body}\nend_of_record', index, root)

    def test_excludes_inline_tests_without_losing_zero_hit_production(self):
        report = self.fixture('DA:2,1\nDA:3,0\nDA:11,100\nBRDA:3,0,0,-\nBRDA:3,0,1,1\nBRDA:11,0,0,99')
        self.assertEqual(report['domains']['editor']['lines'], {'covered': 1, 'total': 2, 'percent': 50.0})
        self.assertEqual(report['domains']['editor']['branches'], {'covered': 1, 'total': 2, 'percent': 50.0})
        self.assertEqual(report['files'][0]['uncoveredLines'], [3])

    def test_rejects_line_only_or_empty_coverage(self):
        for body in ('', 'DA:2,1', 'DA:11,1\nBRDA:11,0,0,1'):
            with self.subTest(body=body), self.assertRaises(ValueError):
                self.fixture(body)

    def test_threshold_cannot_pass_on_absent_domain_or_metric(self):
        report = self.fixture('DA:2,1\nBRDA:2,0,0,1\nBRDA:2,0,1,-')
        self.assertEqual(failures(report, {'thresholds': {'editor': {'lines': 100, 'branches': 50}}}), [])
        self.assertEqual(len(failures(report, {'thresholds': {'editor': {'branches': 51}, 'missing': {'lines': 1}}})), 2)
