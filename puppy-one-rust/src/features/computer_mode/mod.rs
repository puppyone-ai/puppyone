//! Computer Mode (`src/features/computer-mode`, `enableComputerMode`): the
//! computers on this computer, shared by every window — the registry, what
//! each one's desktop is doing, and the starts and stops that move it.
//!
//! Registering, naming and the status changes are quick registry writes on
//! the main thread; starting, provisioning and stopping a desktop run
//! `limactl` in the background. Turning Computer Mode off puts every running
//! computer to sleep, and so does quitting: the registry says asleep at
//! once, and each desktop's stop runs on after the app has gone
//! (`localComputerService.closeAll`).
use crate::{
    features::settings::{PreferencesChanged, PreferencesStore},
    platform::local_computers::{
        self, Engine, Limactl, LimactlAt, Record, Registry, Runtime, Status,
    },
};
use gpui::{App, AppContext as _, Context, Entity, Global};
use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

#[cfg(test)]
mod tests;

/// What a computer's screen can show now.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Screen {
    /// Asleep: it shows nothing until woken.
    Asleep,
    /// Its desktop is starting.
    Starting,
    /// Running without a desktop: its files are the workspace, and the
    /// desktop can be started when this computer has the engine for it.
    Workspace { can_start: bool },
    /// Its desktop's display, on this loopback port.
    Desktop { port: u16 },
}

pub struct LocalComputers {
    dir: PathBuf,
    registry: Arc<Mutex<Registry>>,
    runtime: Runtime,
    limactl: Option<Arc<dyn Limactl>>,
    enabled: bool,
    /// Computers whose desktop is being started or stopped now.
    busy: std::collections::HashSet<String>,
}

struct Service(Entity<LocalComputers>);
impl Global for Service {}

/// The computers on this computer, created with the first window's
/// preferences, whose Computer Mode switch they follow.
pub fn global(preferences: &Entity<PreferencesStore>, cx: &mut App) -> Entity<LocalComputers> {
    if let Some(service) = cx.try_global::<Service>() {
        return service.0.clone();
    }
    #[cfg(not(test))]
    let (dir, runtime) = (local_computers::directory(), Runtime::detect());
    // Tests never read or write the person's registry, nor run Lima.
    #[cfg(test)]
    let (dir, runtime) = (
        tempfile::tempdir().expect("temporary registry").keep(),
        Runtime::default(),
    );
    let limactl = runtime
        .limactl
        .clone()
        .map(|path| Arc::new(LimactlAt(path)) as Arc<dyn Limactl>);
    let entity = create(dir, runtime, limactl, preferences, cx);
    cx.set_global(Service(entity.clone()));
    entity
}

fn create(
    dir: PathBuf,
    runtime: Runtime,
    limactl: Option<Arc<dyn Limactl>>,
    preferences: &Entity<PreferencesStore>,
    cx: &mut App,
) -> Entity<LocalComputers> {
    let enabled = preferences.read(cx).state.experimental.computer_mode;
    let entity = cx.new(|cx: &mut Context<LocalComputers>| {
        cx.subscribe(preferences, |s, store, _: &PreferencesChanged, cx| {
            let enabled = store.read(cx).state.experimental.computer_mode;
            if s.enabled != enabled {
                s.enabled = enabled;
                // `setExperimentalOptIn({enabled: false})`.
                if !enabled {
                    s.suspend_all(cx);
                }
                cx.notify();
            }
        })
        .detach();
        LocalComputers {
            registry: Arc::new(Mutex::new(Registry::open(&dir))),
            dir,
            runtime,
            limactl,
            enabled,
            busy: Default::default(),
        }
    });
    // A run that ended without its quit left computers running.
    if !enabled {
        entity.update(cx, |s, cx| s.suspend_all(cx));
    }
    let quitting = entity.clone();
    cx.on_app_quit(move |cx| {
        quitting.read(cx).suspend_on_quit();
        async {}
    })
    .detach();
    entity
}

/// The computers, when a window has created them.
pub fn read(cx: &App) -> Option<&LocalComputers> {
    cx.try_global::<Service>().map(|s| s.0.read(cx))
}

impl LocalComputers {
    pub fn computers(&self) -> Vec<Record> {
        self.registry.lock().unwrap().computers().to_vec()
    }

    /// `findLocalComputerForPath`: by the path as given, else by its
    /// canonical form (the one `register` keeps).
    pub fn for_path(&self, path: &Path) -> Option<Record> {
        let registry = self.registry.lock().unwrap();
        registry
            .for_path(&path.to_string_lossy())
            .or_else(|| {
                let canonical = path.canonicalize().ok()?;
                registry.for_path(&canonical.to_string_lossy())
            })
            .cloned()
    }

    /// This computer can give a computer a desktop (`runtime.available`).
    pub fn runtime_available(&self) -> bool {
        self.runtime.available()
    }

    pub fn busy(&self, id: &str) -> bool {
        self.busy.contains(id)
    }

    /// What the computer `id`'s screen can show now.
    pub fn screen(&self, record: &Record) -> Screen {
        match record.status {
            Status::Asleep | Status::Stopped => Screen::Asleep,
            Status::Provisioning => Screen::Starting,
            Status::Running | Status::Error => match record.vnc_port {
                Some(port) if record.desktop_ready => Screen::Desktop { port },
                _ => Screen::Workspace {
                    can_start: self.runtime.available() && !self.busy(&record.id),
                },
            },
        }
    }

    /// `register`: the workspace at `path` becomes a computer, running.
    pub fn register(&mut self, path: &Path, name: Option<&str>, cx: &mut Context<Self>) {
        let path = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
        let engine = self.runtime.engine();
        let result = self
            .registry
            .lock()
            .unwrap()
            .register(&path, name, engine, true);
        if let Err(error) = result {
            registry_failed("register", &error);
        }
        cx.notify();
    }

    fn set(&mut self, id: &str, change: impl FnOnce(&mut Record), cx: &mut Context<Self>) {
        if let Err(error) = self.registry.lock().unwrap().update(id, change) {
            registry_failed("update", &error);
        }
        cx.notify();
    }

    fn record(&self, id: &str) -> Option<Record> {
        self.registry.lock().unwrap().get(id).cloned()
    }

    /// `wake`: a computer with a desktop starts it again; one without is
    /// simply running.
    pub fn wake(&mut self, id: &str, cx: &mut Context<Self>) {
        let Some(record) = self.record(id) else {
            return;
        };
        if self.busy(id) || !record.asleep() {
            return;
        }
        let limactl = self.limactl.clone().filter(|_| record.desktop_ready);
        let Some(limactl) = limactl else {
            self.set(
                id,
                |r| {
                    r.status = Status::Running;
                    r.status_detail = None;
                },
                cx,
            );
            return;
        };
        self.set(
            id,
            |r| {
                r.status = Status::Provisioning;
                r.status_detail = None;
            },
            cx,
        );
        self.run(
            id,
            cx,
            move || local_computers::start(&*limactl, &record),
            |r, result| {
                r.status = Status::Running;
                // An instance that will not start is started again from its
                // config the next time its desktop is.
                if let Err(error) = result {
                    r.desktop_ready = false;
                    r.status_detail = Some(local_computers::failure_detail(&error));
                }
            },
        );
    }

    /// `sleep`: its desktop stops; its files stay.
    pub fn sleep(&mut self, id: &str, cx: &mut Context<Self>) {
        let Some(record) = self.record(id) else {
            return;
        };
        if self.busy(id) || record.asleep() {
            return;
        }
        match self.limactl.clone() {
            Some(limactl) if record.engine == Engine::Lima && record.desktop_ready => {
                self.run(
                    id,
                    cx,
                    move || {
                        local_computers::stop(&*limactl, &record);
                        Ok(())
                    },
                    |r, _| {
                        r.status = Status::Asleep;
                        r.status_detail = None;
                    },
                );
            }
            _ => self.set(
                id,
                |r| {
                    r.status = Status::Asleep;
                    r.status_detail = None;
                },
                cx,
            ),
        }
    }

    /// `provisionDesktop`: gives the computer its desktop.
    pub fn provision_desktop(&mut self, id: &str, cx: &mut Context<Self>) {
        let Some(record) = self.record(id) else {
            return;
        };
        if self.busy(id) {
            return;
        }
        let Some(limactl) = self.limactl.clone() else {
            self.set(
                id,
                |r| {
                    r.status = Status::Running;
                    r.desktop_ready = false;
                    r.status_detail = Some("limactl-unavailable".into());
                },
                cx,
            );
            return;
        };
        let port = match record
            .vnc_port
            .map(Ok)
            .unwrap_or_else(local_computers::free_port)
        {
            Ok(port) => port,
            Err(error) => {
                let detail = local_computers::failure_detail(&error.to_string());
                self.set(id, |r| r.status_detail = Some(detail), cx);
                return;
            }
        };
        self.set(
            id,
            |r| {
                r.engine = Engine::Lima;
                r.status = Status::Provisioning;
                r.vnc_port = Some(port);
                r.status_detail = None;
            },
            cx,
        );
        let dir = self.dir.clone();
        let Some(record) = self.record(id) else {
            return;
        };
        self.run(
            id,
            cx,
            move || local_computers::provision(&*limactl, &record, port, &dir),
            |r, result| {
                r.status = Status::Running;
                match result {
                    Ok(()) => r.desktop_ready = true,
                    Err(error) => {
                        r.desktop_ready = false;
                        r.status_detail = Some(local_computers::failure_detail(&error));
                    }
                }
            },
        );
    }

    /// Runs `work` for the computer `id` in the background, then `done`
    /// with its result.
    fn run(
        &mut self,
        id: &str,
        cx: &mut Context<Self>,
        work: impl FnOnce() -> Result<(), String> + Send + 'static,
        done: impl FnOnce(&mut Record, Result<(), String>) + 'static,
    ) {
        let id = id.to_owned();
        self.busy.insert(id.clone());
        cx.notify();
        let task = cx.background_executor().spawn(async move { work() });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            let _ = this.update(cx, |s, cx| {
                s.busy.remove(&id);
                s.set(&id, |r| done(r, result), cx);
            });
        })
        .detach();
    }

    /// `suspendAllRunning`: every running computer goes to sleep.
    fn suspend_all(&mut self, cx: &mut Context<Self>) {
        let running: Vec<String> = self
            .computers()
            .into_iter()
            .filter(|r| matches!(r.status, Status::Running | Status::Provisioning))
            .map(|r| r.id)
            .collect();
        for id in running {
            self.busy.remove(&id);
            self.sleep(&id, cx);
        }
    }

    /// At quit: every running computer is asleep in the registry now, and
    /// each desktop's stop runs on without the app.
    fn suspend_on_quit(&self) {
        let mut registry = self.registry.lock().unwrap();
        let running: Vec<Record> = registry
            .computers()
            .iter()
            .filter(|r| matches!(r.status, Status::Running | Status::Provisioning))
            .cloned()
            .collect();
        for record in running {
            if let Some(path) = &self.runtime.limactl
                && record.engine == Engine::Lima
                && record.desktop_ready
            {
                let mut stop = std::process::Command::new(path);
                stop.args(["stop", "-f", &record.instance_name])
                    .stdin(std::process::Stdio::null())
                    .stdout(std::process::Stdio::null())
                    .stderr(std::process::Stdio::null());
                crate::platform::process::isolate(&mut stop);
                let _ = stop.spawn();
            }
            let _ = registry.update(&record.id, |r| {
                r.status = Status::Asleep;
                r.status_detail = None;
            });
        }
    }
}

/// The registry could not be written; what is shown stays as it was read.
fn registry_failed(operation: &str, error: &std::io::Error) {
    crate::platform::diagnostics::warn(
        "local-computers.registry",
        serde_json::json!({ "operation": operation, "error": error.to_string() }),
    );
}

/// Test doubles: a registry in `dir`, an engine that does what it is told.
#[cfg(test)]
pub(crate) fn install_fixture(
    dir: PathBuf,
    limactl: Option<Arc<dyn Limactl>>,
    preferences: &Entity<PreferencesStore>,
    cx: &mut App,
) -> Entity<LocalComputers> {
    let runtime = Runtime {
        limactl: limactl.as_ref().map(|_| PathBuf::from("/fixture/limactl")),
    };
    let entity = create(dir, runtime, limactl, preferences, cx);
    cx.set_global(Service(entity.clone()));
    entity
}
