//! `connections/local-agent-inventory.mjs`: the terminal-launched local
//! Agents, their probes and public connection states. Scans are
//! deduplicated, cached for five minutes, persisted (sanitized) for a day,
//! and an explicit Refresh supersedes an in-flight scan.
use super::local_agent_connection_policy::derive_local_connection;
use super::tools::local_agent_tool_registry::{
    LocalAgentTool, LocalAgentToolDescriptor, LocalToolProbe, LocalToolProbeRequest,
    create_local_agent_tool_registry,
};
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::contract::js;
use crate::agent::contract::local_connection_schema::sanitize_agent_local_connections_snapshot;
use crate::agent::discovery::command_environment::EnvMap;
use crate::agent::discovery::executable_discovery_port::{
    DiscoveryPortOptions, ExecutableDiscoveryPort, ReadEnvironment,
};
use crate::agent::installation::executable_resolver::{
    LocalAgentExecutableResolver, Observation, ResolutionContext, ResolvedCandidate,
};
use crate::agent::tasks::{CancelSignal, Canceller, SharedTask, shared};
use crate::clock;
use futures_util::future::{LocalBoxFuture, try_join_all};
use serde_json::{Value, json};
use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::path::PathBuf;
use std::rc::Rc;
use tokio::task::spawn_local;

pub const CACHE_TTL_MS: i64 = 5 * 60 * 1_000;
pub const PERSISTED_CACHE_TTL_MS: i64 = 24 * 60 * 60 * 1_000;
pub const MAX_PERSISTED_CACHE_BYTES: u64 = 64 * 1024;
const PERSISTED_CACHE_VERSION: i64 = 2;

/// `resolveCandidate(tool, context)`.
pub type ResolveCandidate = Rc<
    dyn Fn(
        &LocalAgentTool,
        Option<ResolutionContext>,
    ) -> LocalBoxFuture<'static, AgentResult<Option<ResolvedCandidate>>>,
>;
/// `logger.warn(message)`.
pub type Logger = Rc<dyn Fn(&str)>;

/// `createLocalAgentInventory({ … })` inputs.
#[derive(Clone, Default)]
pub struct LocalAgentInventoryOptions {
    pub app_version: Option<String>,
    pub env: Option<EnvMap>,
    pub homedir: Option<PathBuf>,
    pub platform: Option<String>,
    pub now: Option<Rc<dyn Fn() -> i64>>,
    pub cache_ttl_ms: Option<i64>,
    pub persisted_cache_ttl_ms: Option<i64>,
    pub cache_file_path: Option<PathBuf>,
    pub logger: Option<Logger>,
    pub tool_descriptors: Option<Vec<LocalAgentToolDescriptor>>,
    pub resolve_candidate: Option<ResolveCandidate>,
    pub probes: HashMap<String, LocalToolProbe>,
    pub read_environment: Option<ReadEnvironment>,
}

struct Inner {
    app_version: String,
    env: EnvMap,
    now: Rc<dyn Fn() -> i64>,
    cache_ttl_ms: i64,
    persisted_cache_ttl_ms: i64,
    cache_file_path: Option<PathBuf>,
    logger: Option<Logger>,
    tools: Vec<LocalAgentTool>,
    resolver: LocalAgentExecutableResolver,
    resolve_candidate: Option<ResolveCandidate>,
    probes: HashMap<String, LocalToolProbe>,
    cached: RefCell<Option<(i64, Value)>>,
    in_flight: RefCell<Option<(u64, SharedTask<AgentResult<Value>>)>>,
    active_controller: RefCell<Option<Canceller>>,
    persisted_cache_loaded: Cell<bool>,
    scan_generation: Cell<u64>,
    disposed: Cell<bool>,
}

/// `createLocalAgentInventory(options)`.
#[derive(Clone)]
pub struct LocalAgentInventory(Rc<Inner>);

fn abort_error(message: &str) -> AgentError {
    AgentError::new(message).with_name("AbortError")
}

/// `createLocalAgentInventory(options)`.
pub fn create_local_agent_inventory(
    options: LocalAgentInventoryOptions,
) -> AgentResult<LocalAgentInventory> {
    let tools = create_local_agent_tool_registry(options.tool_descriptors.clone())?;
    let env = options
        .env
        .clone()
        .unwrap_or_else(|| std::env::vars().collect());
    let resolver = LocalAgentExecutableResolver::new(
        None,
        ExecutableDiscoveryPort::new(DiscoveryPortOptions {
            node_platform: options.platform.clone(),
            env: Some(env.clone()),
            homedir: options.homedir.clone(),
            read_environment: options.read_environment.clone(),
            find_registered_applications: None,
        }),
    );
    Ok(LocalAgentInventory(Rc::new(Inner {
        app_version: options.app_version.unwrap_or_else(|| "0.0.0".into()),
        env,
        now: options.now.unwrap_or_else(|| Rc::new(clock::now_ms)),
        cache_ttl_ms: options.cache_ttl_ms.unwrap_or(CACHE_TTL_MS),
        persisted_cache_ttl_ms: options
            .persisted_cache_ttl_ms
            .unwrap_or(PERSISTED_CACHE_TTL_MS),
        cache_file_path: options.cache_file_path,
        logger: options.logger,
        tools,
        resolver,
        resolve_candidate: options.resolve_candidate,
        probes: options.probes,
        cached: RefCell::default(),
        in_flight: RefCell::default(),
        active_controller: RefCell::default(),
        persisted_cache_loaded: Cell::new(false),
        scan_generation: Cell::new(0),
        disposed: Cell::new(false),
    })))
}

impl LocalAgentInventory {
    /// `inventory.discover({ refresh, workspaceRoot })`.
    pub fn discover(
        &self,
        refresh: bool,
        workspace_root: Option<String>,
    ) -> LocalBoxFuture<'static, AgentResult<Value>> {
        let inner = &self.0;
        if inner.disposed.get() {
            return Box::pin(async { Err(AgentError::new("Local Agent inventory is closed.")) });
        }
        let in_flight = inner.in_flight.borrow().clone();
        if let Some((_, task)) = in_flight {
            if !refresh {
                return Box::pin(task);
            }
            if let Some(controller) = inner.active_controller.borrow().as_ref() {
                controller.cancel(abort_error("Local Agent inventory scan was superseded."));
            }
        }
        let started_at = (inner.now)();
        if !refresh
            && let Some((cached_at, snapshot)) = inner.cached.borrow().clone()
            && started_at - cached_at < inner.cache_ttl_ms
        {
            return Box::pin(async move { Ok(snapshot) });
        }
        let read_persisted = !refresh && !inner.persisted_cache_loaded.get();
        inner.persisted_cache_loaded.set(true);
        let controller = Canceller::new();
        let generation = inner.scan_generation.get() + 1;
        inner.scan_generation.set(generation);
        *inner.active_controller.borrow_mut() = Some(controller.clone());
        let this = self.clone();
        let signal = controller.signal();
        let task = shared(async move {
            let result = this
                .run(
                    read_persisted,
                    workspace_root,
                    started_at,
                    generation,
                    signal,
                )
                .await;
            let inner = &this.0;
            let current = inner
                .in_flight
                .borrow()
                .as_ref()
                .is_some_and(|(id, _)| *id == generation);
            if current {
                *inner.in_flight.borrow_mut() = None;
            }
            if inner.scan_generation.get() == generation {
                *inner.active_controller.borrow_mut() = None;
            }
            result
        });
        *inner.in_flight.borrow_mut() = Some((generation, task.clone()));
        spawn_local({
            let task = task.clone();
            async move {
                let _ = task.await;
            }
        });
        Box::pin(task)
    }

    async fn run(
        &self,
        read_persisted: bool,
        workspace_root: Option<String>,
        started_at: i64,
        generation: u64,
        signal: CancelSignal,
    ) -> AgentResult<Value> {
        let inner = &self.0;
        let persisted = if read_persisted {
            self.read_persisted_cache(started_at)
        } else {
            None
        };
        let from_disk = persisted.is_some();
        let snapshot = match persisted {
            Some(snapshot) => snapshot,
            None => self.scan(workspace_root, started_at, &signal).await?,
        };
        let superseded = || {
            inner.disposed.get()
                || generation != inner.scan_generation.get()
                || signal.is_cancelled()
        };
        if superseded() {
            return Err(abort_error("Local Agent inventory scan was superseded."));
        }
        if !from_disk {
            self.write_persisted_cache(&snapshot, started_at);
        }
        if superseded() {
            return Err(abort_error("Local Agent inventory scan was superseded."));
        }
        *inner.cached.borrow_mut() = Some((started_at, snapshot.clone()));
        Ok(snapshot)
    }

    fn warn(&self, message: &str) {
        if let Some(logger) = self.0.logger.as_ref() {
            logger(message);
        }
    }

    /// `readPersistedCache(startedAt)`.
    fn read_persisted_cache(&self, started_at: i64) -> Option<Value> {
        let path = self.0.cache_file_path.as_ref()?;
        let read = || -> std::io::Result<Option<Value>> {
            let metadata = std::fs::metadata(path)?;
            if metadata.len() > MAX_PERSISTED_CACHE_BYTES {
                return Ok(None);
            }
            let text = std::fs::read_to_string(path)?;
            let Ok(parsed) = serde_json::from_str::<Value>(&text) else {
                return Ok(None);
            };
            if parsed.get("version").and_then(Value::as_i64) != Some(PERSISTED_CACHE_VERSION) {
                return Ok(None);
            }
            let cached_at = js::to_number(parsed.get("cachedAt"));
            let age = started_at as f64 - cached_at;
            if !cached_at.is_finite() || age < 0.0 || age >= self.0.persisted_cache_ttl_ms as f64 {
                return Ok(None);
            }
            Ok(sanitize_agent_local_connections_snapshot(&parsed["snapshot"]).ok())
        };
        match read() {
            Ok(snapshot) => snapshot,
            Err(error) => {
                if error.kind() != std::io::ErrorKind::NotFound {
                    self.warn(&format!(
                        "Unable to read the local Agent inventory cache: {error}"
                    ));
                }
                None
            }
        }
    }

    /// `writePersistedCache(snapshot, cachedAt)`: atomic, owner-only.
    fn write_persisted_cache(&self, snapshot: &Value, cached_at: i64) {
        let Some(path) = self.0.cache_file_path.as_ref() else {
            return;
        };
        let Ok(safe) = sanitize_agent_local_connections_snapshot(snapshot) else {
            return;
        };
        let payload = js::stringify(&json!({
            "version": PERSISTED_CACHE_VERSION,
            "cachedAt": cached_at,
            "snapshot": safe,
        }));
        if payload.len() as u64 > MAX_PERSISTED_CACHE_BYTES {
            return;
        }
        let temporary = PathBuf::from(format!(
            "{}.{}.tmp",
            path.to_string_lossy(),
            std::process::id()
        ));
        let write = || -> std::io::Result<()> {
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let mut options = std::fs::OpenOptions::new();
            options.write(true).create(true).truncate(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            std::io::Write::write_all(&mut options.open(&temporary)?, payload.as_bytes())?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&temporary, std::fs::Permissions::from_mode(0o600))?;
            }
            std::fs::rename(&temporary, path)
        };
        if let Err(error) = write() {
            self.warn(&format!(
                "Unable to write the local Agent inventory cache: {error}"
            ));
            let _ = std::fs::remove_file(&temporary);
        }
    }

    /// `scan({ workspaceRoot, startedAt, signal })`.
    async fn scan(
        &self,
        workspace_root: Option<String>,
        started_at: i64,
        signal: &CancelSignal,
    ) -> AgentResult<Value> {
        let inner = &self.0;
        let (context, context_error) = if inner.resolve_candidate.is_some() {
            (None, None)
        } else {
            match inner.resolver.create_context(Some(signal.clone())).await {
                Ok(context) => (Some(context), None),
                Err(error) => (None, Some(error)),
            }
        };
        let outcomes = try_join_all(inner.tools.iter().map(|tool| {
            let (context, context_error) = (context.clone(), context_error.clone());
            let workspace_root = workspace_root.clone();
            let signal = signal.clone();
            async move {
                let probed = async {
                    if let Some(error) = context_error {
                        return Err(error);
                    }
                    let candidate = self.find_candidate(tool, context).await?;
                    let probe = inner
                        .probes
                        .get(&tool.id)
                        .cloned()
                        .unwrap_or_else(|| tool.probe.clone());
                    let env = candidate
                        .as_ref()
                        .and_then(|candidate| candidate.environment.clone())
                        .unwrap_or_else(|| inner.env.clone());
                    probe(LocalToolProbeRequest {
                        candidate,
                        app_version: inner.app_version.clone(),
                        workspace_root: workspace_root.filter(|root| !root.is_empty()),
                        env,
                        signal: signal.clone(),
                    })
                    .await
                }
                .await;
                match probed {
                    Ok(result) => Ok((
                        tool,
                        js::with(
                            &result,
                            "unavailableMessage",
                            tool.unavailable_message.as_str(),
                        ),
                        false,
                    )),
                    Err(error)
                        if signal.is_cancelled() || error.name.as_deref() == Some("AbortError") =>
                    {
                        Err(error)
                    }
                    Err(_) => Ok((
                        tool,
                        json!({
                            "id": tool.id,
                            "displayName": tool.display_name,
                            "installation": "broken",
                            "version": null,
                            "authentication": "error",
                            "protocolCompatible": false,
                            "hasModels": false,
                        }),
                        true,
                    )),
                }
            }
        }))
        .await?;
        Ok(json!({
            "connections": outcomes
                .iter()
                .map(|(_, result, _)| derive_local_connection(Some(result), None))
                .collect::<Vec<_>>(),
            "scannedAt": clock::iso_string(started_at),
            "warnings": outcomes
                .iter()
                .filter(|(_, _, failed)| *failed)
                .map(|(tool, _, _)| format!("{} could not be inspected. Refresh to try again.", tool.display_name))
                .collect::<Vec<_>>(),
        }))
    }

    async fn find_candidate(
        &self,
        tool: &LocalAgentTool,
        context: Option<ResolutionContext>,
    ) -> AgentResult<Option<ResolvedCandidate>> {
        if let Some(resolve) = self.0.resolve_candidate.as_ref() {
            return resolve(tool, context).await;
        }
        match self
            .0
            .resolver
            .resolve(&tool.installation_id, context, Vec::new())
            .await?
        {
            Observation::Failed { reason_code } => Err(AgentError::new(reason_code)),
            Observation::Found { candidate, .. } => Ok(Some(*candidate)),
            Observation::NotFound { .. } => Ok(None),
        }
    }

    /// `inventory.dispose()`.
    #[cfg(test)]
    pub fn dispose(&self) {
        let inner = &self.0;
        inner.disposed.set(true);
        inner.scan_generation.set(inner.scan_generation.get() + 1);
        if let Some(controller) = inner.active_controller.borrow_mut().take() {
            controller.cancel(abort_error("Local Agent inventory is closed."));
        }
        *inner.cached.borrow_mut() = None;
    }
}
