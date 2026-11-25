//! The open checkout's Cloud association (`useCurrentRepositoryCloudContext`
//! with `repositoryContextRecovery`), one per window, for the Header
//! location and the local → Cloud switch.
//!
//! The context is resolved afresh for each checkout, account, session
//! generation and API: remotes are read on a worker, the remotes alone
//! decide local-only / conflict / wrong host / sign in, and only then is the
//! exact Project authorized. Transport failures retry at most twice with
//! jitter; a returning window may probe once more. A hidden window waits:
//! a retry that comes due then runs as the window's probe when it is
//! visible again. Late results of an older key are dropped.
use crate::{
    cloud::auth::Cancellation,
    workspace::cloud::{
        recovery::{Controller, Next},
        repository::{self, Context as Association, Precheck},
    },
};
use gpui::*;
use std::{
    path::{Path, PathBuf},
    sync::atomic::AtomicBool,
};

pub struct RepositoryCloud {
    key: Option<String>,
    root: Option<PathBuf>,
    pub context: Association,
    epoch: u64,
    cancel: Option<Cancellation>,
    recovery: Controller,
    /// Whether the window is visible (`document.visibilityState`).
    visible: bool,
}

fn jitter() -> f64 {
    let mut bytes = [0u8; 4];
    let _ = getrandom::fill(&mut bytes);
    f64::from(u32::from_le_bytes(bytes)) / (f64::from(u32::MAX) + 1.)
}

impl RepositoryCloud {
    pub fn new() -> Self {
        Self {
            key: None,
            root: None,
            context: Association::LocalOnly,
            epoch: 0,
            cancel: None,
            recovery: Controller::new(),
            visible: true,
        }
    }
    /// The checkout (`None`: no local project) under the current account.
    /// A changed key discards the old resolution and resolves again.
    pub fn sync(&mut self, root: Option<&Path>, enabled: bool, cx: &mut Context<Self>) {
        let account = crate::features::cloud::account::broker_and_binding(cx)
            .map(|(_, b)| format!("{}\n{}\n{}", b.user, b.epoch, b.environment.api()));
        let api = crate::features::cloud::account::environment(cx).map(|e| e.api().to_owned());
        let key = root.filter(|_| enabled).map(|root| {
            format!(
                "{}\n{}\n{}",
                root.display(),
                account.unwrap_or_default(),
                api.unwrap_or_default()
            )
        });
        if key == self.key {
            return;
        }
        self.key = key;
        self.root = root.filter(|_| enabled).map(Path::to_path_buf);
        self.recovery = Controller::new();
        self.resolve(cx);
    }
    /// Retry from a recovery surface: a fresh attempt with a fresh budget.
    pub fn retry(&mut self, cx: &mut Context<Self>) {
        self.recovery = Controller::new();
        self.resolve(cx);
    }
    /// A returning window or regained network: one throttled probe.
    pub fn probe(&mut self, cx: &mut Context<Self>) {
        let now = cx.background_executor().now();
        if let Next::RetryAfter(delay) = self.recovery.probe(now, self.visible) {
            self.schedule(delay, cx);
        }
    }
    /// The window was hidden or shown (`visibilitychange`); a window
    /// that shows again probes.
    pub fn set_visible(&mut self, visible: bool, cx: &mut Context<Self>) {
        self.visible = visible;
        if visible {
            self.probe(cx);
        }
    }
    fn schedule(&mut self, delay: std::time::Duration, cx: &mut Context<Self>) {
        let epoch = self.epoch;
        cx.spawn(async move |this, cx| {
            cx.background_executor().timer(delay).await;
            let _ = this.update(cx, |s, cx| {
                if s.epoch == epoch && s.recovery.due(s.visible) {
                    s.resolve(cx);
                }
            });
        })
        .detach();
    }
    fn resolve(&mut self, cx: &mut Context<Self>) {
        self.epoch += 1;
        if let Some(cancel) = self.cancel.take() {
            cancel.cancel();
        }
        let Some(root) = self.root.clone() else {
            self.context = Association::LocalOnly;
            cx.notify();
            return;
        };
        let account = crate::features::cloud::account::broker_and_binding(cx);
        let environment = crate::features::cloud::account::environment(cx);
        let api = environment.as_ref().map(|e| e.api().to_owned());
        let hosted_git_origin = environment.as_ref().and_then(|e| e.hosted_git_origin());
        let cancel = Cancellation::default();
        self.cancel = Some(cancel.clone());
        let epoch = self.epoch;
        self.context = Association::Resolving;
        self.recovery.start(cx.background_executor().now());
        cx.notify();
        let task = cx.background_executor().spawn(async move {
            let urls: Vec<String> =
                crate::platform::git::repository_info(&root, &AtomicBool::new(false))
                    .map(|info| {
                        info.remotes
                            .into_iter()
                            .flat_map(|r| r.fetch_url.into_iter().chain(r.push_url))
                            .collect()
                    })
                    .unwrap_or_default();
            match repository::precheck(
                urls.iter().map(String::as_str),
                api.as_deref(),
                hosted_git_origin.as_deref(),
                account.is_some(),
            ) {
                Precheck::Decided(context) => Ok(context),
                Precheck::Authorize(target) => {
                    let (broker, binding) = account.expect("signed in");
                    repository::authorize(&broker, &binding, &target, &cancel)
                }
            }
        });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            let _ = this.update(cx, |s, cx| {
                if s.epoch != epoch {
                    return;
                }
                s.cancel = None;
                let next = match &result {
                    Ok(_) => s.recovery.finish(Ok(()), 0.),
                    Err((_, Some(error))) => s.recovery.finish(Err(error), jitter()),
                    Err((_, None)) => s.recovery.finish(Ok(()), 0.),
                };
                s.context = match result {
                    Ok(context) | Err((context, _)) => context,
                };
                if let Next::RetryAfter(delay) = next {
                    s.schedule(delay, cx);
                }
                cx.notify();
            });
        })
        .detach();
    }
}
impl Default for RepositoryCloud {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };
    use std::time::Duration;

    fn settle(
        cx: &mut gpui::TestAppContext,
        mut done: impl FnMut(&mut gpui::TestAppContext) -> bool,
    ) {
        let deadline = std::time::Instant::now() + Duration::from_secs(30);
        loop {
            cx.run_until_parked();
            if done(cx) {
                return;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "the association did not settle"
            );
            std::thread::sleep(Duration::from_millis(5));
        }
    }

    /// `repositoryContextRecovery.test.ts`: `defers hidden-window retries
    /// until visible and removes listeners on disposal`. Cloud answers 503
    /// throughout: the retry that comes due while the window is hidden does
    /// not run, nor does a focus probe; showing the window reads once more;
    /// after the context is gone nothing reads again.
    #[gpui::test]
    fn a_hidden_window_defers_its_retries_until_it_is_visible(cx: &mut gpui::TestAppContext) {
        cx.executor().allow_parking();
        let asked = Arc::new(AtomicUsize::new(0));
        let responder: crate::cloud::auth::Responder = Arc::new({
            let asked = asked.clone();
            move |request| {
                if request.path.ends_with("/repository-context") {
                    asked.fetch_add(1, Ordering::SeqCst);
                }
                Err(crate::cloud::auth::Error::Http(503))
            }
        });
        let (broker, browser) = crate::cloud::auth::responding_account_fixture(responder);
        cx.update(|cx| crate::features::cloud::account::install_fixture(broker, browser, cx));
        settle(cx, |cx| {
            cx.update(|cx| crate::features::cloud::account::has_account(cx))
        });
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().canonicalize().unwrap();
        for args in [
            &["init", "-q"][..],
            &[
                "remote",
                "add",
                "origin",
                "http://127.0.0.1:18080/git/project-a.git",
            ],
        ] {
            assert!(
                std::process::Command::new("git")
                    .args(args)
                    .current_dir(&root)
                    .status()
                    .unwrap()
                    .success()
            );
        }
        let reads = || asked.load(Ordering::SeqCst);
        let cloud = cx.new(|_| RepositoryCloud::new());
        cloud.update(cx, |c, cx| {
            c.set_visible(false, cx);
            c.sync(Some(&root), true, cx);
        });
        let settled = |cx: &mut gpui::TestAppContext| {
            !matches!(
                cloud.read_with(cx, |c, _| c.context.clone()),
                Association::Resolving
            )
        };
        settle(cx, |cx| reads() == 1 && settled(cx));
        // The retry comes due while hidden; a focus probe waits too.
        cx.executor().advance_clock(Duration::from_secs(60));
        cloud.update(cx, |c, cx| c.probe(cx));
        cx.executor().advance_clock(Duration::from_secs(60));
        cx.run_until_parked();
        assert_eq!(reads(), 1, "a hidden window does not read again");
        cloud.update(cx, |c, cx| c.set_visible(true, cx));
        cx.executor().advance_clock(Duration::ZERO);
        settle(cx, |cx| reads() == 2 && settled(cx));
        // The context goes away: its pending retry and probes go with it.
        cloud.update(cx, |c, cx| c.sync(None, true, cx));
        cloud.update(cx, |c, cx| c.probe(cx));
        cx.executor().advance_clock(Duration::from_secs(60));
        cx.run_until_parked();
        assert_eq!(reads(), 2);
    }
}
