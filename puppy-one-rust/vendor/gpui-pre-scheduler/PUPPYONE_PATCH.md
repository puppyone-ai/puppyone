# GPUI test scheduler lock order

Upstream: `gpui-pre-scheduler` 0.3.9, Zed snapshot
`93d745668805029476e6d7fbb19652116fed51de`. The source and Apache-2.0
license are vendored unchanged except for `src/test_scheduler.rs` below.

`TestScheduler::block_until` used to lock the RNG before reading
`state.timeout_ticks`, while `schedule_local` and
`schedule_background_with_priority` hold state before RNG. A real installation
worker waking the UI during `App::shutdown` could deadlock both threads before
the shutdown timeout was polled. Captured thread samples reproduced both sides
of this inversion in the full application suite and an isolated regression.

Read and release the timeout range's state guard before taking RNG. The random
range, scheduling policy and timeout behavior are unchanged; the platform
scheduler is untouched. Remove this patch only after a dependency update includes
the lock-order fix and the regression remains green.

`src/test_support/scheduler_tests.rs` exercises timed foreground blocks
against 20,000 acknowledged real worker submissions, with a 10-second watchdog on a separate
thread. It fails on the unpatched dependency. The existing local Agent settings
shutdown tests continue to exercise actual application/host cleanup.
