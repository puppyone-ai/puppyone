use super::*;
use serde_json::{Value, json};
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status {
    Found,
    NotFound,
    Failed,
}
impl Status {
    fn key(self) -> &'static str {
        match self {
            Self::Found => "found",
            Self::NotFound => "not-found",
            Self::Failed => "failed",
        }
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProductResult {
    pub(super) agent_id: String,
    pub(super) display_name: String,
    pub(super) status: Status,
    pub(super) reason_code: Option<String>,
    pub(super) source: Option<String>,
}
impl ProductResult {
    pub fn reason_code(&self) -> Option<&str> {
        self.reason_code.as_deref()
    }
    pub fn agent_id(&self) -> &str {
        &self.agent_id
    }
    pub fn display_name(&self) -> &str {
        &self.display_name
    }
    pub fn status(&self) -> Status {
        self.status
    }
    pub(super) fn from_observation(
        definition: &InstallationDefinition,
        observation: &Observation,
    ) -> Self {
        Self {
            agent_id: definition.id.clone(),
            display_name: definition.display_name.clone(),
            status: match observation {
                Observation::Found { .. } => Status::Found,
                Observation::NotFound { .. } => Status::NotFound,
                Observation::Failed { .. } => Status::Failed,
            },
            reason_code: observation.reason_code().and_then(safe_token),
            source: match observation {
                Observation::Found { candidate, .. } => safe_token(&candidate.source),
                _ => None,
            },
        }
    }
    pub fn to_value(&self) -> Value {
        let mut value = json!({"agentId": self.agent_id, "displayName": self.display_name, "status": self.status.key()});
        if let Some(code) = &self.reason_code {
            value["reasonCode"] = code.clone().into();
        }
        if let Some(source) = &self.source {
            value["source"] = source.clone().into();
        }
        value
    }
}
fn safe_token(value: &str) -> Option<String> {
    (!value.is_empty()
        && value.len() <= 80
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._:/-".contains(&b)))
    .then(|| value.to_owned())
}
#[derive(Clone, Debug)]
pub struct Progress {
    pub(super) scan_id: String,
    pub(super) generation: u64,
    pub(super) completed_agent_count: usize,
    pub(super) total_agent_count: usize,
    pub(super) candidates: HashMap<String, ResolvedCandidate>,
    pub(super) results: Vec<ProductResult>,
    pub(super) available_agent_ids: Vec<String>,
}
impl Progress {
    pub fn candidate(&self, id: &str) -> Option<&ResolvedCandidate> {
        self.candidates.get(id)
    }
    pub fn completed_agent_count(&self) -> usize {
        self.completed_agent_count
    }
    pub fn generation(&self) -> u64 {
        self.generation
    }
    pub fn results(&self) -> &[ProductResult] {
        &self.results
    }
    pub fn available_agent_ids(&self) -> &[String] {
        &self.available_agent_ids
    }
    pub fn to_value(&self) -> Value {
        json!({"scanId": self.scan_id, "generation": self.generation, "completedAgentCount": self.completed_agent_count,
            "totalAgentCount": self.total_agent_count, "results": self.results.iter().map(ProductResult::to_value).collect::<Vec<_>>(), "availableAgentIds": self.available_agent_ids})
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Source {
    Scan,
    MemoryCache,
}
#[derive(Clone, Debug)]
pub struct Snapshot {
    pub(super) generation: u64,
    pub(super) scan_id: String,
    pub(super) requested_at: String,
    pub(super) completed_at: String,
    pub(super) source: Source,
    pub(super) results: Vec<ProductResult>,
    pub(super) available_agent_ids: Vec<String>,
    pub(super) retained_agent_ids: Vec<String>,
    // Native host-owned launch evidence is never part of the public projection.
    pub(super) candidates: HashMap<String, ResolvedCandidate>,
}
impl Snapshot {
    pub fn generation(&self) -> u64 {
        self.generation
    }
    pub fn results(&self) -> &[ProductResult] {
        &self.results
    }
    pub fn available_agent_ids(&self) -> &[String] {
        &self.available_agent_ids
    }
    pub fn retained_agent_ids(&self) -> &[String] {
        &self.retained_agent_ids
    }
    pub fn source(&self) -> Source {
        self.source
    }
    pub fn candidate(&self, id: &str) -> Option<&ResolvedCandidate> {
        self.candidates.get(id)
    }
    pub fn to_value(&self) -> Value {
        json!({"schemaVersion": 1, "generation": self.generation, "scanId": self.scan_id,
            "requestedAt": self.requested_at, "completedAt": self.completed_at,
            "source": match self.source { Source::Scan => "scan", Source::MemoryCache => "memory-cache" },
            "results": self.results.iter().map(ProductResult::to_value).collect::<Vec<_>>(),
            "availableAgentIds": self.available_agent_ids, "retainedAgentIds": self.retained_agent_ids})
    }
}
#[derive(Clone, Debug, Default)]
pub struct Diagnostics {
    pub cache_hit_count: usize,
    pub catalog_size: usize,
    pub last_available_count: usize,
    pub last_scan_completed_at: Option<String>,
    pub last_scan_duration_ms: Option<f64>,
    pub queued_refresh_count: usize,
    pub scan_count: usize,
}

impl Snapshot {
    /// Validate before publishing evidence across the native host boundary.
    /// Private fields make snapshots immutable for callers; this also rejects
    /// inconsistent evidence from an injected registry or clock.
    pub(super) fn validate(&self) -> AgentResult<()> {
        let known = |id: &str| {
            DEFAULT_LOCAL_AGENT_INSTALLATION_REGISTRY
                .iter()
                .any(|d| d.id == id)
        };
        let invalid = || AgentError::new("Invalid Local Agent installation snapshot.");
        if self.generation == 0
            || self.generation > 9_007_199_254_740_991
            || self.scan_id.is_empty()
            || self.scan_id.len() > 96
            || !self
                .scan_id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b":_-".contains(&b))
            || crate::clock::date_parse(&self.requested_at).is_none()
            || crate::clock::date_parse(&self.completed_at).is_none()
            || self.results.len() > DEFAULT_LOCAL_AGENT_INSTALLATION_REGISTRY.len()
        {
            return Err(invalid());
        }
        let mut seen = HashSet::new();
        for result in &self.results {
            if !known(&result.agent_id)
                || !seen.insert(&result.agent_id)
                || result.display_name.trim().is_empty()
                || result.display_name.encode_utf16().count() > 80
            {
                return Err(invalid());
            }
        }
        if self.available_agent_ids != available(&self.results) {
            return Err(invalid());
        }
        let mut retained = HashSet::new();
        for id in &self.retained_agent_ids {
            if !retained.insert(id)
                || !self
                    .results
                    .iter()
                    .any(|r| &r.agent_id == id && r.status == Status::Failed)
            {
                return Err(invalid());
            }
        }
        Ok(())
    }
}
