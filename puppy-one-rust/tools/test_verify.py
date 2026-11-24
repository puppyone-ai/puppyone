import unittest
from verify import CARGO_ORDER, CHECKS, ordered, schedule


def check(name, lane, needs=()):
    return (name, ['true'], lane, needs)


def drive(checks, light_slots, finish_order=None, serial=False):
    """Run the schedule to the end; return each batch's names and the peak load per lane."""
    plan = schedule(checks, light_slots, serial=serial)
    lanes = {name: lane for name, _, lane, _ in checks}
    batches, running, peaks = [], [], []
    batch = next(plan)
    while True:
        batches.append([name for name, _, _, _ in batch])
        running += batches[-1]
        peaks.append([lanes[name] for name in running])
        if not running:
            break
        # Finish the oldest running check unless the test names another.
        done = next((name for name in (finish_order or []) if name in running), running[0])
        running.remove(done)
        try:
            batch = plan.send([done])
        except StopIteration:
            break
    return batches, peaks


class VerificationSchedule(unittest.TestCase):
    def test_every_check_runs_once(self):
        checks = [check('a', 'light'), check('b', 'cargo'), check('c', 'light'), check('d', 'cargo'), check('e', 'alone')]
        batches, _ = drive(checks, light_slots=2)
        started = [name for batch in batches for name in batch]
        self.assertCountEqual(started, ['a', 'b', 'c', 'd', 'e'])

    def test_light_checks_share_a_pool_while_cargo_checks_go_one_at_a_time(self):
        checks = [check(f'l{i}', 'light') for i in range(5)] + [check(f'c{i}', 'cargo') for i in range(3)]
        batches, peaks = drive(checks, light_slots=3)
        self.assertEqual(sorted(batches[0]), ['c0', 'l0', 'l1', 'l2'])
        for load in peaks:
            self.assertLessEqual(load.count('light'), 3)
            self.assertLessEqual(load.count('cargo'), 1)

    def test_a_timed_check_waits_for_everything_and_runs_alone(self):
        checks = [check('timed', 'alone'), check('l', 'light'), check('c', 'cargo')]
        batches, peaks = drive(checks, light_slots=4)
        self.assertEqual(batches[-1], ['timed'])
        self.assertEqual(peaks[-1], ['alone'])

    def test_a_reader_starts_only_after_the_check_it_reads(self):
        checks = [check('cases', 'light'), check('other', 'light'), check('contracts', 'cargo', ('cases',))]
        batches, _ = drive(checks, light_slots=2, finish_order=['other', 'cases'])
        self.assertNotIn('contracts', batches[0] + batches[1])
        self.assertIn('contracts', batches[2])

    def test_a_dependency_outside_the_selection_does_not_block(self):
        batches, _ = drive([check('contracts', 'cargo', ('cases',))], light_slots=2)
        self.assertEqual(batches[0], ['contracts'])

    def test_serial_runs_one_check_at_a_time_in_order(self):
        checks = [check('a', 'light'), check('b', 'cargo'), check('c', 'light')]
        batches, peaks = drive(checks, light_slots=4, serial=True)
        self.assertEqual([batch for batch in batches if batch], [['a'], ['b'], ['c']])
        self.assertTrue(all(len(load) <= 1 for load in peaks))

    def test_the_real_checks_have_one_lane_order_and_known_dependencies(self):
        names = [name for name, _, _, _ in CHECKS]
        self.assertEqual(len(names), len(set(names)))
        cargo = [name for name, _, lane, _ in CHECKS if lane == 'cargo']
        self.assertCountEqual(cargo, CARGO_ORDER)
        for name, _, lane, needs in CHECKS:
            self.assertIn(lane, ('light', 'cargo', 'alone'))
            for dependency in needs:
                self.assertIn(dependency, names)
        self.assertEqual([name for name, _, _, _ in ordered(CHECKS)][-1], 'editor-frames')


if __name__ == '__main__':
    unittest.main()
