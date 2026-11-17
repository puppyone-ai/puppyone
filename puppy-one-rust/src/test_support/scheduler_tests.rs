//! Real discovery workers wake GPUI while App::shutdown uses a timed block.
//! Keep this race covered with real threads, without changing scheduler order.
use gpui::TestAppContext;
use std::{
    sync::{
        Arc, Barrier,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    time::Duration,
};

#[test]
fn timed_foreground_blocks_complete_while_real_workers_schedule_tasks() {
    // The timeout runs outside the scheduler: an inverted mutex order must fail
    // the test instead of hanging inside the very timeout under examination.
    let (done, completed) = mpsc::channel();
    let owner = std::thread::spawn(move || {
        let cx = TestAppContext::single();
        cx.executor().allow_parking();
        let start = Arc::new(Barrier::new(2));
        let worker_start = start.clone();
        let executor = cx.executor();
        let finished = Arc::new(AtomicBool::new(false));
        let worker_finished = finished.clone();
        let worker = std::thread::spawn(move || {
            let (acknowledge, received) = mpsc::channel();
            worker_start.wait();
            for _ in 0..20_000 {
                let acknowledge = acknowledge.clone();
                executor
                    .spawn(async move { acknowledge.send(()).unwrap() })
                    .detach();
                // Bound the runnable queue. This tests concurrent wakeups,
                // not the scheduler's quadratic selection cost on a huge queue.
                received.recv().unwrap();
            }
            worker_finished.store(true, Ordering::Release);
        });
        start.wait();
        while !finished.load(Ordering::Acquire) {
            // GPUI deliberately samples zero timeout ticks too; either a
            // completed future or a returned timeout is valid. Neither may
            // deadlock against a worker scheduling its next runnable.
            let _ = cx
                .foreground_executor()
                .block_with_timeout(Duration::from_secs(1), std::future::ready(()));
            cx.run_until_parked();
        }
        worker.join().unwrap();
        cx.run_until_parked();
        cx.quit();
        done.send(()).unwrap();
    });
    completed
        .recv_timeout(Duration::from_secs(10))
        .expect("timed GPUI blocks deadlocked against real worker wakeups");
    owner.join().unwrap();
}
