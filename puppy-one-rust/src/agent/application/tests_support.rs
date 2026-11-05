//! Async test runners on the Agent host's single-threaded runtime.
use std::future::Future;

/// One async test with a paused clock (`vi.useFakeTimers()`).
pub fn run_paused_local<F: Future>(future: F) -> F::Output {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .start_paused(true)
        .build()
        .expect("test runtime");
    tokio::task::LocalSet::new().block_on(&runtime, future)
}

/// One async test on a real clock.
pub fn run_local<F: Future>(future: F) -> F::Output {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("test runtime");
    tokio::task::LocalSet::new().block_on(&runtime, future)
}
