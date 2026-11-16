use super::super::executable_resolver::SearchContext;
use super::*;
use core::prelude::v1::test;
use std::{cell::Cell, future::Future};

fn run(future: impl Future<Output = ()>) {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    tokio::task::LocalSet::new().block_on(&runtime, future);
}
async fn settle() {
    for _ in 0..12 {
        tokio::task::yield_now().await;
    }
}
fn context(signal: CancelSignal) -> ResolutionContext {
    ResolutionContext {
        environment: Default::default(),
        environment_source: "fixture".into(),
        environment_complete: true,
        environment_reason_code: None,
        executable_search: SearchContext::default(),
        signal: Some(signal),
    }
}
fn missing() -> Observation {
    Observation::NotFound {
        reason_code: "not-found".into(),
    }
}
fn found(id: &str) -> Observation {
    Observation::Found {
        candidate: Box::new(ResolvedCandidate {
            executable_path: format!("/private/installation-fixture/{id}"),
            source: "path-installation".into(),
            args_prefix: vec!["agent".into()],
            environment_overrides: Some(vec![("FIXTURE_SECRET".into(), "hidden".into())]),
            ..Default::default()
        }),
        reason_code: None,
    }
}
fn create(resolve: Resolve) -> InstallationService {
    InstallationService::new(
        DEFAULT_LOCAL_AGENT_INSTALLATION_REGISTRY.clone(),
        Rc::new(|signal| Box::pin(async move { Ok(context(signal)) })),
        resolve,
        Rc::new(|| 1_000),
        None,
    )
}
fn immediate(work: impl Fn(&str) -> AgentResult<Observation> + 'static) -> Resolve {
    Rc::new(move |definition, _| {
        let result = work(&definition.id);
        Box::pin(async move { result })
    })
}
type Recording<T> = (Rc<RefCell<Vec<Arc<T>>>>, Rc<dyn Fn(Arc<T>)>);
fn record<T: 'static>() -> Recording<T> {
    let values = Rc::new(RefCell::new(vec![]));
    let writer = values.clone();
    (
        values,
        Rc::new(move |value| writer.borrow_mut().push(value)),
    )
}

#[test]
fn fast_results_are_replayed_to_late_observers_without_rescanning_or_waiting_for_siblings() {
    run(async {
        let gates = Rc::new(RefCell::new(HashMap::new()));
        let receivers = Rc::new(RefCell::new(HashMap::new()));
        for definition in DEFAULT_LOCAL_AGENT_INSTALLATION_REGISTRY.iter() {
            let (tx, rx) = oneshot::channel();
            gates.borrow_mut().insert(definition.id.clone(), tx);
            receivers.borrow_mut().insert(definition.id.clone(), rx);
        }
        let calls = Rc::new(Cell::new(0));
        let count = calls.clone();
        let service = create(Rc::new(move |definition, _| {
            count.set(count.get() + 1);
            let rx = receivers.borrow_mut().remove(&definition.id).unwrap();
            Box::pin(async move { Ok(rx.await.unwrap()) })
        }));
        let (progress, observe) = record();
        let first = service.discover(false, Some(observe));
        settle().await;
        assert_eq!(calls.get(), 8);
        gates
            .borrow_mut()
            .remove("hermes")
            .unwrap()
            .send(found("hermes"))
            .unwrap();
        settle().await;
        assert!(service.is_scanning());
        assert!(first.peek().is_none());
        assert_eq!(progress.borrow().len(), 1);
        assert_eq!(progress.borrow()[0].available_agent_ids(), ["hermes"]);
        assert_eq!(progress.borrow()[0].completed_agent_count, 1);
        let (late, observe) = record();
        let joined = service.discover(false, Some(observe));
        assert!(first.ptr_eq(&joined));
        assert!(Arc::ptr_eq(&late.borrow()[0], &progress.borrow()[0]));
        assert_eq!(calls.get(), 8);
        drop(service.discover(false, Some(Rc::new(|_| panic!("closed observer")))));
        for (id, tx) in gates.borrow_mut().drain() {
            assert_ne!(id, "hermes");
            tx.send(missing()).unwrap();
        }
        let result = first.await.unwrap();
        assert_eq!(result.available_agent_ids(), ["hermes"]);
        assert_eq!(late.borrow().len(), 8);
        assert!(!service.is_scanning());
    });
}

#[test]
fn disposal_cancels_context_and_rejects_queued_work_without_publishing_late_results() {
    run(async {
        let (tx, rx) = oneshot::channel();
        let rx = Rc::new(RefCell::new(Some(rx)));
        let signal_seen = Rc::new(RefCell::new(None));
        let signal_copy = signal_seen.clone();
        let (published, publish) = record();
        let (progress, observe) = record();
        let service = InstallationService::new(
            DEFAULT_LOCAL_AGENT_INSTALLATION_REGISTRY.clone(),
            Rc::new(move |signal| {
                *signal_copy.borrow_mut() = Some(signal.clone());
                let rx = rx.borrow_mut().take().unwrap();
                Box::pin(async move {
                    rx.await.unwrap();
                    Ok(context(signal))
                })
            }),
            immediate(|_| Ok(missing())),
            Rc::new(|| 1_000),
            Some(publish),
        );
        let scan = service.discover(false, Some(observe));
        settle().await;
        let queued = service.discover(true, None);
        service.dispose();
        assert!(signal_seen.borrow().as_ref().unwrap().is_cancelled());
        assert!(queued.await.is_err());
        assert!(service.discover(false, None).await.is_err());
        tx.send(()).unwrap();
        scan.await.unwrap();
        assert!(progress.borrow().is_empty());
        assert!(published.borrow().is_empty());
        assert!(service.get_snapshot().is_none());
        assert!(!service.is_scanning());
    });
}

#[test]
fn registry_order_is_canonical_and_includes_every_terminal_product() {
    let ids: Vec<_> = DEFAULT_LOCAL_AGENT_INSTALLATION_REGISTRY
        .iter()
        .map(|d| d.id.as_str())
        .collect();
    assert_eq!(
        ids,
        [
            "codex",
            "claude",
            "cursor",
            "opencode",
            "pi",
            "workbuddy-china",
            "workbuddy-international",
            "hermes"
        ]
    );
    for entry in crate::agent::connections::legacy_local_agent_inventory::LOCAL_AGENTS {
        assert!(ids.contains(&entry.id));
    }
}

#[test]
fn public_outcomes_are_path_free_stably_ordered_and_isolate_product_errors() {
    run(async {
        let calls = Rc::new(Cell::new(0));
        let count = calls.clone();
        let service = create(immediate(move |id| {
            count.set(count.get() + 1);
            match id {
                "codex" => Ok(found(id)),
                "claude" => Err(AgentError::new("/secret/filesystem unavailable")),
                _ => Ok(missing()),
            }
        }));
        let result = service.discover(false, None).await.unwrap();
        assert_eq!(result.available_agent_ids(), ["codex"]);
        assert_eq!(
            result.results()[1].reason_code.as_deref(),
            Some("resolver-error")
        );
        let ids: Vec<_> = result
            .results()
            .iter()
            .map(ProductResult::agent_id)
            .collect();
        assert_eq!(
            ids,
            DEFAULT_LOCAL_AGENT_INSTALLATION_REGISTRY
                .iter()
                .map(|d| d.id.as_str())
                .collect::<Vec<_>>()
        );
        let json = result.to_value().to_string();
        for private in [
            "/private/",
            "/secret/",
            "FIXTURE_SECRET",
            "executablePath",
            "argsPrefix",
        ] {
            assert!(!json.contains(private));
        }
        assert_eq!(result.candidate("codex").unwrap().args_prefix, ["agent"]);
        assert_eq!(
            service.discover(false, None).await.unwrap().source(),
            Source::MemoryCache
        );
        assert_eq!(calls.get(), 8);
    });
}

#[test]
fn failed_refresh_retains_evidence_until_definitive_absence_and_rejects_inconsistent_snapshots() {
    run(async {
        let status = Rc::new(Cell::new(Status::Found));
        let current = status.clone();
        let service = create(immediate(move |id| {
            Ok(if id != "codex" {
                missing()
            } else {
                match current.get() {
                    Status::Found => found(id),
                    Status::NotFound => missing(),
                    Status::Failed => Observation::Failed {
                        reason_code: "io-error".into(),
                    },
                }
            })
        }));
        let first = service.discover(false, None).await.unwrap();
        assert_eq!(first.available_agent_ids(), ["codex"]);
        status.set(Status::Failed);
        for _ in 0..2 {
            let failed = service.discover(true, None).await.unwrap();
            assert!(failed.available_agent_ids().is_empty());
            assert_eq!(failed.retained_agent_ids(), ["codex"]);
            assert_eq!(failed.candidate("codex"), first.candidate("codex"));
            assert_eq!(
                service
                    .discover(false, None)
                    .await
                    .unwrap()
                    .retained_agent_ids(),
                ["codex"]
            );
            for invalid in [vec!["claude".into()], vec!["codex".into(), "codex".into()]] {
                let mut malformed = (*failed).clone();
                malformed.retained_agent_ids = invalid;
                assert!(malformed.validate().is_err());
            }
        }
        status.set(Status::NotFound);
        let absent = service.discover(true, None).await.unwrap();
        assert!(absent.retained_agent_ids().is_empty());
        assert!(absent.candidate("codex").is_none());
        status.set(Status::Failed);
        assert!(
            service
                .discover(true, None)
                .await
                .unwrap()
                .retained_agent_ids()
                .is_empty()
        );
    });
}

#[test]
fn session_cache_has_no_ttl_for_empty_or_failed_scans_and_new_sessions_scan_again() {
    run(async {
        for failed in [false, true] {
            let now = Rc::new(Cell::new(1_000));
            let clock = now.clone();
            let calls = Rc::new(Cell::new(0));
            let count = calls.clone();
            let resolver = immediate(move |_| {
                count.set(count.get() + 1);
                Ok(if failed {
                    Observation::Failed {
                        reason_code: "io-error".into(),
                    }
                } else {
                    missing()
                })
            });
            let mut service = create(resolver.clone());
            service.now = Rc::new(move || clock.get());
            assert_eq!(
                service.discover(false, None).await.unwrap().source(),
                Source::Scan
            );
            now.set(now.get() + 86_400_000);
            assert_eq!(
                service.discover(false, None).await.unwrap().source(),
                Source::MemoryCache
            );
            assert_eq!(calls.get(), 8);
            assert_eq!(
                service.discover(true, None).await.unwrap().source(),
                Source::Scan
            );
            assert_eq!(calls.get(), 16);
            service.dispose();
            let next = create(resolver);
            assert_eq!(
                next.discover(false, None).await.unwrap().source(),
                Source::Scan
            );
            assert_eq!(calls.get(), 24);
            next.dispose();
        }
    });
}

#[test]
fn ordinary_reads_during_refresh_return_cached_evidence_without_waiting() {
    run(async {
        let (tx, rx) = oneshot::channel();
        let gate = Rc::new(RefCell::new(Some(rx)));
        let calls = Rc::new(Cell::new(0));
        let mut service = create(immediate(|id| Ok(found(id))));
        service.context = Rc::new(move |signal| {
            let n = calls.get();
            calls.set(n + 1);
            let wait = if n == 1 {
                gate.borrow_mut().take()
            } else {
                None
            };
            Box::pin(async move {
                if let Some(wait) = wait {
                    wait.await.unwrap();
                }
                Ok(context(signal))
            })
        });
        let initial = service.discover(false, None).await.unwrap();
        let pending = service.discover(true, None);
        let cached = service
            .discover(false, None)
            .now_or_never()
            .expect("cached reads must be immediately ready")
            .unwrap();
        assert_eq!(cached.generation(), initial.generation());
        assert_eq!(cached.source(), Source::MemoryCache);
        assert!(pending.peek().is_none());
        tx.send(()).unwrap();
        pending.await.unwrap();
        assert_eq!(service.get_diagnostics().scan_count, 2);
    });
}

#[test]
fn explicit_refresh_during_initial_scan_guarantees_exactly_one_followup_scan() {
    run(async {
        let (tx, rx) = oneshot::channel();
        let gate = Rc::new(RefCell::new(Some(rx)));
        let contexts = Rc::new(Cell::new(0));
        let count = contexts.clone();
        let service = InstallationService::new(
            DEFAULT_LOCAL_AGENT_INSTALLATION_REGISTRY.clone(),
            Rc::new(move |signal| {
                count.set(count.get() + 1);
                let number = count.get();
                let wait = gate.borrow_mut().take();
                Box::pin(async move {
                    if let Some(wait) = wait {
                        wait.await.unwrap();
                    }
                    let mut result = context(signal);
                    result.environment_source = number.to_string();
                    Ok(result)
                })
            }),
            Rc::new(|definition, context| {
                Box::pin(async move {
                    Ok(
                        if definition.id == "claude"
                            || (context.environment_source == "2" && definition.id == "codex")
                        {
                            found(&definition.id)
                        } else {
                            missing()
                        },
                    )
                })
            }),
            Rc::new(|| 1_000),
            None,
        );
        let initial = service.discover(false, None);
        settle().await;
        assert_eq!(contexts.get(), 1);
        let refresh = service.discover(true, None);
        let joined = service.discover(true, None);
        assert!(refresh.ptr_eq(&joined));
        assert!(!refresh.ptr_eq(&initial));
        assert_eq!(contexts.get(), 1);
        tx.send(()).unwrap();
        let first = initial.await.unwrap();
        assert_eq!(first.generation(), 1);
        assert_eq!(first.available_agent_ids(), ["claude"]);
        let second = refresh.await.unwrap();
        assert_eq!(second.generation(), 2);
        assert_eq!(second.available_agent_ids(), ["codex", "claude"]);
        assert!(Arc::ptr_eq(&second, &joined.await.unwrap()));
        assert_eq!(contexts.get(), 2);
        assert_eq!(service.get_diagnostics().queued_refresh_count, 1);
    });
}

#[test]
fn one_context_is_shared_across_products_and_progress_precedes_final_broadcast() {
    run(async {
        let contexts = Rc::new(RefCell::new(Vec::new()));
        let received = contexts.clone();
        let (progress, observe) = record();
        let (published, publish) = record();
        let mut service = create(Rc::new(move |definition, context| {
            received.borrow_mut().push(context);
            Box::pin(async move {
                Ok(if definition.id == "opencode" {
                    found(&definition.id)
                } else {
                    missing()
                })
            })
        }));
        service.publish = Some(publish);
        service.discover(false, Some(observe)).await.unwrap();
        let contexts = contexts.borrow();
        assert_eq!(contexts.len(), 8);
        assert!(contexts.iter().all(|c| Rc::ptr_eq(c, &contexts[0])));
        let progress = progress.borrow();
        assert_eq!(progress.len(), 8);
        for (index, item) in progress.iter().enumerate() {
            assert_eq!(item.completed_agent_count, index + 1);
            assert_eq!(item.total_agent_count, 8);
            assert!(!item.to_value().to_string().contains("/private/"));
        }
        assert_eq!(progress[7].available_agent_ids(), ["opencode"]);
        assert_eq!(published.borrow().len(), 1);
    });
}

#[test]
fn context_and_product_panics_become_failed_observations_and_release_the_scan() {
    run(async {
        let service = create(immediate(|id| {
            if id == "codex" {
                panic!("filesystem port panic")
            }
            Ok(missing())
        }));
        let result = service.discover(false, None).await.unwrap();
        assert_eq!(result.results()[0].status(), Status::Failed);
        assert!(!service.is_scanning());
        let mut service = create(immediate(|_| {
            panic!("resolver must not run after context failure")
        }));
        service.context = Rc::new(|_| panic!("context port panic"));
        let result = service.discover(false, None).await.unwrap();
        assert!(
            result
                .results()
                .iter()
                .all(|r| r.status() == Status::Failed)
        );
        assert!(!service.is_scanning());
    });
}

#[test]
fn a_panicking_scan_settles_and_does_not_poison_the_next_explicit_refresh() {
    run(async {
        let attempts = Rc::new(Cell::new(0));
        let seen = attempts.clone();
        let service = InstallationService::new(
            DEFAULT_LOCAL_AGENT_INSTALLATION_REGISTRY.clone(),
            Rc::new(|signal| Box::pin(async move { Ok(context(signal)) })),
            immediate(|_| Ok(missing())),
            Rc::new(move || {
                let attempt = seen.get();
                seen.set(attempt + 1);
                assert_ne!(attempt, 0, "injected clock failure");
                1_000
            }),
            None,
        );
        let initial = service.discover(false, None);
        settle().await;
        assert!(initial.await.is_err());
        assert!(
            !service.is_scanning(),
            "a failed worker must release its active slot"
        );
        let refreshed = service.discover(true, None);
        let refreshed = tokio::time::timeout(std::time::Duration::from_secs(2), refreshed)
            .await
            .expect("refresh must not queue behind a dead worker")
            .unwrap();
        assert_eq!(refreshed.results().len(), 8);
        assert!(!service.is_scanning());
    });
}

#[test]
fn a_failed_refresh_retains_previous_evidence_and_releases_one_queued_refresh() {
    run(async {
        let fail = Rc::new(Cell::new(false));
        let next_failure = fail.clone();
        let gate = Rc::new(RefCell::new(None::<oneshot::Receiver<()>>));
        let wait = gate.clone();
        let (published, publish) = record();
        let service = InstallationService::new(
            DEFAULT_LOCAL_AGENT_INSTALLATION_REGISTRY.clone(),
            Rc::new(move |signal| {
                let pending = wait.borrow_mut().take();
                Box::pin(async move {
                    if let Some(pending) = pending {
                        pending.await.unwrap();
                    }
                    Ok(context(signal))
                })
            }),
            immediate(|id| Ok(found(id))),
            Rc::new(move || {
                assert!(
                    !next_failure.replace(false),
                    "private clock fixture failure"
                );
                1_000
            }),
            Some(publish),
        );
        let first = service.discover(false, None).await.unwrap();
        let (release, pending) = oneshot::channel();
        *gate.borrow_mut() = Some(pending);
        fail.set(true);
        let failed = service.discover(true, None);
        let queued = service.discover(true, None);
        let joined = service.discover(true, None);
        assert!(queued.ptr_eq(&joined));
        assert_eq!(
            failed.await.unwrap_err().message,
            "Local Agent installation scan failed."
        );
        assert!(service.is_scanning());
        assert!(Arc::ptr_eq(&first, &service.get_snapshot().unwrap()));
        assert_eq!(published.borrow().len(), 1);
        assert!(queued.peek().is_none());
        release.send(()).unwrap();
        let refreshed = queued.await.unwrap();
        assert_eq!(refreshed.generation(), 3);
        assert_eq!(refreshed.available_agent_ids().len(), 8);
        assert_eq!(
            published
                .borrow()
                .iter()
                .map(|s| s.generation())
                .collect::<Vec<_>>(),
            [1, 3]
        );
        assert!(!service.is_scanning());
        assert_eq!(service.get_diagnostics().scan_count, 3);
    });
}
