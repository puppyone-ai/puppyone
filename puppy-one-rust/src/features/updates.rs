//! `createUpdateService` + `useDesktopUpdates` + `createNativeUpdateMenuAction`:
//! the app's one update service. It checks 15 s after launch and then every
//! 6 h, downloads a newer version on its channel (by itself, unless that is
//! turned off), prepares it beside the installed app, and installs it as the
//! app quits. "Restart to update" is an ordinary quit: what keeps the app
//! open (running sessions, unsaved documents) asks first, and a quit that is
//! called off leaves the update ready.
use crate::localization::{t, tf};
use crate::platform::build_identity;
pub use crate::platform::updates::state::{Status, Titlebar, UpdateState, titlebar};
use crate::platform::updates::{self, Candidate, Configuration, state::Progress};
use gpui::*;
use std::sync::{Arc, atomic::AtomicBool};

/// A caller waiting for the operation in flight.
type Waiter = Box<dyn FnOnce(&UpdateState, &mut App)>;

pub struct Updates {
    state: UpdateState,
    config: Configuration,
    candidate: Option<Candidate>,
    #[cfg(target_os = "macos")]
    prepared: Option<updates::prepared::PreparedUpdate>,
    /// `runExclusive`: one operation at a time.
    busy: bool,
    /// Callers waiting for the operation in flight (the menu's check).
    waiting: Vec<Waiter>,
    restart_requested: bool,
    /// The profile chosen when this service starts.
    data_dir: std::path::PathBuf,
    /// Where the archive downloads to.
    downloads: std::path::PathBuf,
    download_cancel: Option<Arc<AtomicBool>>,
    quit: fn(&mut App),
    _schedule: Option<Task<()>>,
}

impl Drop for Updates {
    fn drop(&mut self) {
        if let Some(cancel) = &self.download_cancel {
            cancel.store(true, std::sync::atomic::Ordering::Relaxed);
        }
    }
}

struct Service(Entity<Updates>);
impl Global for Service {}

pub fn global(cx: &App) -> Option<Entity<Updates>> {
    cx.try_global::<Service>().map(|s| s.0.clone())
}
/// The service's state, for the views that show it.
pub fn state(cx: &App) -> Option<UpdateState> {
    global(cx).map(|u| u.read(cx).state.clone())
}

/// Starts the service; `quit` ends the app the ordinary way.
pub fn init(quit: fn(&mut App), cx: &mut App) {
    if global(cx).is_some() {
        return;
    }
    let identity = build_identity::current();
    let config = updates::configuration(&identity, |k| std::env::var(k).ok());
    let data = crate::platform::data_dir();
    let automatic = updates::read_automatic_download(&data);
    let exe = std::env::current_exe().ok();
    #[cfg_attr(not(target_os = "macos"), allow(unused_variables))]
    let app_bundle = exe
        .as_ref()
        .and_then(|e| e.ancestors().nth(3))
        .map(std::path::Path::to_path_buf);
    let mut reason = updates::disabled_reason(&config, identity.packaged, || {
        #[cfg(target_os = "macos")]
        if let Some(app) = &app_bundle {
            return updates::signature(app);
        }
        updates::Signature::Unsigned
    });
    #[cfg(target_os = "macos")]
    let prepared = match (&reason, &app_bundle) {
        (None, Some(app)) => {
            match updates::prepared::PreparedUpdate::new(
                app.clone(),
                updates::cache_path("prepared-update"),
            ) {
                Ok(prepared) => Some(prepared),
                Err(why) => {
                    reason = Some(format!("Auto updates are unavailable here: {why}"));
                    None
                }
            }
        }
        _ => None,
    };
    #[cfg(not(target_os = "macos"))]
    if reason.is_none() {
        reason = Some("Auto updates are available on macOS only.".into());
    }
    let state = UpdateState::new(identity.channel, identity.version, reason, automatic);
    let entity = cx.new(|cx| {
        let mut service = Updates {
            state,
            config,
            candidate: None,
            #[cfg(target_os = "macos")]
            prepared,
            busy: false,
            waiting: Vec::new(),
            restart_requested: false,
            data_dir: data,
            downloads: updates::cache_path("update-download"),
            download_cancel: None,
            quit,
            _schedule: None,
        };
        service.start_background_checks(cx);
        service
    });
    // `installOnQuit`: the last moment before exit.
    let service = entity.clone();
    cx.on_app_quit(move |cx| {
        service.update(cx, |s, _| s.install_on_exit());
        async {}
    })
    .detach();
    cx.set_global(Service(entity));
}

/// Captures: the service in one state (`updatePreview.ts`'s
/// `VITE_DESKTOP_UPDATE_PREVIEW`): `available` (manual), `downloading`,
/// `downloaded`, `installing`, `current` or `failed`.
#[cfg(feature = "dev-capture")]
pub fn install_fixture(preview: &str, cx: &mut App) {
    let Some(service) = global(cx) else {
        return;
    };
    service.update(cx, |s, cx| {
        let channel = build_identity::Channel::Stable;
        let mut state = UpdateState::new(channel, "0.4.4".into(), None, preview != "available");
        state.available_version = Some("0.4.5".into());
        state.status = match preview {
            "available" => Status::Available,
            "downloading" => {
                state.progress = Some(Progress {
                    percent: 42.,
                    ..Progress::default()
                });
                Status::Downloading
            }
            "installing" => Status::Installing,
            "current" => Status::NotAvailable,
            "failed" => {
                state.error = Some("The update archive does not match its feed's SHA-512.".into());
                Status::Error
            }
            _ => Status::Downloaded,
        };
        s.state = state.enforce_monotonic();
        cx.notify();
    });
}

impl Updates {
    fn start_background_checks(&mut self, cx: &mut Context<Self>) {
        if !self.usable() || self._schedule.is_some() {
            return;
        }
        self._schedule = Some(cx.spawn(async move |this, cx| {
            let mut delay = updates::INITIAL_CHECK;
            loop {
                cx.background_executor().timer(delay).await;
                delay = updates::CHECK_INTERVAL;
                let Ok(()) = this.update(cx, |s: &mut Updates, cx| {
                    if s.state.status.checks_in_background() {
                        s.check(cx);
                    }
                }) else {
                    return;
                };
            }
        }));
    }

    /// `publishState`, with the monotonic guard.
    fn publish(&mut self, change: impl FnOnce(&mut UpdateState), cx: &mut Context<Self>) {
        let mut next = self.state.clone();
        change(&mut next);
        self.state = next.enforce_monotonic();
        if !self.state.status.actionable() {
            self.candidate = None;
        }
        cx.notify();
    }
    fn usable(&self) -> bool {
        self.state.status != Status::Disabled
    }
    fn finish(&mut self, cx: &mut Context<Self>) {
        if let Some(cancel) = self.download_cancel.take() {
            cancel.store(true, std::sync::atomic::Ordering::Relaxed);
        }
        self.busy = false;
        let state = self.state.clone();
        for waiter in std::mem::take(&mut self.waiting) {
            let state = state.clone();
            cx.defer(move |cx| waiter(&state, cx));
        }
    }

    /// `checkForUpdates`: offered versions download by themselves when that
    /// is on.
    pub fn check(&mut self, cx: &mut Context<Self>) {
        if !self.usable() || self.busy {
            return;
        }
        if self.state.status == Status::Available {
            if self.state.automatically_download {
                self.busy = true;
                self.start_download(cx);
            }
            return;
        }
        if self.state.status.actionable() {
            return;
        }
        self.busy = true;
        self.publish(
            |s| {
                s.status = Status::Checking;
                s.available_version = None;
                s.progress = None;
                s.error = None;
            },
            cx,
        );
        let config = self.config.clone();
        let task = cx
            .background_executor()
            .spawn(async move { updates::check(&config) });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            let _ = this.update(cx, |s, cx| match result {
                Ok(candidate) => {
                    let version = candidate.version.clone();
                    s.candidate = Some(candidate);
                    s.publish(
                        |st| {
                            st.status = Status::Available;
                            st.available_version = Some(version);
                        },
                        cx,
                    );
                    if s.state.status == Status::Available && s.state.automatically_download {
                        s.start_download(cx);
                    } else {
                        s.finish(cx);
                    }
                }
                Err(error) => {
                    s.publish(
                        |st| {
                            st.status = Status::Error;
                            st.error = Some(error);
                        },
                        cx,
                    );
                    s.finish(cx);
                }
            });
        })
        .detach();
    }

    /// `downloadUpdate` (busy is already held): the archive, then the app
    /// prepared from it; only then is the update offered as downloaded.
    fn start_download(&mut self, cx: &mut Context<Self>) {
        let Some(candidate) = self
            .candidate
            .clone()
            .filter(|_| self.state.candidate_allowed())
        else {
            self.finish(cx);
            return;
        };
        self.publish(
            |s| {
                s.status = Status::Downloading;
                s.progress = Some(Progress::default());
                s.error = None;
            },
            cx,
        );
        let config = self.config.clone();
        let downloads = self.downloads.clone();
        let (progress_tx, progress_rx) = async_channel::bounded::<Progress>(1);
        let operation = candidate.clone();
        let progress_candidate = candidate.clone();
        let cancel = Arc::new(AtomicBool::new(false));
        self.download_cancel = Some(cancel.clone());
        let task = cx.background_executor().spawn(async move {
            updates::download(
                &config,
                &candidate,
                &downloads,
                |p| {
                    let _ = progress_tx.force_send(p);
                },
                &cancel,
            )
            .map(|path| (path, candidate.version))
        });
        cx.spawn(async move |this, cx| {
            while let Ok(progress) = progress_rx.recv().await {
                let mut latest = progress;
                while let Ok(newer) = progress_rx.try_recv() {
                    latest = newer;
                }
                let alive = this.update(cx, |s, cx| {
                    if s.owns_download(&progress_candidate) {
                        s.publish(|st| st.progress = Some(latest), cx);
                    }
                });
                if alive.is_err() {
                    return;
                }
            }
        })
        .detach();
        cx.spawn(async move |this, cx| {
            let result = task.await;
            let _ = this.update(cx, |s, cx| {
                if s.owns_download(&operation) {
                    s.downloaded(result, cx);
                }
            });
        })
        .detach();
    }

    fn downloaded(
        &mut self,
        result: Result<(tempfile::TempPath, String), String>,
        cx: &mut Context<Self>,
    ) {
        let (archive, version) = match result {
            Ok(downloaded) => downloaded,
            Err(error) => {
                self.preparation_finished(Err(error), cx);
                return;
            }
        };
        if !updates::policy::evaluate(
            self.state.channel,
            &self.state.current_version,
            Some(&version),
        )
        .allowed
        {
            // Apply the same monotonic guard to what actually downloaded,
            // before unzipping it, rather than retaining the feed's old label.
            self.publish(
                |s| {
                    s.status = Status::Downloaded;
                    s.available_version = Some(version);
                    s.progress = None;
                    s.error = None;
                },
                cx,
            );
            self.finish(cx);
            return;
        }
        let candidate = self
            .candidate
            .clone()
            .filter(|candidate| self.owns_download(candidate) && candidate.version == version);
        let Some(candidate) = candidate else {
            self.publish(|s| s.available_version = None, cx);
            self.preparation_finished(
                Err("The downloaded update no longer matches the offered version.".into()),
                cx,
            );
            return;
        };
        #[cfg(target_os = "macos")]
        {
            let Some(mut prepared) = self.prepared.take() else {
                self.preparation_finished(
                    Err("This installation cannot be updated in place.".into()),
                    cx,
                );
                return;
            };
            let task = cx.background_executor().spawn(async move {
                let result = prepared.prepare(&archive, &version);
                drop(archive);
                (prepared, result)
            });
            cx.spawn(async move |this, cx| {
                let (mut prepared, result) = task.await;
                let _ = this.update(cx, |s, cx| {
                    if !s.owns_download(&candidate) {
                        prepared.discard();
                        s.prepared.get_or_insert(prepared);
                        return;
                    }
                    s.prepared = Some(prepared);
                    s.preparation_finished(result, cx);
                });
            })
            .detach();
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = (archive, version, candidate);
            self.preparation_finished(Err("Auto updates are available on macOS only.".into()), cx);
        }
    }

    fn owns_download(&self, candidate: &Candidate) -> bool {
        self.busy
            && self.state.status == Status::Downloading
            && self.candidate.as_ref() == Some(candidate)
            && self.state.available_version.as_deref() == Some(candidate.version.as_str())
            && self.state.candidate_allowed()
    }

    fn preparation_finished(&mut self, result: Result<(), String>, cx: &mut Context<Self>) {
        match result {
            Ok(()) => self.publish(
                |s| {
                    s.status = Status::Downloaded;
                    s.progress = None;
                    s.error = None;
                },
                cx,
            ),
            Err(error) => self.publish(
                |s| {
                    s.status = Status::Error;
                    s.progress = None;
                    s.error = Some(error);
                },
                cx,
            ),
        }
        self.finish(cx);
    }

    /// `updateNow`: check, download or restart, whichever comes next.
    pub fn update_now(&mut self, cx: &mut Context<Self>) {
        if !self.usable() || self.busy {
            return;
        }
        match self.state.status {
            Status::Idle | Status::NotAvailable | Status::Error => self.check(cx),
            Status::Available => {
                self.busy = true;
                self.start_download(cx);
            }
            Status::Downloaded => self.restart(cx),
            _ => {}
        }
    }

    /// `installDownloadedUpdateInternal`: the ordinary quit, which asks
    /// about anything still running or unsaved, then the swap and reopen.
    fn restart(&mut self, cx: &mut Context<Self>) {
        if !self.state.candidate_allowed() {
            return;
        }
        self.restart_requested = true;
        self.publish(
            |s| {
                s.status = Status::Installing;
                s.error = None;
            },
            cx,
        );
        let quit = self.quit;
        cx.defer(quit);
    }

    /// `handleQuitCancelled`: something kept the app open; the update is
    /// still ready.
    pub fn quit_cancelled(&mut self, cx: &mut Context<Self>) {
        if !std::mem::take(&mut self.restart_requested) {
            return;
        }
        if self.state.status == Status::Installing {
            self.publish(|s| s.status = Status::Downloaded, cx);
        }
    }

    /// `installOnQuit`: a prepared update goes in as the app exits, and the
    /// app reopens when the person asked to restart.
    fn install_on_exit(&mut self) {
        if matches!(self.state.status, Status::Downloaded | Status::Installing) {
            #[cfg(target_os = "macos")]
            if let Some(prepared) = &mut self.prepared {
                prepared.install_on_exit(self.restart_requested);
            }
        }
    }

    /// `setAutomaticallyDownloadUpdates`.
    pub fn set_automatically_download(
        &mut self,
        enabled: bool,
        cx: &mut Context<Self>,
    ) -> std::io::Result<()> {
        if !self.usable() {
            return Ok(());
        }
        if self.state.automatically_download != enabled {
            updates::write_automatic_download(&self.data_dir, enabled).inspect_err(|error| {
                po_platform::diagnosticln!("Unable to save the update preference: {error}");
            })?;
            self.publish(|s| s.automatically_download = enabled, cx);
        }
        if enabled && self.state.status == Status::Available && !self.busy {
            self.busy = true;
            self.start_download(cx);
        }
        Ok(())
    }

    /// The operation in flight, or none: `then` sees the state it leaves.
    fn after(
        &mut self,
        then: impl FnOnce(&UpdateState, &mut App) + 'static,
        cx: &mut Context<Self>,
    ) {
        if self.busy {
            self.waiting.push(Box::new(then));
        } else {
            let state = self.state.clone();
            cx.defer(move |cx| then(&state, cx));
        }
    }
}

/// `checkForUpdatesFromNativeMenu`: a check, then the answer as a system
/// dialog in `window`. A state that offers a version says nothing: the
/// titlebar and Settings already show it (`isPassiveUpdateState`).
pub fn check_from_menu(window: AnyWindowHandle, app_name: &'static str, cx: &mut App) {
    let Some(service) = global(cx) else {
        show(window, unavailable(app_name), cx);
        return;
    };
    service.update(cx, |s, cx| {
        s.check(cx);
        s.after(
            move |state, cx| {
                let state = state.clone().enforce_monotonic();
                if !state.status.actionable() {
                    show(window, presentation(&state, app_name), cx);
                }
            },
            cx,
        );
    });
}

/// One OK button: nothing waits for the answer.
struct Prompt {
    level: PromptLevel,
    message: String,
    detail: String,
}

fn unavailable(app_name: &str) -> Prompt {
    Prompt {
        level: PromptLevel::Info,
        message: tf(
            "native.update.manual.unavailable.message",
            &[("appName", app_name.into())],
        ),
        detail: t("native.update.manual.unavailable.detail").into(),
    }
}

/// `createUpdateCheckPresentation` for the states the menu answers.
fn presentation(state: &UpdateState, app_name: &str) -> Prompt {
    let state = state.clone().enforce_monotonic();
    let current = state.current_version.clone();
    let app = || ("appName", crate::localization::Arg::from(app_name));
    match state.status {
        Status::NotAvailable => Prompt {
            level: PromptLevel::Info,
            message: tf("native.update.manual.current.message", &[app()]),
            detail: tf(
                "native.update.manual.current.detail",
                &[("version", current.into())],
            ),
        },
        Status::Error => Prompt {
            level: PromptLevel::Critical,
            message: tf("native.update.manual.failed.message", &[app()]),
            detail: state
                .error
                .clone()
                .filter(|e| !e.trim().is_empty())
                .unwrap_or_else(|| t("native.update.manual.failed.detail").into()),
        },
        _ => unavailable(app_name),
    }
}

fn show(window: AnyWindowHandle, prompt: Prompt, cx: &mut App) {
    let _ = window.update(cx, |_, window, cx| {
        drop(window.prompt(
            prompt.level,
            &prompt.message,
            Some(&prompt.detail),
            &[PromptButton::ok(t("native.update.manual.ok"))],
            cx,
        ));
    });
}

/// `DesktopUpdateSettingsRow` / `DesktopUpdateTitlebarButton`: the words
/// for a state.
pub mod words {
    use super::*;

    /// The version an action names, or "the new version".
    pub fn version(state: &UpdateState) -> String {
        state
            .available_version
            .clone()
            .unwrap_or_else(|| t("updates.version.new").into())
    }
    /// The download's progress as a whole percentage.
    pub fn progress(state: &UpdateState) -> String {
        let percent = state
            .progress
            .map_or(0., |p| p.percent)
            .clamp(0., 100.)
            .round();
        crate::localization::format_percent(percent / 100.)
    }
    /// `getSettingsAction`: label, enabled, spinning, primary, and whether
    /// it checks (otherwise it updates).
    pub struct Action {
        pub label: String,
        pub enabled: bool,
        pub spinning: bool,
        pub primary: bool,
        pub checks: bool,
    }
    pub fn settings_action(state: &UpdateState) -> Action {
        let action = |label: String, enabled, spinning, primary, checks| Action {
            label,
            enabled,
            spinning,
            primary,
            checks,
        };
        match state.status {
            Status::Disabled => action(
                t(if state.channel == build_identity::Channel::Dev {
                    "updates.action.developmentBuild"
                } else {
                    "updates.action.unavailable"
                })
                .into(),
                false,
                false,
                false,
                true,
            ),
            Status::Checking => action(
                t("updates.action.checking").into(),
                false,
                true,
                false,
                true,
            ),
            Status::NotAvailable => action(
                t("updates.action.upToDate").into(),
                false,
                false,
                false,
                true,
            ),
            Status::Downloading => action(progress(state), false, true, true, false),
            Status::Installing => action(
                t("updates.action.restarting").into(),
                false,
                true,
                true,
                false,
            ),
            Status::Downloaded => {
                action(t("updates.action.restart").into(), true, false, true, false)
            }
            Status::Available => action(
                t("updates.action.download").into(),
                true,
                false,
                true,
                false,
            ),
            Status::Error => action(
                t("updates.action.tryAgain").into(),
                true,
                false,
                false,
                false,
            ),
            Status::Idle => action(t("updates.action.check").into(), true, false, false, true),
        }
    }
    /// `getUpdateIcon`.
    pub fn icon(status: Status) -> &'static str {
        match status {
            Status::Disabled => "info",
            Status::Downloaded | Status::Installing => "rotate-cw",
            Status::Idle | Status::Checking | Status::Downloading => "refresh-cw",
            Status::Error => "triangle-alert",
            Status::NotAvailable => "circle-check",
            Status::Available => "download",
        }
    }
    /// `getUpdateDetail` (the error first, as the row shows it).
    pub fn detail(state: &UpdateState) -> String {
        if let Some(error) = &state.error {
            return error.clone();
        }
        match state.status {
            Status::Disabled => state
                .reason
                .clone()
                .unwrap_or_else(|| t("updates.detail.disabled").into()),
            Status::Idle => tf(
                "updates.detail.idle",
                &[
                    ("version", state.current_version.clone().into()),
                    ("channel", state.channel.key().into()),
                ],
            ),
            Status::Checking => t("updates.detail.checking").into(),
            Status::NotAvailable => tf(
                "updates.detail.current",
                &[("version", state.current_version.clone().into())],
            ),
            Status::Available => tf(
                "updates.detail.available",
                &[("version", version(state).into())],
            ),
            Status::Downloading => tf(
                "updates.detail.downloading",
                &[("progress", progress(state).into())],
            ),
            Status::Downloaded => tf(
                "updates.detail.downloaded",
                &[("version", version(state).into())],
            ),
            Status::Installing => t("updates.detail.installing").into(),
            Status::Error => t("updates.detail.error").into(),
        }
    }
}

#[cfg(test)]
#[path = "updates_tests.rs"]
mod tests;
