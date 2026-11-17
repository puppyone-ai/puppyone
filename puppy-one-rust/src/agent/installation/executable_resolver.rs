//! `local-agent-installation/executable-resolver.mjs`: resolve an
//! installation without invoking a login shell or executing any discovered
//! binary. File-system checks run under the shared discovery budget.
use super::candidate_identity::verify_candidate_identity;
use super::installation_definition::{
    CandidateContext, CandidateSpec, InstallationDefinition, NameSpec,
};
use super::installation_registry::{
    DEFAULT_LOCAL_AGENT_INSTALLATION_REGISTRY, InstallationRegistry,
    get_local_agent_installation_definition,
};
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::discovery::command_environment::EnvMap;
use crate::agent::discovery::discovery_io_budget::run_discovery_io;
use crate::agent::discovery::executable_discovery_port::ExecutableDiscoveryPort;
use crate::agent::tasks::CancelSignal;
use crate::platform::paths;
use crate::text;
use regex::Regex;
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::io::Read;
use std::path::Path;
use std::sync::{Arc, LazyLock};

/// `executableCandidateLimits`.
pub mod limits {
    pub const MAX_PATH_DIRECTORIES: usize = 256;
    pub const MAX_NAMES: usize = 8;
    pub const MAX_EXECUTABLE_VARIANTS: usize = 4;
    pub const MAX_SEARCH_DIRECTORIES: usize = MAX_PATH_DIRECTORIES;
    pub const MAX_CONFIGURED_CANDIDATES: usize = 16;
    pub const MAX_IDENTITY_FILE_BYTES: usize = 1024 * 1024;
    pub const MAX_CANDIDATES: usize =
        MAX_SEARCH_DIRECTORIES * MAX_NAMES * MAX_EXECUTABLE_VARIANTS + MAX_CONFIGURED_CANDIDATES;
}
use limits::*;

static EXECUTABLE_NAME: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[A-Za-z0-9._-]+$").expect("pattern"));
static WINDOWS_EXECUTABLE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\.(?:com|exe|bat|cmd)$").expect("pattern"));
static SOURCE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[A-Za-z0-9._-]{1,80}$").expect("pattern"));
static OVERRIDE_KEY: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[A-Za-z_][A-Za-z0-9_]{0,79}$").expect("pattern"));

/// A validated candidate (`observation.candidate`).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ResolvedCandidate {
    pub executable_path: String,
    pub canonical_identity: String,
    pub identity_fingerprint: String,
    pub entrypoint_path: Option<String>,
    pub entrypoint_canonical_identity: Option<String>,
    pub entrypoint_identity_fingerprint: Option<String>,
    pub invoked_as: String,
    pub args_prefix: Vec<String>,
    pub identity_file_path: Option<String>,
    pub identity_file_canonical_identity: Option<String>,
    pub identity_file_fingerprint: Option<String>,
    pub identity_file_content_fingerprint: Option<String>,
    pub requires_manifest_identity: bool,
    pub environment_overrides: Option<Vec<(String, String)>>,
    pub identity_mismatch_as_not_found: bool,
    pub launch_path_entry: String,
    pub source: String,
    /// The launch environment, once an installation resolver chose it.
    pub environment: Option<EnvMap>,
    pub environment_source: Option<String>,
}

/// `{ status, reasonCode, candidate }`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Observation {
    Found {
        candidate: Box<ResolvedCandidate>,
        reason_code: Option<String>,
    },
    NotFound {
        reason_code: String,
    },
    Failed {
        reason_code: String,
    },
}

impl Observation {
    pub fn status(&self) -> &'static str {
        match self {
            Self::Found { .. } => "found",
            Self::NotFound { .. } => "not-found",
            Self::Failed { .. } => "failed",
        }
    }

    pub fn reason_code(&self) -> Option<&str> {
        match self {
            Self::Found { reason_code, .. } => reason_code.as_deref(),
            Self::NotFound { reason_code } | Self::Failed { reason_code } => Some(reason_code),
        }
    }
}

fn failed(reason_code: &str) -> Observation {
    Observation::Failed {
        reason_code: reason_code.into(),
    }
}

/// One PATH (or product) directory searched for executable names.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SearchDirectory {
    pub directory: String,
    pub source: String,
}

/// `{ directories, executableExtensions }`.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SearchContext {
    pub directories: Vec<SearchDirectory>,
    pub executable_extensions: Vec<String>,
}

/// `resolver.createContext({ signal })`.
#[derive(Clone)]
pub struct ResolutionContext {
    pub environment: EnvMap,
    pub environment_source: String,
    pub environment_complete: bool,
    pub environment_reason_code: Option<String>,
    pub executable_search: SearchContext,
    pub signal: Option<CancelSignal>,
}

/// `acceptCandidate(candidate)`, run under the discovery budget.
pub type AcceptCandidate = Arc<dyn Fn(&ResolvedCandidate) -> AgentResult<bool> + Send + Sync>;

/// `createLocalAgentExecutableResolver({ registry, discoveryPort, verifyIdentity })`.
pub struct LocalAgentExecutableResolver {
    registry: InstallationRegistry,
    discovery_port: ExecutableDiscoveryPort,
}

impl LocalAgentExecutableResolver {
    pub fn new(
        registry: Option<InstallationRegistry>,
        discovery_port: ExecutableDiscoveryPort,
    ) -> Self {
        Self {
            registry: registry.unwrap_or_else(|| DEFAULT_LOCAL_AGENT_INSTALLATION_REGISTRY.clone()),
            discovery_port,
        }
    }

    /// `resolver.createContext({ signal })`.
    pub async fn create_context(
        &self,
        signal: Option<CancelSignal>,
    ) -> AgentResult<ResolutionContext> {
        let snapshot = self
            .discovery_port
            .capture_environment(signal.clone())
            .await?;
        let executable_search = create_executable_search_context(
            &snapshot.environment,
            &self.discovery_port.node_platform,
        )?;
        Ok(ResolutionContext {
            environment: snapshot.environment,
            environment_source: snapshot.source,
            environment_complete: snapshot.complete,
            environment_reason_code: snapshot.reason_code,
            executable_search,
            signal,
        })
    }

    /// `resolver.resolve(agentId, { context, extraCandidates })`.
    pub async fn resolve(
        &self,
        agent_id: &str,
        context: Option<ResolutionContext>,
        extra_candidates: Vec<CandidateSpec>,
    ) -> AgentResult<Observation> {
        let Some(definition) =
            get_local_agent_installation_definition(agent_id, &self.registry).cloned()
        else {
            return Ok(failed("unknown-agent"));
        };
        let context = match context {
            Some(context) => context,
            None => match self.create_context(None).await {
                Ok(context) => context,
                Err(_) => return Ok(failed("context-error")),
            },
        };
        let signal = context.signal.clone();
        if let Some(signal) = signal.as_ref() {
            signal.check()?;
        }
        let port = &self.discovery_port;
        let environment = context.environment.clone();
        let mut registered_applications = Vec::new();
        if port.node_platform == "win32"
            && let Some(names) = definition
                .registered_application_names
                .clone()
                .filter(|n| !n.is_empty())
        {
            match port
                .find_registered_applications(names, signal.clone())
                .await
            {
                Ok(found) => registered_applications = found,
                Err(_) => {
                    if let Some(signal) = signal.as_ref() {
                        signal.check()?;
                    }
                }
            }
        }
        let product_candidates = match definition.candidate_paths.as_ref() {
            Some(candidate_paths) => {
                let candidate_context = CandidateContext {
                    env: &environment,
                    homedir: &port.homedir,
                    platform: &port.node_platform,
                    registered_applications: &registered_applications,
                };
                match candidate_paths(&candidate_context) {
                    Ok(candidates) => candidates,
                    Err(_) => return Ok(failed("candidate-provider-error")),
                }
            }
            None => Vec::new(),
        };
        let mut configured = normalize_extra_candidates(extra_candidates);
        configured.extend(product_candidates);
        let policy = definition.identity_policy.clone();
        let accept: AcceptCandidate = Arc::new(move |candidate: &ResolvedCandidate| {
            Ok(policy
                .as_ref()
                .is_none_or(|policy| verify_candidate_identity(policy, candidate)))
        });
        let observation = resolve_executable_observation(ObservationRequest {
            names: definition.executable_names.clone(),
            configured_candidates: configured,
            search_context: Some(executable_search_context_for_definition(
                &context.executable_search,
                &definition,
            )),
            accept_candidate: Some(accept),
            env: environment.clone(),
            platform: port.node_platform.clone(),
            signal: signal.clone(),
            ..Default::default()
        })
        .await?;
        match observation {
            Observation::Found {
                mut candidate,
                reason_code,
            } => {
                let mut launch_environment = environment.clone();
                for (key, value) in candidate.environment_overrides.iter().flatten() {
                    launch_environment.insert(key.clone(), value.clone());
                }
                candidate.environment = Some(launch_environment);
                candidate.environment_source = Some(context.environment_source.clone());
                Ok(Observation::Found {
                    candidate,
                    reason_code: if context.environment_complete {
                        reason_code
                    } else {
                        Some("environment-unavailable".into())
                    },
                })
            }
            Observation::NotFound { .. } if !context.environment_complete => Ok(failed(
                context
                    .environment_reason_code
                    .as_deref()
                    .filter(|code| !code.is_empty())
                    .unwrap_or("environment-unavailable"),
            )),
            observation => Ok(observation),
        }
    }
}

fn executable_search_context_for_definition(
    search_context: &SearchContext,
    definition: &InstallationDefinition,
) -> SearchContext {
    if definition.search_path {
        return search_context.clone();
    }
    SearchContext {
        directories: search_context
            .directories
            .iter()
            .filter(|entry| entry.source != "path-installation")
            .cloned()
            .collect(),
        executable_extensions: search_context.executable_extensions.clone(),
    }
}

/// `createExecutableSearchContext({ env, platform })`.
pub fn create_executable_search_context(
    env: &EnvMap,
    platform: &str,
) -> AgentResult<SearchContext> {
    let raw = env
        .get("PATH")
        .or_else(|| env.get("Path"))
        .cloned()
        .unwrap_or_default();
    let separator = if platform == "win32" { ';' } else { ':' };
    let mut directories = Vec::new();
    let mut seen = HashSet::new();
    for directory in raw.split(separator).filter(|d| safe_absolute_path(d)) {
        let key = if platform == "win32" {
            directory.to_lowercase()
        } else {
            directory.to_string()
        };
        if seen.contains(&key) {
            continue;
        }
        if directories.len() >= MAX_PATH_DIRECTORIES {
            return Err(AgentError::new(
                "Executable PATH exceeds the search budget.",
            ));
        }
        seen.insert(key);
        directories.push(SearchDirectory {
            directory: directory.to_string(),
            source: "path-installation".into(),
        });
    }
    let executable_extensions = if platform == "win32" {
        let mut extensions: Vec<String> = Vec::new();
        let raw = env
            .get("PATHEXT")
            .filter(|v| !v.is_empty())
            .cloned()
            .unwrap_or_else(|| ".COM;.EXE;.BAT;.CMD".into());
        for value in raw.split(';').map(str::to_lowercase) {
            if [".com", ".exe", ".bat", ".cmd"].contains(&value.as_str())
                && !extensions.contains(&value)
            {
                extensions.push(value);
            }
        }
        extensions
    } else {
        Vec::new()
    };
    Ok(SearchContext {
        directories,
        executable_extensions,
    })
}

/// `resolveExecutableObservation({ … })` options.
#[derive(Clone, Default)]
pub struct ObservationRequest {
    pub names: Vec<NameSpec>,
    pub configured_candidates: Vec<CandidateSpec>,
    pub configured_paths: Vec<String>,
    pub search_context: Option<SearchContext>,
    pub accept_candidate: Option<AcceptCandidate>,
    pub env: EnvMap,
    pub platform: String,
    pub signal: Option<CancelSignal>,
}

/// `push(filename, descriptor, source, recipe)` while ordering candidates.
type PushCandidate<'a> = dyn FnMut(String, &Descriptor, String, Option<CandidateSpec>) + 'a;

/// One ordered candidate before validation.
#[derive(Clone, Debug)]
struct Pending {
    filename: String,
    descriptor: Descriptor,
    source: String,
    recipe: Option<CandidateSpec>,
}

#[derive(Clone, Debug)]
struct Descriptor {
    file_name: String,
    invoked_as: String,
    args_prefix: Vec<String>,
}

fn is_explicit_source(value: &str) -> bool {
    matches!(
        value,
        "configured" | "environment-override" | "explicit-configuration"
    )
}

fn signal_check(signal: Option<&CancelSignal>) -> AgentResult<()> {
    signal.map_or(Ok(()), CancelSignal::check)
}

/// `resolveExecutableObservation(options)`.
pub async fn resolve_executable_observation(
    request: ObservationRequest,
) -> AgentResult<Observation> {
    let signal = request.signal.clone();
    let context = match request.search_context {
        Some(context) => context,
        None => create_executable_search_context(&request.env, &request.platform)?,
    };
    let descriptors = normalize_names(
        &request.names,
        &request.platform,
        &context.executable_extensions,
    );
    if descriptors.is_empty() {
        return Ok(failed("no-executable-names"));
    }
    let mut configured: Vec<CandidateSpec> = request
        .configured_paths
        .iter()
        .map(|path| CandidateSpec::new(path.clone(), "configured"))
        .collect();
    configured.extend(request.configured_candidates);
    let Some(candidates) = build_candidates(&descriptors, &configured, &context) else {
        return Ok(failed("invalid-configuration"));
    };
    let mut failure_reason: Option<String> = None;
    for candidate in candidates {
        signal_check(signal.as_ref())?;
        let probe = candidate.clone();
        let validation = match run_discovery_io(
            move || Ok(validate_candidate(&probe)),
            signal.as_ref(),
            None,
        )
        .await
        {
            Ok(validation) => validation,
            Err(error) => {
                signal_check(signal.as_ref())?;
                return Ok(failed(if error.is("filesystem-busy") {
                    "filesystem-busy"
                } else {
                    "filesystem-timeout"
                }));
            }
        };
        let explicit = is_explicit_source(&candidate.source);
        let validated = match validation {
            Observation::NotFound { .. } => {
                if explicit {
                    return Ok(failed("configured-path-not-found"));
                }
                continue;
            }
            Observation::Failed { reason_code } => {
                if explicit {
                    return Ok(failed(&format!("configured-{reason_code}")));
                }
                failure_reason.get_or_insert(reason_code);
                continue;
            }
            Observation::Found { candidate, .. } => candidate,
        };
        if let Some(accept) = request.accept_candidate.clone() {
            let probe = validated.clone();
            match run_discovery_io(move || accept(&probe), signal.as_ref(), None).await {
                Ok(true) => {}
                Ok(false) => {
                    if explicit {
                        return Ok(failed("configured-identity-mismatch"));
                    }
                    if validated.identity_mismatch_as_not_found {
                        continue;
                    }
                    failure_reason.get_or_insert("identity-mismatch".into());
                    continue;
                }
                Err(error) => {
                    signal_check(signal.as_ref())?;
                    for code in ["filesystem-timeout", "filesystem-busy"] {
                        if error.is(code) {
                            return Ok(failed(code));
                        }
                    }
                    if explicit {
                        return Ok(failed("configured-identity-check-error"));
                    }
                    failure_reason.get_or_insert("identity-check-error".into());
                    continue;
                }
            }
        }
        return Ok(Observation::Found {
            candidate: validated,
            reason_code: None,
        });
    }
    Ok(match failure_reason {
        Some(reason_code) => Observation::Failed { reason_code },
        None => Observation::NotFound {
            reason_code: "not-found".into(),
        },
    })
}

/// `resolveFirstExecutable(options)`.
#[cfg(test)]
pub async fn resolve_first_executable(
    request: ObservationRequest,
) -> AgentResult<Option<ResolvedCandidate>> {
    Ok(match resolve_executable_observation(request).await? {
        Observation::Found { candidate, .. } => Some(*candidate),
        _ => None,
    })
}

/// `assertExecutableIdentity(candidate)`: the candidate's files are still
/// the ones discovery verified.
pub async fn assert_executable_identity(candidate: &ResolvedCandidate) -> AgentResult<String> {
    let candidate = candidate.clone();
    run_discovery_io(move || verify_executable_identity(&candidate), None, None).await
}

fn verify_executable_identity(candidate: &ResolvedCandidate) -> AgentResult<String> {
    if !safe_absolute_path(&candidate.executable_path) {
        return Err(AgentError::new(
            "Local executable is not a safe absolute path.",
        ));
    }
    verify_candidate_file(
        &candidate.executable_path,
        Some(&candidate.canonical_identity),
        Some(&candidate.identity_fingerprint),
        None,
        "executable",
        Access::Execute,
        None,
    )?;
    if let Some(entrypoint) = candidate.entrypoint_path.as_ref() {
        verify_candidate_file(
            entrypoint,
            candidate.entrypoint_canonical_identity.as_deref(),
            candidate.entrypoint_identity_fingerprint.as_deref(),
            None,
            "entrypoint",
            Access::Execute,
            None,
        )?;
    }
    if let Some(identity_file) = candidate.identity_file_path.as_ref() {
        verify_candidate_file(
            identity_file,
            candidate.identity_file_canonical_identity.as_deref(),
            candidate.identity_file_fingerprint.as_deref(),
            candidate.identity_file_content_fingerprint.as_deref(),
            "identity manifest",
            Access::Read,
            Some(MAX_IDENTITY_FILE_BYTES),
        )?;
    }
    Ok(candidate.executable_path.clone())
}

#[derive(Clone, Copy)]
enum Access {
    Read,
    Execute,
}

/// `fs.promises.access(file, mode)`.
fn access(path: &Path, mode: Access) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::ffi::OsStrExt;
        let path =
            std::ffi::CString::new(path.as_os_str().as_bytes()).map_err(std::io::Error::other)?;
        let flag = match mode {
            Access::Read => libc::R_OK,
            Access::Execute => libc::X_OK,
        };
        if unsafe { libc::access(path.as_ptr(), flag) } == 0 {
            Ok(())
        } else {
            Err(std::io::Error::last_os_error())
        }
    }
    #[cfg(not(unix))]
    {
        let _ = mode;
        std::fs::metadata(path).map(|_| ())
    }
}

fn verify_candidate_file(
    file: &str,
    expected: Option<&str>,
    expected_fingerprint: Option<&str>,
    expected_content_fingerprint: Option<&str>,
    label: &str,
    mode: Access,
    content_limit: Option<usize>,
) -> AgentResult<()> {
    if !safe_absolute_path(file) {
        return Err(AgentError::new(format!(
            "Local {label} is not a safe absolute path."
        )));
    }
    let changed = || AgentError::new(format!("Local {label} changed identity before launch."));
    let resolved = std::fs::canonicalize(file)?.to_string_lossy().into_owned();
    if resolved != expected.filter(|e| !e.is_empty()).unwrap_or(file) {
        return Err(changed());
    }
    let metadata = std::fs::metadata(&resolved)?;
    if !metadata.is_file() {
        return Err(AgentError::new(format!(
            "Local {label} is not a regular file."
        )));
    }
    access(Path::new(&resolved), mode)?;
    if let Some(expected) = expected_fingerprint.filter(|e| !e.is_empty())
        && fingerprint(&metadata) != expected
    {
        return Err(changed());
    }
    if let Some(expected) = expected_content_fingerprint.filter(|e| !e.is_empty())
        && fingerprint_content(&resolved, content_limit.unwrap_or(MAX_IDENTITY_FILE_BYTES))?
            != expected
    {
        return Err(changed());
    }
    Ok(())
}

fn build_candidates(
    descriptors: &[Descriptor],
    configured: &[CandidateSpec],
    search_context: &SearchContext,
) -> Option<Vec<Pending>> {
    let mut explicit = Vec::new();
    let mut product = Vec::new();
    for entry in configured.iter().take(MAX_CONFIGURED_CANDIDATES) {
        if !safe_absolute_path(&entry.path) {
            return None;
        }
        if is_explicit_source(&entry.source) {
            explicit.push(entry.clone());
        } else {
            product.push(entry.clone());
        }
    }
    let mut ordered: Vec<Pending> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    let mut push = |filename: String,
                    descriptor: &Descriptor,
                    source: String,
                    recipe: Option<CandidateSpec>| {
        if ordered.len() >= MAX_CANDIDATES || !safe_absolute_path(&filename) {
            return;
        }
        if !seen.insert(format!("{filename}\0{}", descriptor.invoked_as)) {
            return;
        }
        ordered.push(Pending {
            filename,
            descriptor: descriptor.clone(),
            source,
            recipe,
        });
    };
    let push_configured = |entry: &CandidateSpec, push: &mut PushCandidate<'_>| {
        let name = paths::file_name(&entry.path);
        let descriptor = descriptors
            .iter()
            .find(|descriptor| descriptor.file_name == name)
            .unwrap_or(&descriptors[0]);
        push(
            entry.path.clone(),
            descriptor,
            safe_source(&entry.source),
            Some(entry.clone()),
        );
    };
    let push_directories = |matches: &dyn Fn(&str) -> bool, push: &mut PushCandidate<'_>| {
        for entry in &search_context.directories {
            if !safe_absolute_path(&entry.directory) {
                continue;
            }
            let source = safe_source(&entry.source);
            if !matches(&source) {
                continue;
            }
            for descriptor in descriptors {
                let filename = Path::new(&entry.directory).join(&descriptor.file_name);
                push(
                    filename.to_string_lossy().into_owned(),
                    descriptor,
                    source.clone(),
                    None,
                );
            }
        }
    };
    for entry in &explicit {
        push_configured(entry, &mut push);
    }
    push_directories(&|source| source == "path-installation", &mut push);
    for entry in &product {
        push_configured(entry, &mut push);
    }
    push_directories(&|source| source != "path-installation", &mut push);
    Some(ordered)
}

fn io_observation(error: &std::io::Error) -> Observation {
    match error.kind() {
        std::io::ErrorKind::NotFound | std::io::ErrorKind::NotADirectory => Observation::NotFound {
            reason_code: "not-found".into(),
        },
        std::io::ErrorKind::PermissionDenied => failed("permission-denied"),
        _ => failed("filesystem-error"),
    }
}

/// An inspected file: canonical path, metadata and optional content digest.
struct Inspected {
    resolved: String,
    metadata: std::fs::Metadata,
    content_fingerprint: Option<String>,
}

fn validate_candidate(candidate: &Pending) -> Observation {
    let entrypoint = match inspect_candidate_file(&candidate.filename, Access::Execute, None) {
        Ok(found) => found,
        Err(observation) => return observation,
    };
    let recipe = candidate.recipe.clone().unwrap_or_default();
    let launcher_path = recipe
        .launcher_path
        .clone()
        .unwrap_or_else(|| candidate.filename.clone());
    let launcher = if launcher_path == candidate.filename {
        None
    } else {
        match inspect_candidate_file(&launcher_path, Access::Execute, None) {
            Ok(found) => Some(found),
            Err(observation) => return observation,
        }
    };
    let identity_file = match recipe.identity_file_path.as_ref() {
        Some(path) => {
            match inspect_candidate_file(path, Access::Read, Some(MAX_IDENTITY_FILE_BYTES)) {
                Ok(found) => Some(found),
                Err(observation) => return observation,
            }
        }
        None => None,
    };
    let launch_directory = Path::new(&launcher_path)
        .parent()
        .unwrap_or(Path::new(&launcher_path));
    let launch_path_entry = match std::fs::canonicalize(launch_directory) {
        Ok(path) => path.to_string_lossy().into_owned(),
        Err(error) => return io_observation(&error),
    };
    let recipe_args = match recipe.args_prefix.as_ref() {
        None => candidate.descriptor.args_prefix.clone(),
        Some(args) => {
            let normalized = normalize_args(args);
            if normalized.len() != args.len() {
                return failed("invalid-launch-recipe");
            }
            normalized
        }
    };
    let launcher_file = launcher.as_ref().unwrap_or(&entrypoint);
    let separate_launcher = launcher.is_some();
    let overrides = recipe
        .environment_overrides
        .as_ref()
        .map(|overrides| normalize_environment_overrides(overrides))
        .filter(|overrides| !overrides.is_empty());
    Observation::Found {
        candidate: Box::new(ResolvedCandidate {
            executable_path: launcher_path.clone(),
            canonical_identity: launcher_file.resolved.clone(),
            identity_fingerprint: fingerprint(&launcher_file.metadata),
            entrypoint_path: separate_launcher.then(|| candidate.filename.clone()),
            entrypoint_canonical_identity: separate_launcher.then(|| entrypoint.resolved.clone()),
            entrypoint_identity_fingerprint: separate_launcher
                .then(|| fingerprint(&entrypoint.metadata)),
            invoked_as: candidate.descriptor.invoked_as.clone(),
            args_prefix: recipe_args,
            identity_file_path: identity_file
                .as_ref()
                .and(recipe.identity_file_path.clone()),
            identity_file_canonical_identity: identity_file
                .as_ref()
                .map(|file| file.resolved.clone()),
            identity_file_fingerprint: identity_file
                .as_ref()
                .map(|file| fingerprint(&file.metadata)),
            identity_file_content_fingerprint: identity_file
                .as_ref()
                .and_then(|file| file.content_fingerprint.clone()),
            requires_manifest_identity: recipe.requires_manifest_identity,
            environment_overrides: overrides,
            identity_mismatch_as_not_found: recipe.identity_mismatch_as_not_found,
            launch_path_entry,
            source: candidate.source.clone(),
            environment: None,
            environment_source: None,
        }),
        reason_code: None,
    }
}

fn inspect_candidate_file(
    filename: &str,
    mode: Access,
    content_limit: Option<usize>,
) -> Result<Inspected, Observation> {
    if !safe_absolute_path(filename) {
        return Err(failed("unsafe-path"));
    }
    let resolved = std::fs::canonicalize(filename)
        .map_err(|error| io_observation(&error))?
        .to_string_lossy()
        .into_owned();
    if !safe_absolute_path(&resolved) {
        return Err(failed("unsafe-canonical-path"));
    }
    let metadata = std::fs::metadata(&resolved).map_err(|error| io_observation(&error))?;
    if !metadata.is_file() {
        return Err(failed("not-a-file"));
    }
    access(Path::new(&resolved), mode).map_err(|error| io_observation(&error))?;
    let content_fingerprint = match content_limit {
        Some(limit) => {
            Some(fingerprint_content(&resolved, limit).map_err(|_| failed("filesystem-error"))?)
        }
        None => None,
    };
    Ok(Inspected {
        resolved,
        metadata,
        content_fingerprint,
    })
}

fn fingerprint_content(filename: &str, max_bytes: usize) -> AgentResult<String> {
    let file = std::fs::File::open(filename)?;
    let mut buffer = Vec::new();
    file.take(max_bytes as u64 + 1).read_to_end(&mut buffer)?;
    if buffer.len() > max_bytes {
        return Err(AgentError::new(
            "Local identity file exceeds the size limit.",
        ));
    }
    Ok(Sha256::digest(&buffer)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

fn normalize_names(names: &[NameSpec], platform: &str, extensions: &[String]) -> Vec<Descriptor> {
    names
        .iter()
        .take(MAX_NAMES)
        .flat_map(|value| match value {
            NameSpec::Text(text) => {
                let trimmed = text::trim(text);
                if trimmed.is_empty() {
                    return Vec::new();
                }
                let mut parts = trimmed.split_whitespace();
                let binary = parts.next().unwrap_or_default();
                let args_prefix: Vec<String> = parts.map(str::to_string).collect();
                executable_names(binary, platform, extensions)
                    .into_iter()
                    .map(|file_name| Descriptor {
                        file_name,
                        invoked_as: text::head16(trimmed, 80).to_string(),
                        args_prefix: args_prefix.clone(),
                    })
                    .collect()
            }
        })
        .collect()
}

fn executable_names(value: &str, platform: &str, extensions: &[String]) -> Vec<String> {
    if !EXECUTABLE_NAME.is_match(value) {
        return Vec::new();
    }
    if platform != "win32" || WINDOWS_EXECUTABLE.is_match(value) {
        return vec![value.to_string()];
    }
    extensions
        .iter()
        .map(|extension| format!("{value}{extension}"))
        .collect()
}

fn normalize_extra_candidates(values: Vec<CandidateSpec>) -> Vec<CandidateSpec> {
    values
        .into_iter()
        .map(|mut value| {
            if value.source.is_empty() {
                value.source = "explicit-configuration".into();
            }
            value
        })
        .collect()
}

fn normalize_args(value: &[String]) -> Vec<String> {
    value
        .iter()
        .take(4)
        .filter(|entry| text::len16(entry) <= 4_096 && !entry.contains(['\r', '\n', '\0']))
        .cloned()
        .collect()
}

fn normalize_environment_overrides(value: &[(String, String)]) -> Vec<(String, String)> {
    value
        .iter()
        .take(8)
        .filter(|(key, entry)| {
            OVERRIDE_KEY.is_match(key)
                && text::len16(entry) <= 4_096
                && !entry.contains(['\r', '\n', '\0'])
        })
        .cloned()
        .collect()
}

/// `safeAbsolutePath(value)`.
pub fn safe_absolute_path(value: &str) -> bool {
    !value.is_empty()
        && text::len16(value) <= 4_096
        && paths::is_absolute(value)
        && !value.contains(['\r', '\n', '\0'])
}

fn safe_source(value: &str) -> String {
    if SOURCE.is_match(value) {
        value.to_string()
    } else {
        "search-context".into()
    }
}

/// `[dev, ino, size, Math.trunc(mtimeMs)].join(":")`.
fn fingerprint(metadata: &std::fs::Metadata) -> String {
    let mtime_ms = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0, |duration| duration.as_millis());
    #[cfg(unix)]
    let (dev, ino) = {
        use std::os::unix::fs::MetadataExt;
        (metadata.dev(), metadata.ino())
    };
    #[cfg(not(unix))]
    let (dev, ino) = (0u64, 0u64);
    format!("{dev}:{ino}:{}:{mtime_ms}", metadata.len())
}
