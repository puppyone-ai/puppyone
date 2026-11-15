use super::*;
use crate::agent::installation::{
    executable_resolver::{Observation, ResolutionContext, ResolvedCandidate, SearchContext},
    installation_registry::DEFAULT_LOCAL_AGENT_INSTALLATION_REGISTRY,
    installation_service::InstallationService,
};
use crate::features::local_agents::discovery;
use core::prelude::v1::test;
use std::{
    rc::Rc,
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
    time::{Duration, Instant},
};

#[track_caller]
fn until(cx: &mut TestAppContext, mut condition: impl FnMut(&mut TestAppContext) -> bool) {
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        cx.run_until_parked();
        if condition(cx) {
            return;
        }
        assert!(Instant::now() < deadline, "native discovery did not settle");
        std::thread::sleep(Duration::from_millis(2));
    }
}

#[gpui::test]
fn native_settings_share_initial_work_and_reopened_windows_reuse_cache_while_refreshes_coalesce(
    cx: &mut TestAppContext,
) {
    cx.executor().allow_parking();
    cx.update(gpui_kit::init);
    let scans = Arc::new(AtomicUsize::new(0));
    let count = scans.clone();
    let cancelled = Arc::new(AtomicBool::new(false));
    let observed_cancel = cancelled.clone();
    let (release, gates) = async_channel::unbounded::<()>();
    let (host, events) = crate::agent::host::InstallationHost::with_factory(move || {
        let count = count.clone();
        InstallationService::new(
            DEFAULT_LOCAL_AGENT_INSTALLATION_REGISTRY.clone(),
            Rc::new(move |signal| {
                let n = count.fetch_add(1, Ordering::SeqCst) + 1;
                let gate = gates.clone();
                let observed = observed_cancel.clone();
                signal.on_cancel(move || observed.store(true, Ordering::SeqCst));
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
            Rc::new(|definition, context| {
                Box::pin(async move {
                    Ok(
                        if definition.id == "claude"
                            || (context.environment_source != "1" && definition.id == "codex")
                        {
                            Observation::Found {
                                candidate: Box::new(ResolvedCandidate {
                                    executable_path: format!("/fixture/{}", definition.id),
                                    source: "fixture".into(),
                                    ..Default::default()
                                }),
                                reason_code: None,
                            }
                        } else {
                            Observation::NotFound {
                                reason_code: "not-found".into(),
                            }
                        },
                    )
                })
            }),
            Rc::new(crate::clock::now_ms),
            None,
        )
    });
    let store = cx.update(|cx| discovery::install(host, events, cx));
    let prefs = cx.new(|_| PreferencesStore::memory());
    let first = cx.add_window(|window, cx| AgentSettings::new(prefs.clone(), window, cx));
    let second = cx.add_window(|window, cx| AgentSettings::new(prefs.clone(), window, cx));
    until(cx, |_| scans.load(Ordering::SeqCst) == 1);
    first
        .update(cx, |s, _, cx| {
            assert_eq!(s.discovery.entity_id(), store.entity_id());
            assert!(s.scanning);
            s.refresh(cx);
            s.refresh(cx);
        })
        .unwrap();
    release.send_blocking(()).unwrap();
    until(cx, |_| scans.load(Ordering::SeqCst) == 2);
    assert!(store.read_with(cx, |s, _| s.scanning));
    release.send_blocking(()).unwrap();
    until(cx, |cx| !store.read_with(cx, |s, _| s.scanning));
    for window in [first, second] {
        window
            .update(cx, |s, _, _| {
                assert!(!s.scanning);
                let ids: Vec<_> = s
                    .installations
                    .as_ref()
                    .unwrap()
                    .iter()
                    .map(|i| i.id)
                    .collect();
                assert_eq!(ids, ["claude", "codex", "puppyone-agent"]);
            })
            .unwrap();
        window
            .update(cx, |_, window, _| window.remove_window())
            .unwrap();
    }
    let reopened = cx.add_window(|window, cx| AgentSettings::new(prefs.clone(), window, cx));
    reopened
        .update(cx, |s, _, _| {
            assert!(!s.scanning);
            assert_eq!(s.installations.as_ref().unwrap().len(), 3);
        })
        .unwrap();
    cx.run_until_parked();
    assert_eq!(scans.load(Ordering::SeqCst), 2);
    reopened.update(cx, |s, _, cx| s.refresh(cx)).unwrap();
    until(cx, |_| scans.load(Ordering::SeqCst) == 3);
    cx.update(App::shutdown);
    until(cx, |_| cancelled.load(Ordering::SeqCst));
    assert!(!store.read_with(cx, |s, _| s.scanning));
    until(cx, |_| release.is_closed());
    assert!(
        release.send_blocking(()).is_err(),
        "shutdown must retire the real discovery runtime"
    );
}

#[gpui::test]
fn native_settings_show_fast_evidence_while_siblings_wait_and_view_closure_does_not_cancel_discovery(
    cx: &mut TestAppContext,
) {
    cx.executor().allow_parking();
    cx.update(gpui_kit::init);
    let mut releases = std::collections::HashMap::new();
    let mut gates = std::collections::HashMap::new();
    for definition in DEFAULT_LOCAL_AGENT_INSTALLATION_REGISTRY.iter() {
        let (tx, rx) = async_channel::bounded::<()>(1);
        releases.insert(definition.id.clone(), tx);
        gates.insert(definition.id.clone(), rx);
    }
    let calls = Arc::new(AtomicUsize::new(0));
    let count = calls.clone();
    let (host, events) = crate::agent::host::InstallationHost::with_factory(move || {
        InstallationService::new(
            DEFAULT_LOCAL_AGENT_INSTALLATION_REGISTRY.clone(),
            Rc::new(|signal| {
                Box::pin(async {
                    Ok(ResolutionContext {
                        environment: Default::default(),
                        environment_source: "test".into(),
                        environment_complete: true,
                        environment_reason_code: None,
                        executable_search: SearchContext::default(),
                        signal: Some(signal),
                    })
                })
            }),
            Rc::new(move |definition, _| {
                count.fetch_add(1, Ordering::SeqCst);
                let gate = gates[&definition.id].clone();
                Box::pin(async move {
                    gate.recv().await.unwrap();
                    Ok(if definition.id == "hermes" {
                        Observation::Found {
                            candidate: Box::new(ResolvedCandidate {
                                executable_path: "/fixture/hermes".into(),
                                source: "fixture".into(),
                                ..Default::default()
                            }),
                            reason_code: None,
                        }
                    } else {
                        Observation::NotFound {
                            reason_code: "not-found".into(),
                        }
                    })
                })
            }),
            Rc::new(crate::clock::now_ms),
            None,
        )
    });
    let store = cx.update(|cx| discovery::install(host, events, cx));
    let prefs = cx.new(|_| PreferencesStore::memory());
    let first = cx.add_window(|window, cx| AgentSettings::new(prefs.clone(), window, cx));
    until(cx, |_| calls.load(Ordering::SeqCst) == 8);
    releases
        .remove("hermes")
        .unwrap()
        .send_blocking(())
        .unwrap();
    until(cx, |cx| {
        store.read_with(cx, |s, _| {
            s.inventory().installations.iter().any(|i| i.id == "hermes")
        })
    });
    first
        .update(cx, |s, _, _| {
            assert!(s.scanning);
            assert!(
                s.installations
                    .as_ref()
                    .unwrap()
                    .iter()
                    .any(|i| i.id == "hermes")
            );
        })
        .unwrap();
    first
        .update(cx, |_, window, _| window.remove_window())
        .unwrap();
    let reopened = cx.add_window(|window, cx| AgentSettings::new(prefs.clone(), window, cx));
    reopened
        .update(cx, |s, _, _| {
            assert!(s.scanning);
            assert!(
                s.installations
                    .as_ref()
                    .unwrap()
                    .iter()
                    .any(|i| i.id == "hermes")
            );
        })
        .unwrap();
    for (_, release) in releases {
        release.send_blocking(()).unwrap();
    }
    until(cx, |cx| !store.read_with(cx, |s, _| s.scanning));
    reopened
        .update(cx, |s, _, _| {
            assert!(!s.scanning);
            assert_eq!(s.installations.as_ref().unwrap().len(), 2);
        })
        .unwrap();
    assert_eq!(calls.load(Ordering::SeqCst), 8);
    cx.update(App::shutdown);
}
