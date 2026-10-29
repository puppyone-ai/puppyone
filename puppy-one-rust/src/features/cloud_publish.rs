//! `useCloudInitialization` + `useCloudPublishHeaderStatus`: the first
//! publication of the open checkout, one per window. The coordinator runs on
//! a worker (Git, keychain and Cloud are blocking); its stages and outcome
//! come back here. The run outlives its dialog: the Header states it and
//! reopens the same view.
use crate::cloud_publication::{
    Action, Coordinator, Outcome, Request, Stage,
    api::{self, CloudOps, Organization},
    git, vault,
};
use gpui::*;
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Organizations {
    Idle,
    Loading,
    Ready(Vec<Organization>),
    Failed,
}
/// `CloudPublishHeaderStatus`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HeaderStatus {
    Running,
    /// Published this session (shown briefly).
    Completed,
    /// Stopped before it finished; Retry continues it.
    Paused,
    /// Stopped while discarding.
    DiscardPaused,
    /// Stopped without a way to continue by retrying.
    Attention,
}

/// Builds the coordinator for an account (tests replace it).
pub type Factory = Arc<
    dyn Fn(Arc<crate::cloud_auth::Broker>, crate::cloud_auth::model::Binding) -> Coordinator
        + Send
        + Sync,
>;
struct FactoryOverride(Factory);
impl Global for FactoryOverride {}
#[cfg(test)]
pub fn install_factory(factory: Factory, cx: &mut App) {
    cx.set_global(FactoryOverride(factory));
}
fn coordinator(cx: &App) -> Option<Coordinator> {
    let (broker, binding) = crate::features::cloud_account::broker_and_binding(cx)?;
    if let Some(factory) = cx.try_global::<FactoryOverride>() {
        return Some((factory.0)(broker, binding));
    }
    let hosted = binding.environment.hosted_git_origin();
    Some(Coordinator {
        git: Arc::new(git::Cli { helper: None }),
        cloud: Arc::new(api::Http {
            broker,
            binding,
            hosted_git_origin: hosted,
        }),
        vault: Arc::new(vault::Keychain),
    })
}

pub struct CloudPublish {
    key: Option<String>,
    root: Option<PathBuf>,
    pub organizations: Organizations,
    pub selected: Option<String>,
    /// The visible step while a run is in flight.
    pub running: Option<Stage>,
    /// The saved operation and the last result, when one is pending.
    pub outcome: Option<Outcome>,
    pub reading: bool,
    /// Discard's inline confirmation is open.
    pub confirming_discard: bool,
    /// A run finished with this Project during this session.
    pub published: Option<String>,
    epoch: u64,
}
impl Default for CloudPublish {
    fn default() -> Self {
        Self {
            key: None,
            root: None,
            organizations: Organizations::Idle,
            selected: None,
            running: None,
            outcome: None,
            reading: false,
            confirming_discard: false,
            published: None,
            epoch: 0,
        }
    }
}
impl CloudPublish {
    /// The checkout this window shows under the current account; a change
    /// reads the saved operation again.
    pub fn sync(&mut self, root: Option<&Path>, enabled: bool, cx: &mut Context<Self>) {
        let account = crate::features::cloud_account::broker_and_binding(cx)
            .map(|(_, b)| format!("{}\n{}", b.user, b.environment.api()));
        let key = root
            .filter(|_| enabled)
            .zip(account)
            .map(|(root, account)| format!("{}\n{account}", root.display()));
        if key == self.key {
            return;
        }
        // A run in flight keeps its own scope; only its result is dropped.
        self.key = key;
        self.root = root.filter(|_| enabled).map(Path::to_path_buf);
        self.epoch += 1;
        self.running = None;
        self.outcome = None;
        self.organizations = Organizations::Idle;
        self.selected = None;
        self.confirming_discard = false;
        if self.root.is_some() {
            self.read_state(cx);
        }
        cx.notify();
    }
    fn request(&self, action: Action, cx: &App) -> Option<Request> {
        let (_, binding) = crate::features::cloud_account::broker_and_binding(cx)?;
        let root = self.root.clone()?;
        let pending = self.outcome.as_ref().and_then(|o| o.record.as_ref());
        let branch = pending
            .map(|r| r.selected_source_branch.clone())
            .or_else(|| current_branch(&root))
            .unwrap_or_default();
        Some(Request {
            project_name: pending
                .map(|r| r.project_name.clone())
                .unwrap_or_else(|| project_name(&root)),
            organization_id: pending
                .map(|r| r.organization_id.clone())
                .or_else(|| self.selected.clone())
                .unwrap_or_default(),
            root,
            api_base_url: binding.environment.api().to_owned(),
            user_id: binding.user.clone(),
            source_branch: branch,
            operation_id: pending.map(|r| r.operation_id.clone()),
            action,
        })
    }
    /// `getState`: the saved operation of this checkout, if any.
    fn read_state(&mut self, cx: &mut Context<Self>) {
        let (Some(coordinator), Some(request)) =
            (coordinator(cx), self.request(Action::Initialize, cx))
        else {
            return;
        };
        let epoch = self.epoch;
        self.reading = true;
        let task = cx
            .background_executor()
            .spawn(async move { coordinator.state(&request) });
        cx.spawn(async move |this, cx| {
            let outcome = task.await;
            let _ = this.update(cx, |s, cx| {
                if s.epoch != epoch {
                    return;
                }
                s.reading = false;
                s.absorb(outcome);
                cx.notify();
            });
        })
        .detach();
    }
    fn absorb(&mut self, outcome: Outcome) {
        if outcome.ok && outcome.record.is_none() {
            if let Some(project) = outcome.project.clone() {
                self.published = Some(project);
            }
            self.outcome = None;
        } else {
            self.outcome = Some(outcome);
        }
    }
    /// The organizations that may own the new Project; one is chosen
    /// automatically (`organizationStatus`).
    pub fn load_organizations(&mut self, cx: &mut Context<Self>) {
        if !matches!(
            self.organizations,
            Organizations::Idle | Organizations::Failed
        ) {
            return;
        }
        let Some((broker, binding)) = crate::features::cloud_account::broker_and_binding(cx) else {
            return;
        };
        let epoch = self.epoch;
        self.organizations = Organizations::Loading;
        let cloud = api::Http {
            broker,
            binding,
            hosted_git_origin: None,
        };
        let task = cx
            .background_executor()
            .spawn(async move { cloud.organizations() });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            let _ = this.update(cx, |s, cx| {
                if s.epoch != epoch {
                    return;
                }
                match result {
                    Ok(list) => {
                        if list.len() == 1 {
                            s.selected = Some(list[0].id.clone());
                        }
                        s.organizations = Organizations::Ready(list);
                    }
                    Err(_) => s.organizations = Organizations::Failed,
                }
                cx.notify();
            });
        })
        .detach();
    }
    pub fn select(&mut self, organization: String, cx: &mut Context<Self>) {
        self.selected = Some(organization);
        cx.notify();
    }
    /// Upload to Cloud / Retry: start or continue from the checkpoint.
    pub fn start(&mut self, action: Action, cx: &mut Context<Self>) {
        if self.running.is_some() {
            return;
        }
        let (Some(coordinator), Some(request)) = (coordinator(cx), self.request(action, cx)) else {
            return;
        };
        self.confirming_discard = false;
        self.running = Some(Stage::Validating);
        cx.notify();
        let epoch = self.epoch;
        let (tx, rx) = async_channel::unbounded::<Result<Stage, Outcome>>();
        std::thread::spawn(move || {
            let progress_tx = tx.clone();
            let outcome = coordinator.start(&request, &mut |stage| {
                let _ = progress_tx.send_blocking(Ok(stage));
            });
            let _ = tx.send_blocking(Err(outcome));
        });
        cx.spawn(async move |this, cx| {
            while let Ok(message) = rx.recv().await {
                let done = this
                    .update(cx, |s, cx| {
                        if s.epoch != epoch {
                            return true;
                        }
                        match message {
                            Ok(stage) => {
                                s.running = Some(stage);
                                cx.notify();
                                false
                            }
                            Err(outcome) => {
                                s.running = None;
                                s.absorb(outcome);
                                cx.notify();
                                true
                            }
                        }
                    })
                    .unwrap_or(true);
                if done {
                    break;
                }
            }
        })
        .detach();
    }
    /// Discard: delete the empty Cloud Project of the pending operation.
    pub fn discard(&mut self, cx: &mut Context<Self>) {
        if self.running.is_some() {
            return;
        }
        let (Some(coordinator), Some(request)) =
            (coordinator(cx), self.request(Action::Initialize, cx))
        else {
            return;
        };
        self.confirming_discard = false;
        self.reading = true;
        let epoch = self.epoch;
        let task = cx
            .background_executor()
            .spawn(async move { coordinator.cleanup(&request) });
        cx.spawn(async move |this, cx| {
            let outcome = task.await;
            let _ = this.update(cx, |s, cx| {
                if s.epoch != epoch {
                    return;
                }
                s.reading = false;
                if outcome.ok && outcome.record.is_none() && outcome.project.is_none() {
                    s.outcome = None;
                } else {
                    s.absorb(outcome);
                }
                cx.notify();
            });
        })
        .detach();
    }
    /// What the Header states about this checkout's publication.
    pub fn header_status(&self) -> Option<HeaderStatus> {
        use crate::workspace::cloud::publish::{Action as A, Cleanup};
        if self.running.is_some() {
            return Some(HeaderStatus::Running);
        }
        if let Some(outcome) = &self.outcome
            && outcome.record.is_some()
        {
            let state = outcome.state.as_ref();
            if state.is_some_and(|s| !matches!(s.cleanup, Cleanup::None | Cleanup::Completed)) {
                return Some(HeaderStatus::DiscardPaused);
            }
            let retryable = state.is_some_and(|s| {
                s.actions
                    .iter()
                    .any(|a| matches!(a, A::RetryPush | A::PushLatest | A::Reconcile))
            }) || outcome.error.as_ref().is_some_and(|e| e.retryable);
            return Some(if retryable {
                HeaderStatus::Paused
            } else {
                HeaderStatus::Attention
            });
        }
        self.published.as_ref().map(|_| HeaderStatus::Completed)
    }
}

fn project_name(root: &Path) -> String {
    root.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Project".into())
}
fn current_branch(root: &Path) -> Option<String> {
    use git::GitOps as _;
    git::Cli { helper: None }.status(root).ok()?.branch
}
