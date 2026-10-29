//! The telemetry host (`create-desktop-telemetry-host.mjs`, `telemetry-ipc.mjs`)
//! and the state the Privacy row (`ProductAnalyticsSettingsRow`) and the
//! Homepage disclosure (`OnboardingTelemetryDisclosure`) share. One service
//! for the process; every window observes the same entity, which is what the
//! product's `telemetry:state-changed` broadcast achieves. All service calls
//! run on the background executor.
use crate::platform::{
    self, build_identity,
    telemetry::{
        self, Config, Deps, Level, Service, Snapshot, contract::INGEST_URL,
        contract::normalize_os_major, transport::Http,
    },
};
use gpui::{App, AppContext as _, Context, Entity, Global};
use std::sync::Arc;

#[derive(Default)]
pub struct Telemetry {
    service: Option<Service>,
    pub snapshot: Option<Snapshot>,
    /// Waiting for the first snapshot.
    pub loading: bool,
    /// A level change is being written.
    pub saving: bool,
    /// The last read or level change failed.
    pub error: bool,
}

struct Handle(Entity<Telemetry>);
impl Global for Handle {}

pub fn global(cx: &App) -> Option<Entity<Telemetry>> {
    cx.try_global::<Handle>().map(|h| h.0.clone())
}

/// Start the service: carry over the Electron app's choice on first launch,
/// read the stores and deliver anything queued.
pub fn init(cx: &mut App) {
    let entity = cx.new(|_| Telemetry {
        loading: true,
        ..Telemetry::default()
    });
    cx.set_global(Handle(entity.clone()));
    let root = platform::data_dir().join("desktop-telemetry");
    let electron = platform::electron_import::default_dir().map(|d| d.join("desktop-telemetry"));
    let task = cx.background_spawn(async move {
        let identity = build_identity::current();
        let transport = telemetry::eligibility(&identity)
            .ok()
            .and_then(|_| Http::new(INGEST_URL).ok())
            .map(|http| Arc::new(http) as Arc<dyn telemetry::transport::Transport>);
        let service = Service::new(
            Config {
                root: root.clone(),
                identity,
                platform: build_identity::node_platform().into(),
                architecture: build_identity::node_architecture().into(),
                os_major: normalize_os_major(&build_identity::system_version()),
                transport,
            },
            Deps::default(),
        );
        if let Some(electron) = electron {
            let _ = telemetry::import_electron_preference(&electron, &root);
        }
        let started = service.start();
        (service, started)
    });
    entity.update(cx, |_, cx| {
        cx.spawn(async move |this, cx| {
            let (service, started) = task.await;
            this.update(cx, |t, cx| {
                // `app.on("will-quit")` disposes the host: no more deliveries.
                cx.on_app_quit({
                    let service = service.clone();
                    move |_, _| {
                        service.dispose();
                        async {}
                    }
                })
                .detach();
                t.service = Some(service);
                t.loading = false;
                match started {
                    Ok(snapshot) => t.snapshot = Some(snapshot),
                    Err(_) => t.error = true,
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    });
}

/// A lab or test window's state, without a service or files.
#[cfg(any(test, feature = "dev-capture"))]
pub fn install_fixture(snapshot: Option<Snapshot>, cx: &mut App) {
    let entity = cx.new(|_| Telemetry {
        snapshot,
        ..Telemetry::default()
    });
    cx.set_global(Handle(entity));
}

/// `browser-window-focus` → `noteForegroundActivity()`.
pub fn note_foreground(cx: &mut App) {
    if let Some(entity) = global(cx) {
        entity.update(cx, |t, cx| {
            t.run(cx, |service| {
                service.note_foreground_activity().map(|(_, s)| s)
            })
        });
    }
}

impl Telemetry {
    /// Whether a level change can be made (`setTelemetryLevel` exists).
    pub fn can_change(&self) -> bool {
        self.service.is_some()
    }

    /// The Privacy switch: on unless the notice is still required or the
    /// level is Off. Before the first read it shows on, like the product.
    pub fn analytics_checked(&self) -> bool {
        match &self.snapshot {
            Some(s) if s.notice_required => false,
            Some(s) => s.level != Level::Off,
            None => true,
        }
    }

    /// `shouldShowOnboardingTelemetryDisclosure`.
    pub fn disclosure_required(&self) -> bool {
        self.snapshot
            .as_ref()
            .is_some_and(|s| s.eligible && s.notice_required && s.level == Level::Basic)
    }

    /// `telemetry:set-level`: Basic also acknowledges the notice and records
    /// the foreground activity it was waiting for.
    pub fn set_analytics(&mut self, enabled: bool, cx: &mut Context<Self>) {
        let Some(service) = self.service.clone() else {
            return;
        };
        if self.saving {
            return;
        }
        self.saving = true;
        self.error = false;
        cx.notify();
        let level = if enabled { Level::Basic } else { Level::Off };
        let task = cx.background_spawn(async move {
            let snapshot = service.set_level(level)?;
            if level == Level::Basic {
                service.mark_notice_seen()?;
                return service.note_foreground_activity().map(|(_, s)| s);
            }
            Ok(snapshot)
        });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |t, cx| {
                t.saving = false;
                match result {
                    Ok(snapshot) => t.snapshot = Some(snapshot),
                    Err(_) => t.error = true,
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    /// A Homepage showed the disclosure: `telemetry:mark-notice-seen`, which
    /// also records the foreground activity the notice was holding back.
    pub fn disclosure_presented(&mut self, cx: &mut Context<Self>) {
        self.run(cx, |service| {
            service.mark_notice_seen()?;
            service.note_foreground_activity().map(|(_, s)| s)
        });
    }

    fn run(
        &mut self,
        cx: &mut Context<Self>,
        work: impl FnOnce(&Service) -> std::io::Result<Snapshot> + Send + 'static,
    ) {
        let Some(service) = self.service.clone() else {
            return;
        };
        let task = cx.background_spawn(async move { work(&service) });
        cx.spawn(async move |this, cx| {
            if let Ok(snapshot) = task.await {
                this.update(cx, |t, cx| {
                    t.snapshot = Some(snapshot);
                    cx.notify();
                })
                .ok();
            }
        })
        .detach();
    }
}

/// A snapshot for captures and tests: `eligible` is a packaged Stable build,
/// otherwise a development build (which never asks for the notice).
#[cfg(any(test, feature = "dev-capture"))]
pub fn fixture(level: Level, eligible: bool, notice_required: bool) -> Snapshot {
    use telemetry::DisabledReason;
    Snapshot {
        schema_version: 2,
        default_level: Level::Basic,
        level,
        effective_level: Level::Off,
        enabled: false,
        eligible,
        disabled_reason: Some(if !eligible {
            DisabledReason::UnpackagedBuild
        } else if level == Level::Off {
            DisabledReason::LevelOff
        } else {
            DisabledReason::NoticeRequired
        }),
        notice_version: 2,
        notice_seen_version: if notice_required { 0 } else { 2 },
        notice_required: eligible && notice_required && level != Level::Off,
        transport_configured: eligible,
        queued_event_count: 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    use fixture as snapshot;

    #[test]
    fn the_switch_and_the_disclosure_read_the_product_state() {
        let mut t = Telemetry::default();
        // Before the first read: on, and no disclosure.
        assert!(t.analytics_checked() && !t.disclosure_required());
        // A Stable build that has not shown the notice: off until shown.
        t.snapshot = Some(snapshot(Level::Basic, true, true));
        assert!(!t.analytics_checked() && t.disclosure_required());
        // A development build: on, never asks.
        t.snapshot = Some(snapshot(Level::Basic, false, false));
        assert!(t.analytics_checked() && !t.disclosure_required());
        t.snapshot = Some(snapshot(Level::Off, true, false));
        assert!(!t.analytics_checked() && !t.disclosure_required());
        assert!(!t.can_change());
    }

    #[gpui::test]
    fn a_level_change_and_the_disclosure_go_through_the_service(cx: &mut gpui::TestAppContext) {
        cx.executor().allow_parking();
        let dir = tempfile::tempdir().unwrap();
        let service = Service::new(
            Config {
                root: dir.path().to_path_buf(),
                identity: build_identity::Identity {
                    channel: build_identity::Channel::Stable,
                    version: "0.4.0".into(),
                    packaged: true,
                },
                platform: "darwin".into(),
                architecture: "arm64".into(),
                os_major: "15".into(),
                transport: None,
            },
            Deps {
                timers: false,
                ..Deps::default()
            },
        );
        let first = service.start().unwrap();
        let entity = cx.update(|cx| {
            let entity = cx.new(|_| Telemetry {
                service: Some(service.clone()),
                snapshot: Some(first),
                ..Telemetry::default()
            });
            cx.set_global(Handle(entity.clone()));
            entity
        });
        cx.read(|cx| assert!(entity.read(cx).disclosure_required()));
        entity.update(cx, |t, cx| t.disclosure_presented(cx));
        cx.run_until_parked();
        cx.read(|cx| {
            let t = entity.read(cx);
            // Seen now: no other Homepage asks again.
            assert!(!t.disclosure_required());
            assert_eq!(t.snapshot.as_ref().unwrap().notice_seen_version, 2);
        });
        entity.update(cx, |t, cx| t.set_analytics(false, cx));
        cx.read(|cx| assert!(entity.read(cx).saving));
        cx.run_until_parked();
        cx.read(|cx| {
            let t = entity.read(cx);
            assert!(!t.saving && !t.error && !t.analytics_checked());
        });
        assert_eq!(service.snapshot().unwrap().level, Level::Off);
        cx.update(note_foreground);
        cx.run_until_parked();
        entity.update(cx, |t, cx| t.set_analytics(true, cx));
        cx.run_until_parked();
        cx.read(|cx| assert!(entity.read(cx).analytics_checked()));
    }
}
