//! The open checkout's Cloud association (`useCurrentRepositoryCloudContext`
//! with `repositoryContextRecovery`), one per window, for the Header
//! location and the local → Cloud switch.
//!
//! The context is resolved afresh for each checkout, account, session
//! generation and API: remotes are read on a worker, the remotes alone
//! decide local-only / conflict / wrong host / sign in, and only then is the
//! exact Project authorized. Transport failures retry at most twice with
//! jitter; a returning window may probe once more. Late results of an older
//! key are dropped.
use crate::{
    cloud_auth::Cancellation,
    workspace::cloud::{
        recovery::{Controller, Next},
        repository::{self, Context as Association, Precheck},
    },
};
use gpui::*;
use std::{
    path::{Path, PathBuf},
    sync::atomic::AtomicBool,
    time::Instant,
};

pub struct RepositoryCloud {
    key: Option<String>,
    root: Option<PathBuf>,
    pub context: Association,
    epoch: u64,
    cancel: Option<Cancellation>,
    recovery: Controller,
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
        }
    }
    /// The checkout (`None`: no local project) under the current account.
    /// A changed key discards the old resolution and resolves again.
    pub fn sync(&mut self, root: Option<&Path>, enabled: bool, cx: &mut Context<Self>) {
        let account = crate::features::cloud_account::broker_and_binding(cx)
            .map(|(_, b)| format!("{}\n{}\n{}", b.user, b.epoch, b.environment.api()));
        let api = crate::features::cloud_account::environment(cx).map(|e| e.api().to_owned());
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
        if let Next::RetryAfter(delay) = self.recovery.probe(Instant::now()) {
            self.schedule(delay, cx);
        }
    }
    fn schedule(&mut self, delay: std::time::Duration, cx: &mut Context<Self>) {
        let epoch = self.epoch;
        cx.spawn(async move |this, cx| {
            cx.background_executor().timer(delay).await;
            let _ = this.update(cx, |s, cx| {
                if s.epoch == epoch {
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
        let account = crate::features::cloud_account::broker_and_binding(cx);
        let environment = crate::features::cloud_account::environment(cx);
        let api = environment.as_ref().map(|e| e.api().to_owned());
        let hosted_git_origin = environment.as_ref().and_then(|e| e.hosted_git_origin());
        let cancel = Cancellation::default();
        self.cancel = Some(cancel.clone());
        let epoch = self.epoch;
        self.context = Association::Resolving;
        self.recovery.start(Instant::now());
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
                Precheck::Authorize(project) => {
                    let (broker, binding) = account.expect("signed in");
                    repository::authorize(&broker, &binding, &project, &cancel)
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
