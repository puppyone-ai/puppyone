use super::*;
use crate::platform::local_agent_setup::ObservationStatus;
use core::prelude::v1::test;

#[gpui::test]
fn disconnected_host_events_settle_scanning_as_failed(cx: &mut TestAppContext) {
    cx.executor().allow_parking();
    cx.update(gpui_kit::init);
    let (host, _actual_events) = Host::with_factory(super::fixtures::service);
    let (sender, events) = tokio::sync::mpsc::unbounded_channel();
    let store = cx.update(|cx| install(host, events, cx));
    assert!(store.read_with(cx, |s, _| s.scanning));
    drop(sender);
    cx.run_until_parked();
    store.read_with(cx, |s, _| {
        assert!(
            !s.scanning,
            "a closed host cannot produce a future completion"
        );
        assert!(s.failed);
        assert!(s.inventory().observations.is_empty());
    });
    cx.update(App::shutdown);
}

use crate::agent::installation::{
    executable_resolver::{Observation, ResolutionContext, ResolvedCandidate, SearchContext},
    installation_registry::DEFAULT_LOCAL_AGENT_INSTALLATION_REGISTRY,
    installation_service::InstallationService,
};
use std::{
    rc::Rc,
    sync::atomic::{AtomicUsize, Ordering::SeqCst},
    time::{Duration, Instant},
};

/// Scans wait to be released; `hermes` waits once more on the first scan.
struct Script {
    scans: Arc<AtomicUsize>,
    scan: async_channel::Sender<()>,
    slow: async_channel::Sender<()>,
}
fn found(id: &str) -> Observation {
    Observation::Found {
        candidate: Box::new(ResolvedCandidate {
            executable_path: format!("/fixture/{id}"),
            source: "fixture".into(),
            ..Default::default()
        }),
        reason_code: None,
    }
}
fn missing() -> Observation {
    Observation::NotFound {
        reason_code: "not-found".into(),
    }
}
/// The shared store over a discovery whose `answer(scan, id)` says what
/// each product is found as.
fn scripted(
    cx: &mut TestAppContext,
    answer: fn(usize, &str) -> Observation,
) -> (Entity<Installations>, Script) {
    cx.executor().allow_parking();
    cx.update(gpui_kit::init);
    let scans = Arc::new(AtomicUsize::new(0));
    let (scan, scan_gates) = async_channel::unbounded::<()>();
    let (slow, slow_gates) = async_channel::unbounded::<()>();
    let count = scans.clone();
    let (host, events) = Host::with_factory(move || {
        InstallationService::new(
            DEFAULT_LOCAL_AGENT_INSTALLATION_REGISTRY.clone(),
            Rc::new(move |signal| {
                let n = count.fetch_add(1, SeqCst) + 1;
                let gate = scan_gates.clone();
                Box::pin(async move {
                    gate.recv().await.unwrap();
                    Ok(ResolutionContext {
                        environment: Default::default(),
                        environment_source: n.to_string(),
                        environment_complete: true,
                        environment_reason_code: None,
                        executable_search: SearchContext::default(),
                        signal: Some(signal),
                    })
                })
            }),
            Rc::new(move |definition, context| {
                let scan: usize = context.environment_source.parse().unwrap();
                let id = definition.id.clone();
                let slow = slow_gates.clone();
                Box::pin(async move {
                    if scan == 1 && id == "hermes" {
                        slow.recv().await.unwrap();
                    }
                    Ok(answer(scan, &id))
                })
            }),
            Rc::new(crate::clock::now_ms),
            None,
        )
    });
    let store = cx.update(|cx| install(host, events, cx));
    (store, Script { scans, scan, slow })
}
#[track_caller]
fn until(cx: &mut TestAppContext, mut ready: impl FnMut(&mut TestAppContext) -> bool) {
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        cx.run_until_parked();
        if ready(cx) {
            return;
        }
        assert!(Instant::now() < deadline, "discovery did not settle");
        std::thread::sleep(Duration::from_millis(2));
    }
}
fn ids(store: &Entity<Installations>, cx: &mut TestAppContext) -> Vec<&'static str> {
    store.read_with(cx, |s, _| {
        s.inventory().installations.iter().map(|i| i.id).collect()
    })
}

/// `shows installed Agents incrementally`, `reopening during the first scan
/// keeps the same request`, `retains results while refreshing, clears old
/// warnings, and removes only definitive missing installations`: what a
/// scan finds shows before it ends; asking again while it runs joins it; a
/// refresh keeps every row and drops old warnings until it knows, then
/// removes only what is definitely gone and keeps what could not be
/// inspected, with its failure.
#[gpui::test]
fn found_agents_show_while_the_scan_runs_and_a_refresh_keeps_them_until_it_knows(
    cx: &mut TestAppContext,
) {
    let (store, script) = scripted(cx, |scan, id| match (scan, id) {
        (1, "codex" | "claude" | "hermes") | (2, "hermes") => found(id),
        (2, "codex") => Observation::Failed {
            reason_code: "permission-denied".into(),
        },
        _ => missing(),
    });
    until(cx, |_| script.scans.load(SeqCst) == 1);
    assert_eq!(cx.update(super::store).entity_id(), store.entity_id());
    store.read_with(cx, |s, _| assert!(s.scanning && !s.refreshing));
    script.scan.send_blocking(()).unwrap();
    until(cx, |cx| ids(&store, cx).contains(&"codex"));
    assert_eq!(ids(&store, cx), ["claude", "codex", "puppyone-agent"]);
    store.read_with(cx, |s, _| {
        assert!(s.scanning);
        assert!(s.inventory().observations.is_empty());
    });
    script.slow.send_blocking(()).unwrap();
    until(cx, |cx| !store.read_with(cx, |s, _| s.scanning));
    assert_eq!(
        ids(&store, cx),
        ["claude", "codex", "hermes", "puppyone-agent"]
    );
    assert_eq!(script.scans.load(SeqCst), 1);
    store.update(cx, |s, cx| s.refresh(cx));
    store.read_with(cx, |s, _| {
        assert!(s.scanning && s.refreshing);
        assert!(s.inventory().observations.is_empty());
    });
    assert_eq!(
        ids(&store, cx),
        ["claude", "codex", "hermes", "puppyone-agent"]
    );
    script.scan.send_blocking(()).unwrap();
    until(cx, |cx| !store.read_with(cx, |s, _| s.scanning));
    assert_eq!(ids(&store, cx), ["codex", "hermes", "puppyone-agent"]);
    store.read_with(cx, |s, _| {
        assert!(!s.refreshing && !s.failed);
        let codex = s
            .inventory()
            .observations
            .into_iter()
            .find(|o| o.id == "codex");
        assert_eq!(codex.unwrap().status, ObservationStatus::Failed);
    });
    assert_eq!(script.scans.load(SeqCst), 2);
    cx.update(App::shutdown);
}

/// `reuses the session result on reopen`, `does not silently retry an empty
/// first result on reopen`, `shows a retry state when a known installation
/// is found through an incomplete environment`: an empty first result
/// stands for every later consumer, which never scans again on its own; an
/// explicit refresh scans once and is a refresh only because there was
/// evidence to show; an Agent found through an incomplete environment is
/// offered and its evidence says the environment was unavailable; a
/// refresh that fails keeps the last successful list.
#[gpui::test]
fn only_an_explicit_refresh_scans_again(cx: &mut TestAppContext) {
    let (store, script) = scripted(cx, |scan, id| match (scan, id) {
        (2, "codex") => match found(id) {
            Observation::Found { candidate, .. } => Observation::Found {
                candidate,
                reason_code: Some("environment-unavailable".into()),
            },
            other => other,
        },
        _ => missing(),
    });
    script.scan.send_blocking(()).unwrap();
    script.slow.send_blocking(()).unwrap();
    until(cx, |cx| !store.read_with(cx, |s, _| s.scanning));
    assert_eq!(ids(&store, cx), ["puppyone-agent"]);
    store.read_with(cx, |s, _| {
        assert!(!s.failed && !s.inventory().observations.is_empty())
    });
    for _ in 0..3 {
        assert_eq!(cx.update(super::store).entity_id(), store.entity_id());
        cx.run_until_parked();
    }
    std::thread::sleep(Duration::from_millis(50));
    cx.run_until_parked();
    assert_eq!(script.scans.load(SeqCst), 1);
    store.update(cx, |s, cx| s.refresh(cx));
    store.read_with(cx, |s, _| assert!(s.refreshing));
    script.scan.send_blocking(()).unwrap();
    until(cx, |cx| !store.read_with(cx, |s, _| s.scanning));
    assert_eq!(ids(&store, cx), ["codex", "puppyone-agent"]);
    store.read_with(cx, |s, _| {
        let codex = s
            .inventory()
            .observations
            .into_iter()
            .find(|o| o.id == "codex");
        assert_eq!(
            codex.unwrap().failure,
            Some(crate::platform::local_agent_setup::ObservationFailure::EnvironmentUnavailable)
        );
    });
    assert_eq!(script.scans.load(SeqCst), 2);
    // A refresh that cannot run keeps the last list and says it failed.
    store.update(cx, |s, cx| {
        s.host.close();
        s.refresh(cx);
    });
    store.read_with(cx, |s, _| assert!(s.failed && !s.scanning && !s.refreshing));
    assert_eq!(ids(&store, cx), ["codex", "puppyone-agent"]);
    cx.update(App::shutdown);
}
