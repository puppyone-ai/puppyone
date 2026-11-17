//! `local-agent-installation/installation-definition.mjs`: one validated
//! installation definition (names, candidate paths and identity policy).
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::discovery::command_environment::EnvMap;
use crate::agent::discovery::windows::registered_applications::RegisteredApplication;
use regex::Regex;
use std::path::Path;
use std::sync::{Arc, LazyLock};

/// `LOCAL_AGENT_INSTALLATION_IDS` (`shared/local-agent-installation/schema.mjs`).
pub const LOCAL_AGENT_INSTALLATION_IDS: &[&str] = &[
    "codex",
    "claude",
    "cursor",
    "opencode",
    "pi",
    "workbuddy-china",
    "workbuddy-international",
    "hermes",
];

static REGISTERED_APPLICATION_NAME: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[A-Za-z0-9 ._-]+\.exe$").expect("application name pattern"));
static MANIFEST_FILE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[A-Za-z0-9._-]{1,80}$").expect("pattern"));
static MANIFEST_PROPERTY: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[A-Za-z][A-Za-z0-9_]{0,79}$").expect("pattern"));

/// One `executableNames` entry: the executable and its leading arguments,
/// `"cursor agent"`. (The product's object form has no definition using it.)
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum NameSpec {
    Text(String),
}

impl From<&str> for NameSpec {
    fn from(value: &str) -> Self {
        Self::Text(value.into())
    }
}

/// One configured or product candidate (`{ path, source, launcherPath, … }`).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct CandidateSpec {
    pub path: String,
    pub source: String,
    pub launcher_path: Option<String>,
    pub args_prefix: Option<Vec<String>>,
    pub environment_overrides: Option<Vec<(String, String)>>,
    pub identity_file_path: Option<String>,
    pub requires_manifest_identity: bool,
    pub identity_mismatch_as_not_found: bool,
}

impl CandidateSpec {
    pub fn new(path: impl Into<String>, source: &str) -> Self {
        Self {
            path: path.into(),
            source: source.into(),
            ..Default::default()
        }
    }
}

/// What `candidatePaths({ env, homedir, platform, registeredApplications })` reads.
pub struct CandidateContext<'a> {
    pub env: &'a EnvMap,
    pub homedir: &'a Path,
    pub platform: &'a str,
    pub registered_applications: &'a [RegisteredApplication],
}

impl CandidateContext<'_> {
    /// `env?.[key]` when set and non-empty.
    pub fn var(&self, key: &str) -> Option<&str> {
        self.env
            .get(key)
            .map(String::as_str)
            .filter(|v| !v.is_empty())
    }
}

/// `definition.candidatePaths`.
pub type CandidatePaths =
    Arc<dyn Fn(&CandidateContext<'_>) -> AgentResult<Vec<CandidateSpec>> + Send + Sync>;

/// `identityPolicy.manifest`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ManifestPolicy {
    pub parent_depth: usize,
    pub file_name: String,
    pub property: String,
    pub values: Vec<String>,
}

/// `identityPolicy`.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct IdentityPolicy {
    pub required_for_invocations: Vec<String>,
    pub package_names: Vec<String>,
    pub path_fragments: Vec<String>,
    pub file_markers: Vec<String>,
    pub manifest: Option<ManifestPolicy>,
}

/// A frozen installation definition.
#[derive(Clone)]
pub struct InstallationDefinition {
    pub id: String,
    pub display_name: String,
    pub executable_names: Vec<NameSpec>,
    pub registered_application_names: Option<Vec<String>>,
    /// `searchPath !== false`.
    pub search_path: bool,
    pub candidate_paths: Option<CandidatePaths>,
    pub identity_policy: Option<IdentityPolicy>,
}

fn strings(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| value.to_string()).collect()
}

impl InstallationDefinition {
    /// A definition with plain executable names; the remaining fields default.
    pub fn named(id: &str, display_name: &str, executable_names: &[&str]) -> Self {
        Self {
            id: id.into(),
            display_name: display_name.into(),
            executable_names: executable_names
                .iter()
                .map(|name| NameSpec::from(*name))
                .collect(),
            registered_application_names: None,
            search_path: true,
            candidate_paths: None,
            identity_policy: None,
        }
    }

    pub fn with_candidates(
        mut self,
        candidate_paths: impl Fn(&CandidateContext<'_>) -> AgentResult<Vec<CandidateSpec>>
        + Send
        + Sync
        + 'static,
    ) -> Self {
        self.candidate_paths = Some(Arc::new(candidate_paths));
        self
    }
}

impl IdentityPolicy {
    pub fn new(
        required_for_invocations: &[&str],
        package_names: &[&str],
        path_fragments: &[&str],
        file_markers: &[&str],
    ) -> Self {
        Self {
            required_for_invocations: strings(required_for_invocations),
            package_names: strings(package_names),
            path_fragments: strings(path_fragments),
            file_markers: strings(file_markers),
            manifest: None,
        }
    }
}

/// `defineLocalAgentInstallation(definition)`.
pub fn define_local_agent_installation(
    definition: InstallationDefinition,
) -> AgentResult<InstallationDefinition> {
    validate_definition(&definition)?;
    Ok(InstallationDefinition {
        display_name: definition.display_name.trim().to_string(),
        ..definition
    })
}

fn type_error(message: String) -> AgentError {
    AgentError::new(message).with_name("TypeError")
}

fn validate_definition(definition: &InstallationDefinition) -> AgentResult<()> {
    let id = &definition.id;
    if !LOCAL_AGENT_INSTALLATION_IDS.contains(&id.as_str()) {
        return Err(type_error(
            "Local Agent installation definition id is invalid.".into(),
        ));
    }
    if definition.display_name.trim().is_empty() {
        return Err(type_error(format!(
            "Local Agent {id} requires a display name."
        )));
    }
    if definition.executable_names.is_empty() || definition.executable_names.len() > 8 {
        return Err(type_error(format!(
            "Local Agent {id} requires executable names."
        )));
    }
    if let Some(names) = definition.registered_application_names.as_ref()
        && (names.is_empty()
            || names.len() > 8
            || names
                .iter()
                .any(|name| !REGISTERED_APPLICATION_NAME.is_match(name) || name.len() > 120))
    {
        return Err(type_error(format!(
            "Local Agent {id} registeredApplicationNames must contain safe Windows application names."
        )));
    }
    validate_identity_policy(definition)
}

fn validate_identity_policy(definition: &InstallationDefinition) -> AgentResult<()> {
    let id = &definition.id;
    let Some(policy) = definition.identity_policy.as_ref() else {
        return Ok(());
    };
    for (field, values) in [
        ("requiredForInvocations", &policy.required_for_invocations),
        ("packageNames", &policy.package_names),
        ("pathFragments", &policy.path_fragments),
        ("fileMarkers", &policy.file_markers),
    ] {
        if values.len() > 8
            || values
                .iter()
                .any(|value| value.is_empty() || value.len() > 160)
        {
            return Err(type_error(format!(
                "Local Agent {id} identityPolicy.{field} is invalid."
            )));
        }
    }
    if let Some(manifest) = policy.manifest.as_ref()
        && (manifest.parent_depth > 4
            || !MANIFEST_FILE.is_match(&manifest.file_name)
            || !MANIFEST_PROPERTY.is_match(&manifest.property)
            || manifest.values.is_empty()
            || manifest.values.len() > 8
            || manifest
                .values
                .iter()
                .any(|value| value.is_empty() || value.len() > 160))
    {
        return Err(type_error(format!(
            "Local Agent {id} identityPolicy.manifest is invalid."
        )));
    }
    let invocations: Vec<String> = definition
        .executable_names
        .iter()
        .map(|NameSpec::Text(text)| text.clone())
        .collect();
    if policy
        .required_for_invocations
        .iter()
        .any(|value| !invocations.contains(value))
    {
        return Err(type_error(format!(
            "Local Agent {id} identity policy references an unknown invocation."
        )));
    }
    Ok(())
}
