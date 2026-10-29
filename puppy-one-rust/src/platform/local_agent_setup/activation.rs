//! Port of `activation-service.mjs`, `activation-journal.mjs` and
//! `shared/local-agent-activation/schema.mjs`. Activation is installation,
//! not account, model or protocol readiness: an Agent is ready once
//! discovery finds its CLI, either already installed or installed from its
//! reviewed recipe. Operations belong to the application, survive their
//! dialog, and a cancel never waits behind a provider operation. At most
//! three run at once; an operation still running when the app quit reads
//! back as interrupted.
use super::{Recipe, Route, Surface, platform, route};
use serde_json::{Value, json};
use std::{
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status {
    Preparing,
    Installing,
    SetupRequired,
    Verifying,
    Ready,
    Cancelling,
    Cancelled,
    Failed,
    Interrupted,
}
impl Status {
    const ALL: [(Status, &'static str); 9] = [
        (Self::Preparing, "preparing"),
        (Self::Installing, "installing"),
        (Self::SetupRequired, "setup-required"),
        (Self::Verifying, "verifying"),
        (Self::Ready, "ready"),
        (Self::Cancelling, "cancelling"),
        (Self::Cancelled, "cancelled"),
        (Self::Failed, "failed"),
        (Self::Interrupted, "interrupted"),
    ];
    /// `isActivationActive`.
    pub fn active(self) -> bool {
        !matches!(
            self,
            Self::Ready | Self::Cancelled | Self::Failed | Self::Interrupted
        )
    }
    /// `settings.activation.status.<key>`.
    pub fn key(self) -> &'static str {
        Self::ALL.iter().find(|(s, _)| *s == self).unwrap().1
    }
    fn parse(key: &str) -> Option<Self> {
        Self::ALL.iter().find(|(_, k)| *k == key).map(|(s, _)| *s)
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StepState {
    Pending,
    Running,
    Complete,
    Skipped,
    Failed,
}
impl StepState {
    const ALL: [(StepState, &'static str); 5] = [
        (Self::Pending, "pending"),
        (Self::Running, "running"),
        (Self::Complete, "complete"),
        (Self::Skipped, "skipped"),
        (Self::Failed, "failed"),
    ];
    pub fn done(self) -> bool {
        matches!(self, Self::Complete | Self::Skipped)
    }
    fn key(self) -> &'static str {
        Self::ALL.iter().find(|(s, _)| *s == self).unwrap().1
    }
    fn parse(key: &str) -> Option<Self> {
        Self::ALL.iter().find(|(_, k)| *k == key).map(|(s, _)| *s)
    }
}
/// `ACTIVATION_STEPS`.
pub const STEPS: [&str; 3] = ["prepare", "install", "verify"];
const PREPARE: usize = 0;
const INSTALL: usize = 1;
const VERIFY: usize = 2;

/// `ACTIVATION_ERRORS`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ErrorCode {
    InstallationCheck,
    Download,
    Integrity,
    Archive,
    InstallationBusy,
    Installation,
    Interrupted,
    Storage,
    Timeout,
    Process,
    Unsupported,
}
impl ErrorCode {
    const ALL: [(ErrorCode, &'static str); 11] = [
        (Self::InstallationCheck, "installation-check"),
        (Self::Download, "download"),
        (Self::Integrity, "integrity"),
        (Self::Archive, "archive"),
        (Self::InstallationBusy, "installation-busy"),
        (Self::Installation, "installation"),
        (Self::Interrupted, "interrupted"),
        (Self::Storage, "storage"),
        (Self::Timeout, "timeout"),
        (Self::Process, "process"),
        (Self::Unsupported, "unsupported"),
    ];
    /// `settings.activation.error.<key>`.
    pub fn key(self) -> &'static str {
        Self::ALL.iter().find(|(e, _)| *e == self).unwrap().1
    }
    fn parse(key: &str) -> Option<Self> {
        Self::ALL.iter().find(|(_, k)| *k == key).map(|(e, _)| *e)
    }
}

/// `ActivationOperation`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Operation {
    pub operation_id: String,
    pub setup_id: String,
    pub display_name: String,
    pub status: Status,
    pub steps: [StepState; 3],
    pub installed: bool,
    pub error: Option<ErrorCode>,
    pub updated_at: u64,
}
impl Operation {
    /// The 1-based step in progress, as the setup rows count it.
    pub fn current_step(&self) -> usize {
        self.steps
            .iter()
            .position(|s| !s.done())
            .map_or(1, |i| i + 1)
            .max(1)
    }
}
/// `ActivationSnapshot`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Snapshot {
    pub epoch: String,
    pub revision: u64,
    pub operations: Vec<Operation>,
}
/// `ActivationPlan`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Plan {
    pub plan_id: String,
    pub setup_id: &'static str,
    pub display_name: &'static str,
    /// `mode: "automatic"`: a reviewed recipe installs the CLI; otherwise
    /// the official setup flow is guided.
    pub automatic: bool,
    pub version: Option<&'static str>,
    pub publisher: &'static str,
    pub surface: Surface,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Action {
    Cancel,
    Check,
    Guide,
    Dismiss,
}

/// What activation needs from the rest of the app.
pub trait Ports: Send + Sync + 'static {
    /// Whether discovery finds the installation (`resolveInstallation`).
    fn resolve(&self, id: &str) -> Result<bool, ErrorCode>;
    /// Installs and verifies `recipe`; `committed` runs once it is current.
    fn install(
        &self,
        recipe: &Recipe,
        cancel: &AtomicBool,
        committed: &dyn Fn(),
    ) -> Result<(), ErrorCode>;
    fn open_guide(&self, url: &str) -> Result<(), String>;
    /// Installations changed; rescan (`refreshInstallations`).
    fn refresh(&self);
}
pub type Publish = Arc<dyn Fn(Snapshot) + Send + Sync>;

struct Task {
    operation_id: String,
    setup_id: String,
    cancel: Arc<AtomicBool>,
    running: bool,
    committed: bool,
}
struct PlanRecord {
    owner: String,
    route: &'static Route,
    operation_id: Option<String>,
}
struct State {
    epoch: String,
    revision: u64,
    operations: Vec<Operation>,
    tasks: Vec<Task>,
    plans: Vec<(String, PlanRecord)>,
    loaded: Option<Result<(), String>>,
}
#[derive(Clone)]
pub struct Service {
    state: Arc<Mutex<State>>,
    ports: Arc<dyn Ports>,
    publish: Publish,
    journal: Arc<Journal>,
    platform: &'static str,
    arch: &'static str,
}
impl Service {
    pub fn new(journal: PathBuf, ports: Arc<dyn Ports>, publish: Publish) -> Self {
        Self::for_platform(journal, ports, publish, platform(), super::arch())
    }
    pub fn for_platform(
        journal: PathBuf,
        ports: Arc<dyn Ports>,
        publish: Publish,
        platform: &'static str,
        arch: &'static str,
    ) -> Self {
        Self {
            state: Arc::new(Mutex::new(State {
                epoch: uuid::Uuid::new_v4().to_string(),
                revision: 0,
                operations: vec![],
                tasks: vec![],
                plans: vec![],
                loaded: None,
            })),
            ports,
            publish,
            journal: Arc::new(Journal {
                path: journal,
                written: Mutex::new(0),
            }),
            platform,
            arch,
        }
    }
    /// The first request reads the journal (`initialized`). Operations that
    /// were running come back interrupted. A corrupt journal is never
    /// overwritten: every request then fails with it.
    fn loaded(&self) -> Result<std::sync::MutexGuard<'_, State>, ErrorCode> {
        let mut state = self.state.lock().unwrap();
        if state.loaded.is_none() {
            let result = self.journal.read().map(|operations| {
                let now = super::super::agent_activity::now_millis();
                for mut op in operations {
                    if self.registered(&op.setup_id).is_none() {
                        continue;
                    }
                    if op.status.active() {
                        op.status = Status::Interrupted;
                        op.error = Some(ErrorCode::Interrupted);
                        op.updated_at = now;
                        for step in op.steps.iter_mut() {
                            if *step == StepState::Running {
                                *step = StepState::Failed;
                            }
                        }
                    }
                    state.operations.push(op);
                }
                state.revision += 1;
            });
            state.loaded = Some(result);
        }
        match &state.loaded {
            Some(Ok(())) => Ok(state),
            _ => Err(ErrorCode::Storage),
        }
    }
    /// `createActivationRegistry`: the platform's routes with their recipes.
    fn registered(&self, id: &str) -> Option<(&'static Route, Option<Recipe>)> {
        let route = route(id).filter(|r| r.platforms.contains(&self.platform))?;
        Some((route, route.recipe(self.platform, self.arch)))
    }
    pub fn read(&self) -> Result<Snapshot, ErrorCode> {
        Ok(snapshot(&*self.loaded()?))
    }
    pub fn plan(&self, owner: &str, setup_id: &str, surface: Surface) -> Result<Plan, ErrorCode> {
        let mut state = self.loaded()?;
        let (route, recipe) = self
            .registered(setup_id)
            .filter(|(r, _)| r.supports(surface))
            .ok_or(ErrorCode::Unsupported)?;
        let plan = Plan {
            plan_id: uuid::Uuid::new_v4().to_string(),
            setup_id: route.id,
            display_name: route.display_name,
            automatic: recipe.is_some(),
            version: recipe.as_ref().map(|r| r.version),
            publisher: route.publisher,
            surface,
        };
        state.plans.push((
            plan.plan_id.clone(),
            PlanRecord {
                owner: owner.into(),
                route,
                operation_id: None,
            },
        ));
        let excess = state.plans.len().saturating_sub(128);
        state.plans.drain(..excess);
        Ok(plan)
    }
    pub fn start(&self, owner: &str, plan_id: &str) -> Result<Snapshot, ErrorCode> {
        let mut state = self.loaded()?;
        let index = state
            .plans
            .iter()
            .position(|(id, p)| id == plan_id && p.owner == owner)
            .ok_or(ErrorCode::Unsupported)?;
        if state.plans[index].1.operation_id.is_some() {
            return Ok(snapshot(&state));
        }
        let route = state.plans[index].1.route;
        if let Some(previous) = state
            .operations
            .iter()
            .find(|o| o.setup_id == route.id && o.status.active())
        {
            let id = previous.operation_id.clone();
            state.plans[index].1.operation_id = Some(id);
            return Ok(snapshot(&state));
        }
        if state
            .operations
            .iter()
            .filter(|o| o.status.active())
            .count()
            >= 3
        {
            return Err(ErrorCode::InstallationBusy);
        }
        let operation_id = uuid::Uuid::new_v4().to_string();
        let entry = Operation {
            operation_id: operation_id.clone(),
            setup_id: route.id.into(),
            display_name: route.display_name.into(),
            status: Status::Preparing,
            steps: [StepState::Pending; 3],
            installed: false,
            error: None,
            updated_at: super::super::agent_activity::now_millis(),
        };
        match state.operations.iter().position(|o| o.setup_id == route.id) {
            Some(i) => state.operations[i] = entry,
            None => state.operations.push(entry),
        }
        // Earlier finished tasks of this Agent give way to the new one.
        state.tasks.retain(|t| t.setup_id != route.id || t.running);
        state.tasks.push(Task {
            operation_id: operation_id.clone(),
            setup_id: route.id.into(),
            cancel: Arc::default(),
            running: false,
            committed: false,
        });
        state.revision += 1;
        state.plans[index].1.operation_id = Some(operation_id.clone());
        let current = snapshot(&state);
        drop(state);
        if self.journal.write(&current).is_err() {
            // A late storage failure must not overwrite an acknowledged cancel.
            let mut state = self.state.lock().unwrap();
            if !task(&state, &operation_id).is_some_and(|t| t.cancel.load(Ordering::Relaxed)) {
                self.emit(&mut state, &operation_id, |op| {
                    op.status = Status::Failed;
                    op.error = Some(ErrorCode::Storage);
                });
            }
            return Ok(snapshot(&state));
        }
        let mut state = self.state.lock().unwrap();
        let active = op(&state, &operation_id).is_some_and(|o| o.status.active());
        if !active || task(&state, &operation_id).is_some_and(|t| t.cancel.load(Ordering::Relaxed))
        {
            return Ok(snapshot(&state));
        }
        self.launch(&mut state, &operation_id);
        Ok(snapshot(&state))
    }
    pub fn act(&self, operation_id: &str, action: Action) -> Result<Snapshot, ErrorCode> {
        let mut state = self.loaded()?;
        if action == Action::Dismiss {
            let index = state
                .operations
                .iter()
                .position(|o| o.operation_id == operation_id && !o.status.active())
                .ok_or(ErrorCode::Unsupported)?;
            state.operations.remove(index);
            state.tasks.retain(|t| t.operation_id != operation_id);
            state.revision += 1;
            let value = snapshot(&state);
            drop(state);
            (self.publish)(value.clone());
            let _ = self.journal.write(&value);
            return Ok(value);
        }
        let Some(task) = task(&state, operation_id) else {
            return Err(ErrorCode::Unsupported);
        };
        let (running, cancel) = (task.running, task.cancel.clone());
        let entry = op(&state, operation_id)
            .filter(|o| o.setup_id == task.setup_id)
            .cloned()
            .ok_or(ErrorCode::Unsupported)?;
        match action {
            Action::Cancel => {
                if !entry.status.active() || entry.status == Status::Cancelling {
                    return Ok(snapshot(&state));
                }
                self.emit(&mut state, operation_id, |op| {
                    op.status = Status::Cancelling
                });
                cancel.store(true, Ordering::Relaxed);
                if !running {
                    self.emit(&mut state, operation_id, |op| {
                        reset_running(op, StepState::Pending);
                        op.status = Status::Cancelled;
                    });
                }
            }
            Action::Guide => {
                if entry.status != Status::SetupRequired {
                    return Err(ErrorCode::Unsupported);
                }
                let url = self
                    .registered(&entry.setup_id)
                    .ok_or(ErrorCode::Unsupported)?
                    .0
                    .guide_url;
                drop(state);
                self.ports.open_guide(url).map_err(|_| ErrorCode::Process)?;
                return self.read();
            }
            Action::Check => {
                if !running && entry.status == Status::SetupRequired {
                    self.launch(&mut state, operation_id);
                }
            }
            Action::Dismiss => unreachable!(),
        }
        Ok(snapshot(&state))
    }
    /// `launch`: like the product's first synchronous step, the returned
    /// snapshot already shows the preparation running.
    fn launch(&self, state: &mut State, operation_id: &str) {
        let Some(task) = state
            .tasks
            .iter_mut()
            .find(|t| t.operation_id == operation_id)
        else {
            return;
        };
        task.running = true;
        let cancel = task.cancel.clone();
        if !cancel.load(Ordering::Relaxed) {
            self.emit(state, operation_id, |op| {
                op.steps[PREPARE] = StepState::Running;
                op.status = Status::Preparing;
                op.error = None;
            });
        }
        let service = self.clone();
        let id = operation_id.to_owned();
        std::thread::Builder::new()
            .name("local-agent-activation".into())
            .spawn(move || service.run(&id, &cancel))
            .ok();
    }
    /// `run`: prepare (is it installed?), install from the recipe when
    /// there is one, then let discovery confirm.
    fn run(&self, id: &str, cancel: &AtomicBool) {
        let setup_id = {
            let state = self.state.lock().unwrap();
            op(&state, id).map(|o| o.setup_id.clone())
        };
        let Some((route, recipe)) = setup_id.and_then(|s| self.registered(&s)) else {
            return;
        };
        let check = || {
            if cancel.load(Ordering::Relaxed) {
                Err(ErrorCode::Interrupted)
            } else {
                Ok(())
            }
        };
        let step = |index: usize, value: StepState, status: Option<Status>| {
            let mut state = self.state.lock().unwrap();
            self.emit(&mut state, id, |op| {
                op.steps[index] = value;
                if let Some(status) = status {
                    op.status = status;
                }
            });
        };
        // The terminal status is published under the same lock that ends the
        // task, so an action that reads it (Check after SetupRequired, Start
        // after Ready) never finds the task still marked running.
        let result = (|| -> Result<Status, ErrorCode> {
            check()?;
            let mut found = self.ports.resolve(route.id)?;
            check()?;
            step(PREPARE, StepState::Complete, None);
            if !found && let Some(recipe) = &recipe {
                step(INSTALL, StepState::Running, Some(Status::Installing));
                self.ports.install(recipe, cancel, &|| {
                    let mut state = self.state.lock().unwrap();
                    if let Some(task) = state.tasks.iter_mut().find(|t| t.operation_id == id) {
                        task.committed = true;
                    }
                    self.emit(&mut state, id, |op| op.installed = true);
                })?;
                check()?;
                {
                    let mut state = self.state.lock().unwrap();
                    self.emit(&mut state, id, |op| {
                        op.steps[INSTALL] = StepState::Complete;
                        op.steps[VERIFY] = StepState::Running;
                        op.status = Status::Verifying;
                    });
                }
                found = self.ports.resolve(route.id)?;
                check()?;
                if !found {
                    return Err(ErrorCode::Installation);
                }
            }
            if !found {
                return Ok(Status::SetupRequired);
            }
            // Discovery is the authority; version, account and protocol are
            // checked when the Agent starts.
            {
                let mut state = self.state.lock().unwrap();
                let committed = task(&state, id).is_some_and(|t| t.committed);
                if let Some(op) = state.operations.iter_mut().find(|o| o.operation_id == id) {
                    op.installed = true;
                    op.steps[INSTALL] = if committed {
                        StepState::Complete
                    } else {
                        StepState::Skipped
                    };
                }
            }
            check()?;
            Ok(Status::Ready)
        })();
        let mut state = self.state.lock().unwrap();
        if let Some(task) = state.tasks.iter_mut().find(|t| t.operation_id == id) {
            task.running = false;
        }
        match result {
            Ok(Status::SetupRequired) => self.emit(&mut state, id, |op| {
                op.steps[INSTALL] = StepState::Pending;
                op.status = Status::SetupRequired;
            }),
            Ok(status) => self.emit(&mut state, id, |op| {
                op.steps[VERIFY] = StepState::Complete;
                op.status = status;
            }),
            Err(_) if cancel.load(Ordering::Relaxed) => {
                self.emit(&mut state, id, |op| {
                    reset_running(op, StepState::Pending);
                    op.status = Status::Cancelled;
                    op.error = None;
                });
            }
            Err(code) => self.emit(&mut state, id, |op| {
                reset_running(op, StepState::Failed);
                op.status = Status::Failed;
                op.error = Some(code);
            }),
        }
        let installed = op(&state, id).is_some_and(|o| o.installed);
        drop(state);
        // A consequence of explicit setup, never of opening a view.
        if installed {
            self.ports.refresh();
        }
    }
    /// `emit`: apply, bump the revision, publish, persist.
    fn emit(&self, state: &mut State, id: &str, patch: impl FnOnce(&mut Operation)) {
        let Some(op) = state.operations.iter_mut().find(|o| o.operation_id == id) else {
            return;
        };
        patch(op);
        op.updated_at = super::super::agent_activity::now_millis();
        state.revision += 1;
        let value = snapshot(state);
        // A closed view cannot affect the work.
        (self.publish)(value.clone());
        let _ = self.journal.write(&value);
    }
}
fn reset_running(op: &mut Operation, to: StepState) {
    for step in op.steps.iter_mut() {
        if *step == StepState::Running {
            *step = to;
        }
    }
}
fn op<'a>(state: &'a State, id: &str) -> Option<&'a Operation> {
    state.operations.iter().find(|o| o.operation_id == id)
}
fn task<'a>(state: &'a State, id: &str) -> Option<&'a Task> {
    state.tasks.iter().find(|t| t.operation_id == id)
}
fn snapshot(state: &State) -> Snapshot {
    Snapshot {
        epoch: state.epoch.clone(),
        revision: state.revision,
        operations: state.operations.clone(),
    }
}

/// `createActivationJournal`: `{ schemaVersion: 2, snapshot }`, at most
/// 64 KiB, replaced atomically; an older revision never overwrites a newer.
struct Journal {
    path: PathBuf,
    written: Mutex<u64>,
}
impl Journal {
    fn read(&self) -> Result<Vec<Operation>, String> {
        let meta = match std::fs::symlink_metadata(&self.path) {
            Ok(meta) => meta,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
            Err(e) => return Err(e.to_string()),
        };
        if !meta.is_file() || meta.len() > 64 * 1024 {
            return Err("Invalid activation journal.".into());
        }
        let value: Value =
            serde_json::from_slice(&std::fs::read(&self.path).map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
        parse_journal(&value).ok_or_else(|| "Invalid activation journal.".into())
    }
    fn write(&self, snapshot: &Snapshot) -> std::io::Result<()> {
        let mut written = self.written.lock().unwrap();
        if snapshot.revision < *written {
            return Ok(());
        }
        let data = json!({ "schemaVersion": 2, "snapshot": snapshot_json(snapshot) }).to_string();
        let dir = self.path.parent().ok_or(std::io::ErrorKind::InvalidInput)?;
        std::fs::create_dir_all(dir)?;
        let temporary = self
            .path
            .with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt as _;
            options.mode(0o600);
        }
        let result = (|| {
            use std::io::Write as _;
            let mut file = options.open(&temporary)?;
            file.write_all(data.as_bytes())?;
            file.sync_all()?;
            std::fs::rename(&temporary, &self.path)
        })();
        let _ = std::fs::remove_file(&temporary);
        if result.is_ok() {
            *written = snapshot.revision;
        }
        result
    }
}
fn snapshot_json(snapshot: &Snapshot) -> Value {
    json!({
        "epoch": snapshot.epoch,
        "revision": snapshot.revision,
        "operations": snapshot.operations.iter().map(|op| json!({
            "operationId": op.operation_id,
            "setupId": op.setup_id,
            "displayName": op.display_name,
            "status": op.status.key(),
            "steps": STEPS.iter().zip(op.steps).map(|(id, s)| json!({ "id": id, "status": s.key() })).collect::<Vec<_>>(),
            "installed": op.installed,
            "errorCode": op.error.map(ErrorCode::key),
            "updatedAt": op.updated_at,
        })).collect::<Vec<_>>(),
    })
}
/// `readJournal` / `assertActivationSnapshot` (schema version 2).
fn parse_journal(value: &Value) -> Option<Vec<Operation>> {
    let object = value.as_object()?;
    if object.len() != 2 || value.get("schemaVersion")?.as_u64()? != 2 {
        return None;
    }
    let snapshot = value.get("snapshot")?.as_object()?;
    if snapshot.len() != 3 {
        return None;
    }
    let id_ok = |v: &str| {
        !v.is_empty()
            && v.len() <= 100
            && v.chars()
                .all(|c| c.is_ascii_alphanumeric() || c == ':' || c == '-')
    };
    id_ok(snapshot.get("epoch")?.as_str()?).then_some(())?;
    snapshot.get("revision")?.as_u64()?;
    let operations = snapshot.get("operations")?.as_array()?;
    if operations.len() > 16 {
        return None;
    }
    let mut seen = std::collections::HashSet::new();
    operations
        .iter()
        .map(|entry| {
            let entry = entry.as_object().filter(|e| e.len() == 8)?;
            let text = |k: &str| entry.get(k)?.as_str();
            let (operation_id, setup_id) = (text("operationId")?, text("setupId")?);
            let display_name = text("displayName").filter(|n| n.chars().count() <= 100)?;
            if !id_ok(operation_id) || !id_ok(setup_id) || !seen.insert(setup_id.to_owned()) {
                return None;
            }
            let steps = entry.get("steps")?.as_array().filter(|s| s.len() == 3)?;
            let mut parsed = [StepState::Pending; 3];
            for (i, step) in steps.iter().enumerate() {
                let step = step.as_object().filter(|s| s.len() == 2)?;
                if step.get("id")?.as_str()? != STEPS[i] {
                    return None;
                }
                parsed[i] = StepState::parse(step.get("status")?.as_str()?)?;
            }
            let error = match entry.get("errorCode")? {
                Value::Null => None,
                Value::String(code) => Some(ErrorCode::parse(code)?),
                _ => return None,
            };
            Some(Operation {
                operation_id: operation_id.into(),
                setup_id: setup_id.into(),
                display_name: display_name.into(),
                status: Status::parse(text("status")?)?,
                steps: parsed,
                installed: entry.get("installed")?.as_bool()?,
                error,
                updated_at: entry.get("updatedAt")?.as_u64()?,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    use std::{sync::mpsc, time::Duration};
    #[derive(Default)]
    struct Fake {
        found: Mutex<Vec<String>>,
        installs: Mutex<Vec<String>>,
        guides: Mutex<Vec<String>>,
        fail_install: Option<ErrorCode>,
        /// Blocks installs until cancelled.
        hold: bool,
    }
    impl Ports for Fake {
        fn resolve(&self, id: &str) -> Result<bool, ErrorCode> {
            Ok(self.found.lock().unwrap().iter().any(|f| f == id))
        }
        fn install(
            &self,
            recipe: &Recipe,
            cancel: &AtomicBool,
            committed: &dyn Fn(),
        ) -> Result<(), ErrorCode> {
            while self.hold && !cancel.load(Ordering::Relaxed) {
                std::thread::sleep(Duration::from_millis(5));
            }
            if cancel.load(Ordering::Relaxed) {
                return Err(ErrorCode::Interrupted);
            }
            if let Some(code) = self.fail_install {
                return Err(code);
            }
            self.installs.lock().unwrap().push(recipe.setup_id.into());
            self.found.lock().unwrap().push(recipe.setup_id.into());
            committed();
            Ok(())
        }
        fn open_guide(&self, url: &str) -> Result<(), String> {
            self.guides.lock().unwrap().push(url.into());
            Ok(())
        }
        fn refresh(&self) {}
    }
    fn new_service(dir: &std::path::Path, ports: Arc<Fake>) -> (Service, mpsc::Receiver<Snapshot>) {
        let (tx, rx) = mpsc::channel();
        let tx = Mutex::new(tx);
        let service = Service::for_platform(
            dir.join("local-agent-activation.json"),
            ports,
            Arc::new(move |s| {
                let _ = tx.lock().unwrap().send(s);
            }),
            "darwin",
            "arm64",
        );
        (service, rx)
    }
    fn settle(service: &Service, id: &str) -> Operation {
        for _ in 0..400 {
            let snapshot = service.read().unwrap();
            let op = snapshot
                .operations
                .into_iter()
                .find(|o| o.setup_id == id)
                .unwrap();
            if !op.status.active() || op.status == Status::SetupRequired {
                return op;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        panic!("activation of {id} did not settle");
    }
    #[test]
    fn a_recipe_installs_and_discovery_confirms_it() {
        let dir = tempfile::tempdir().unwrap();
        let ports = Arc::new(Fake::default());
        let (service, published) = new_service(dir.path(), ports.clone());
        let plan = service.plan("w1", "codex", Surface::Chat).unwrap();
        assert!(plan.automatic);
        assert_eq!((plan.version, plan.publisher), (Some("0.155.1"), "OpenAI"));
        // Plans belong to their window.
        assert_eq!(
            service.start("w2", &plan.plan_id),
            Err(ErrorCode::Unsupported)
        );
        service.start("w1", &plan.plan_id).unwrap();
        let op = settle(&service, "codex");
        assert_eq!(op.status, Status::Ready);
        assert_eq!(op.steps, [StepState::Complete; 3]);
        assert!(op.installed);
        assert_eq!(*ports.installs.lock().unwrap(), ["codex"]);
        let revisions: Vec<u64> = published.try_iter().map(|s| s.revision).collect();
        assert!(revisions.windows(2).all(|w| w[0] < w[1]) && !revisions.is_empty());
        // The journal survives a restart; a finished operation can be dismissed.
        let (again, _) = service_with_journal(dir.path());
        let restored = again.read().unwrap();
        assert_eq!(restored.operations, vec![op.clone()]);
        let dismissed = again.act(&op.operation_id, Action::Dismiss).unwrap();
        assert!(dismissed.operations.is_empty());
    }
    fn service_with_journal(dir: &std::path::Path) -> (Service, mpsc::Receiver<Snapshot>) {
        new_service(dir, Arc::new(Fake::default()))
    }
    #[test]
    fn guided_agents_wait_for_their_official_setup_and_existing_clis_are_reused() {
        let dir = tempfile::tempdir().unwrap();
        let ports = Arc::new(Fake::default());
        let (service, _) = new_service(dir.path(), ports.clone());
        let plan = service.plan("w", "claude", Surface::Chat).unwrap();
        assert!(!plan.automatic && plan.version.is_none());
        service.start("w", &plan.plan_id).unwrap();
        let op = settle(&service, "claude");
        assert_eq!(op.status, Status::SetupRequired);
        assert_eq!(
            op.steps,
            [StepState::Complete, StepState::Pending, StepState::Pending]
        );
        service.act(&op.operation_id, Action::Guide).unwrap();
        assert_eq!(
            *ports.guides.lock().unwrap(),
            ["https://code.claude.com/docs/en/setup"]
        );
        // After the guide, Check finds the CLI.
        ports.found.lock().unwrap().push("claude".into());
        service.act(&op.operation_id, Action::Check).unwrap();
        let op = settle(&service, "claude");
        assert_eq!(op.status, Status::Ready);
        assert_eq!(op.steps[1], StepState::Skipped);
        // An installed CLI is never reinstalled.
        ports.found.lock().unwrap().push("codex".into());
        let plan = service.plan("w", "codex", Surface::Terminal).unwrap();
        service.start("w", &plan.plan_id).unwrap();
        assert_eq!(settle(&service, "codex").steps[1], StepState::Skipped);
        assert!(ports.installs.lock().unwrap().is_empty());
        // Terminal-less and other-platform routes are unsupported.
        assert_eq!(
            service.plan("w", "workbuddy-china", Surface::Terminal),
            Err(ErrorCode::Unsupported)
        );
        assert_eq!(
            service.plan("w", "nope", Surface::Chat),
            Err(ErrorCode::Unsupported)
        );
    }
    #[test]
    fn cancel_failure_and_interruption_are_reported() {
        let dir = tempfile::tempdir().unwrap();
        let ports = Arc::new(Fake {
            hold: true,
            ..Fake::default()
        });
        let (service, _) = new_service(dir.path(), ports.clone());
        let plan = service.plan("w", "cursor", Surface::Chat).unwrap();
        let started = service.start("w", &plan.plan_id).unwrap();
        let id = started.operations[0].operation_id.clone();
        // Starting the same plan or Agent again joins the running operation.
        assert_eq!(
            service.start("w", &plan.plan_id).unwrap().operations.len(),
            1
        );
        while service.read().unwrap().operations[0].status != Status::Installing {
            std::thread::sleep(Duration::from_millis(5));
        }
        // An interrupted journal entry: a "restart" while it runs.
        let (restarted, _) = service_with_journal(dir.path());
        let op = restarted.read().unwrap().operations.remove(0);
        assert_eq!(
            (op.status, op.error),
            (Status::Interrupted, Some(ErrorCode::Interrupted))
        );
        assert_eq!(op.steps[1], StepState::Failed);
        service.act(&id, Action::Cancel).unwrap();
        let op = settle(&service, "cursor");
        assert_eq!((op.status, op.error), (Status::Cancelled, None));
        assert_eq!(
            op.steps,
            [StepState::Complete, StepState::Pending, StepState::Pending]
        );
        let failing = Arc::new(Fake {
            fail_install: Some(ErrorCode::Integrity),
            ..Fake::default()
        });
        let dir2 = tempfile::tempdir().unwrap();
        let (service, _) = new_service(dir2.path(), failing);
        let plan = service.plan("w", "codex", Surface::Chat).unwrap();
        service.start("w", &plan.plan_id).unwrap();
        let op = settle(&service, "codex");
        assert_eq!(
            (op.status, op.error),
            (Status::Failed, Some(ErrorCode::Integrity))
        );
        assert_eq!(op.steps[1], StepState::Failed);
        assert!(service.act(&op.operation_id, Action::Guide).is_err());
    }
    #[test]
    fn a_corrupt_journal_is_kept_and_reported() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("local-agent-activation.json");
        std::fs::write(&path, r#"{"schemaVersion":3,"snapshot":{}}"#).unwrap();
        let (service, _) = service_with_journal(dir.path());
        assert_eq!(service.read(), Err(ErrorCode::Storage));
        assert_eq!(
            service.plan("w", "codex", Surface::Chat),
            Err(ErrorCode::Storage)
        );
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            r#"{"schemaVersion":3,"snapshot":{}}"#
        );
    }
}
