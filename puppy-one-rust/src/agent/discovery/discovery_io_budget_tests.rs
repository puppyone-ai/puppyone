use super::*;
use crate::agent::application::tests_support::run_local;
use crate::agent::tasks::Canceller;
use core::prelude::v1::test;
use futures_util::future::join_all;
use std::sync::{Arc, Condvar, Mutex};

// The production budget is process-wide. Saturation acceptance must not steal
// the slots used by unrelated resolver tests running on other test threads.
fn isolated(name: &str) -> bool {
    if std::env::var("PUPPYONE_IO_BUDGET_FIXTURE").as_deref() == Ok(name) {
        return false;
    }
    let output = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            &format!("{}::{name}", module_path!().split_once("::").unwrap().1),
            "--nocapture",
        ])
        .env("PUPPYONE_IO_BUDGET_FIXTURE", name)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(String::from_utf8_lossy(&output.stdout).contains("1 passed"));
    true
}

#[derive(Default)]
struct Gate {
    open: Mutex<bool>,
    changed: Condvar,
}
impl Gate {
    fn wait(&self) -> AgentResult<()> {
        let (open, _) = self
            .changed
            .wait_timeout_while(self.open.lock().unwrap(), Duration::from_secs(5), |open| {
                !*open
            })
            .unwrap();
        if *open {
            Ok(())
        } else {
            Err(AgentError::new("fixture release deadline"))
        }
    }
    fn release(&self) {
        *self.open.lock().unwrap() = true;
        self.changed.notify_all();
    }
}
struct Release(Arc<Gate>);
impl Drop for Release {
    fn drop(&mut self) {
        self.0.release();
    }
}
async fn recovered() {
    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    loop {
        match run_discovery_io(|| Ok("recovered"), None, None).await {
            Ok(value) => {
                assert_eq!(value, "recovered");
                break;
            }
            Err(error) => {
                assert!(error.is("filesystem-busy"), "{error:?}");
                assert!(
                    std::time::Instant::now() < deadline,
                    "capacity never recovered"
                );
                tokio::task::yield_now().await;
            }
        }
    }
}

#[test]
fn timed_out_work_keeps_all_slots_until_the_blocking_tasks_really_finish() {
    if isolated("timed_out_work_keeps_all_slots_until_the_blocking_tasks_really_finish") {
        return;
    }
    run_local(async {
        let release = Release(Arc::new(Gate::default()));
        let work = (0..policy::MAX_PENDING_TASKS).map(|_| {
            let gate = release.0.clone();
            run_discovery_io(move || gate.wait(), None, Some(10))
        });
        for result in join_all(work).await {
            assert!(result.unwrap_err().is("filesystem-timeout"));
        }
        assert!(
            run_discovery_io(|| Ok(()), None, None)
                .await
                .unwrap_err()
                .is("filesystem-busy")
        );
        release.0.release();
        recovered().await;
    });
}

#[test]
fn cancelled_work_retains_capacity_but_pre_cancelled_work_never_dispatches() {
    if isolated("cancelled_work_retains_capacity_but_pre_cancelled_work_never_dispatches") {
        return;
    }
    run_local(async {
        let release = Release(Arc::new(Gate::default()));
        let controller = Canceller::new();
        let reason = AgentError::coded("fixture-cancelled", "fixture cancelled");
        let mut handles = Vec::new();
        for _ in 0..policy::MAX_PENDING_TASKS {
            let gate = release.0.clone();
            let signal = controller.signal();
            handles.push(tokio::task::spawn_local(async move {
                run_discovery_io(move || gate.wait(), Some(&signal), Some(10_000)).await
            }));
        }
        // Every local task admits its blocking work before its first await.
        tokio::task::yield_now().await;
        controller.cancel(reason.clone());
        for handle in handles {
            assert_eq!(handle.await.unwrap().unwrap_err(), reason);
        }
        assert!(
            run_discovery_io(|| Ok(()), None, None)
                .await
                .unwrap_err()
                .is("filesystem-busy")
        );
        assert_eq!(
            run_discovery_io(
                || panic!("pre-cancelled work dispatched"),
                Some(&controller.signal()),
                None
            )
            .await as AgentResult<()>,
            Err(reason)
        );
        release.0.release();
        recovered().await;
    });
}

#[test]
fn panicking_and_failed_tasks_release_capacity_for_the_next_scan() {
    if isolated("panicking_and_failed_tasks_release_capacity_for_the_next_scan") {
        return;
    }
    run_local(async {
        for _ in 0..policy::MAX_PENDING_TASKS {
            let error = run_discovery_io(
                || -> AgentResult<()> { panic!("fixture filesystem panic") },
                None,
                None,
            )
            .await
            .unwrap_err();
            assert!(
                error.message.contains("fixture filesystem panic"),
                "{error:?}"
            );
        }
        assert_eq!(
            run_discovery_io(|| Ok("after panic"), None, None)
                .await
                .unwrap(),
            "after panic"
        );
        let failure = AgentError::coded("fixture-io-error", "fixture file failure");
        for _ in 0..policy::MAX_PENDING_TASKS * 2 {
            let failure = failure.clone();
            assert!(
                run_discovery_io(move || Err::<(), _>(failure), None, None)
                    .await
                    .unwrap_err()
                    .is("fixture-io-error")
            );
        }
        recovered().await;
    });
}
