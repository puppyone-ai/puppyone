use super::*;
use core::prelude::v1::test;
use std::time::Duration;

#[test]
fn factory_panic_reports_unavailable_and_rejects_future_requests() {
    let (host, mut events) = InstallationHost::with_factory(|| panic!("injected factory failure"));
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    let event = runtime
        .block_on(async { tokio::time::timeout(Duration::from_secs(2), events.recv()).await });
    assert!(matches!(event, Ok(Some(InstallationEvent::Unavailable))));
    assert!(!host.discover(2, true));
    assert!(runtime.block_on(events.recv()).is_none());
}

#[test]
fn closing_the_host_does_not_wait_for_an_uninterruptible_metadata_worker() {
    use crate::agent::installation::installation_registry::DEFAULT_LOCAL_AGENT_INSTALLATION_REGISTRY;
    use std::{sync::mpsc, time::Instant};
    let (ready, started) = mpsc::channel();
    let (release, blocked) = mpsc::channel();
    let (host, mut events, worker) = InstallationHost::start(move || {
        tokio::task::spawn_blocking(move || {
            ready.send(()).unwrap();
            let _ = blocked.recv();
        });
        InstallationService::new(
            DEFAULT_LOCAL_AGENT_INSTALLATION_REGISTRY.clone(),
            Rc::new(|_| Box::pin(std::future::pending())),
            Rc::new(|_, _| Box::pin(std::future::pending())),
            Rc::new(|| 1_000),
            None,
        )
    });
    let worker = worker.unwrap();
    started.recv_timeout(Duration::from_secs(2)).unwrap();
    assert!(host.discover(1, false));
    host.close();
    let deadline = Instant::now() + Duration::from_secs(1);
    while !worker.is_finished() && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(2));
    }
    let stopped = worker.is_finished();
    // Always release the fixture, including on RED, before checking ownership.
    release.send(()).unwrap();
    worker.join().unwrap();
    assert!(
        stopped,
        "closing the discovery runtime waited for blocking filesystem work"
    );
    assert!(!host.discover(2, true));
    assert!(
        events.try_recv().is_err(),
        "closed hosts cannot publish late completions"
    );
}
