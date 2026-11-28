//! App-wide Stale-While-Revalidate (SWR) cache for Projects Home folder
//! previews and connected Cloud Agents (`home-details.v1.json` and
//! `home-local-previews.v1.json`).
//!
//! Design invariants:
//! - **Instant first paint (SWR)**: persisted snapshots stand in immediately on
//!   cold start and across Space switches so folders never flash blank. Cold
//!   reads always reset `active = false` on cached Agents so a stale green dot
//!   never misrepresents live activity.
//! - **Account scope isolation**: Cloud snapshots are keyed by `[api, user]`,
//!   ignored offline, and deleted from disk on sign-out alongside
//!   `cloud-project-catalog.v1.json` and `cloud-spaces.v1.json`.
//! - **Conditional versioned revalidation + cooldown**: root file previews skip
//!   `/content/{id}/ls` while the project's `modified` timestamp from
//!   `CloudCatalog` is unchanged within the preview freshness window; connected
//!   Agents respect a cooldown so repeated window focus changes never hammer
//!   the backend.
//! - **In-flight deduplication**: overlapping refreshes never fire duplicate
//!   requests for the same project id, and partial network failures preserve
//!   last-known cached data.
//! - **Write-through**: opening a Cloud project updates this cache directly
//!   from the Explorer root listing and `CloudAgents` roster with zero extra
//!   HTTP calls upon returning Home.
use gpui::*;
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

/// Previews stay fresh for 10 minutes while `CloudCatalog`'s `modified`
/// timestamp for the project has not changed.
pub const PREVIEW_STALE_MS: i64 = 10 * 60 * 1000;
/// Explicit window focus still skips unchanged previews for 2 minutes.
pub const PREVIEW_FOCUS_STALE_MS: i64 = 2 * 60 * 1000;
/// Connected Cloud Agents stay fresh for 45 seconds during Home navigation /
/// Space switches.
pub const AGENTS_STALE_MS: i64 = 45 * 1000;
/// Explicit window focus respects a 30-second cooldown on Agent queries so
/// rapid Cmd-Tabbing never triggers redundant DB queries.
pub const AGENTS_FOCUS_STALE_MS: i64 = 30 * 1000;
/// Error backoff (e.g. 403 viewer project or transient timeout): preserve
/// last-known cached data and avoid hammering failing endpoints on every focus.
pub const ERROR_BACKOFF_MS: i64 = 30 * 1000;
/// Bounded worker concurrency for Home detail revalidation (matches
/// `CloudCatalog::ACTIVITY_CONCURRENCY`).
pub const DETAILS_CONCURRENCY: usize = 4;

const CLOUD_FILE: &str = "home-details.v1.json";
const LOCAL_FILE: &str = "home-local-previews.v1.json";
const MAX_CACHE_BYTES: usize = 1024 * 1024;
const CACHE_VERSION: u32 = 1;

/// One top-level file preview stored for a project folder (up to 3 per folder).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CachedFilePreview {
    pub name: String,
    /// `"html" | "md" | "csv" | "other"`.
    pub kind: String,
}

/// One Cloud Agent connected to a Cloud project.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CachedProjectAgent {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub avatar: Option<String>,
    /// Live working state: intentionally skipped from disk serialization so
    /// cold hydration never displays a stale green "active now" indicator.
    #[serde(skip)]
    pub active: bool,
    #[serde(default)]
    pub last_active_at: Option<String>,
}

/// Cached root previews and connected Agents for one Cloud project.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct CachedCloudProjectDetails {
    #[serde(default)]
    pub previews: Vec<CachedFilePreview>,
    #[serde(default)]
    pub previews_modified: Option<i64>,
    #[serde(default)]
    pub previews_fetched_ms: i64,
    #[serde(skip)]
    pub previews_error_ms: i64,
    #[serde(default)]
    pub agents: Vec<CachedProjectAgent>,
    #[serde(default)]
    pub agents_fetched_ms: i64,
    #[serde(skip)]
    pub agents_error_ms: i64,
}

/// Which network queries a single Cloud project actually needs right now.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ProjectFetchPlan {
    pub fetch_previews: bool,
    pub fetch_agents: bool,
}

impl ProjectFetchPlan {
    pub fn any(self) -> bool {
        self.fetch_previews || self.fetch_agents
    }
}

/// Pure freshness decision for one Cloud project: version-keyed on
/// `catalog_modified` for previews and cooldown-gated for both previews and
/// connected Agents.
pub fn fetch_plan(
    cached: Option<&CachedCloudProjectDetails>,
    catalog_modified: Option<i64>,
    now_ms: i64,
    on_focus: bool,
) -> ProjectFetchPlan {
    let preview_ttl = if on_focus {
        PREVIEW_FOCUS_STALE_MS
    } else {
        PREVIEW_STALE_MS
    };
    let agents_ttl = if on_focus {
        AGENTS_FOCUS_STALE_MS
    } else {
        AGENTS_STALE_MS
    };
    let Some(entry) = cached else {
        return ProjectFetchPlan {
            fetch_previews: true,
            fetch_agents: true,
        };
    };
    let previews_backed_off = entry.previews_error_ms > 0
        && now_ms.saturating_sub(entry.previews_error_ms) < ERROR_BACKOFF_MS;
    let previews_age = now_ms.saturating_sub(entry.previews_fetched_ms);
    let fetch_previews = !previews_backed_off
        && (entry.previews_fetched_ms <= 0
            || entry.previews_modified != catalog_modified
            || previews_age >= preview_ttl);
    let agents_backed_off = entry.agents_error_ms > 0
        && now_ms.saturating_sub(entry.agents_error_ms) < ERROR_BACKOFF_MS;
    let agents_age = now_ms.saturating_sub(entry.agents_fetched_ms);
    let fetch_agents =
        !agents_backed_off && (entry.agents_fetched_ms <= 0 || agents_age >= agents_ttl);
    ProjectFetchPlan {
        fetch_previews,
        fetch_agents,
    }
}

pub fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[derive(Serialize, Deserialize)]
struct CloudDiskSnapshot {
    version: u32,
    scope: String,
    projects: HashMap<String, CachedCloudProjectDetails>,
}

#[derive(Serialize, Deserialize)]
struct LocalDiskSnapshot {
    version: u32,
    previews: HashMap<String, Vec<CachedFilePreview>>,
}

mod disk {
    use super::*;

    fn write_atomic(path: &Path, bytes: &[u8]) {
        let _ = crate::platform::ui_state_store::write_bytes(path, bytes);
    }

    pub fn read_cloud(
        dir: &Path,
        scope: &str,
    ) -> Option<HashMap<String, CachedCloudProjectDetails>> {
        let bytes = std::fs::read(dir.join(CLOUD_FILE)).ok()?;
        if bytes.len() > MAX_CACHE_BYTES {
            return None;
        }
        let snap: CloudDiskSnapshot = serde_json::from_slice(&bytes).ok()?;
        (snap.version == CACHE_VERSION && snap.scope == scope).then_some(snap.projects)
    }

    pub fn write_cloud(
        dir: &Path,
        scope: &str,
        projects: &HashMap<String, CachedCloudProjectDetails>,
    ) {
        let snap = CloudDiskSnapshot {
            version: CACHE_VERSION,
            scope: scope.to_owned(),
            projects: projects.clone(),
        };
        if let Ok(bytes) = serde_json::to_vec(&snap) {
            write_atomic(&dir.join(CLOUD_FILE), &bytes);
        }
    }

    pub fn clear_cloud(dir: &Path) {
        let _ = std::fs::remove_file(dir.join(CLOUD_FILE));
    }

    pub fn read_local(dir: &Path) -> HashMap<PathBuf, Vec<CachedFilePreview>> {
        let Some(bytes) = std::fs::read(dir.join(LOCAL_FILE))
            .ok()
            .filter(|b| b.len() <= MAX_CACHE_BYTES)
        else {
            return HashMap::new();
        };
        let Ok(snap) = serde_json::from_slice::<LocalDiskSnapshot>(&bytes) else {
            return HashMap::new();
        };
        if snap.version != CACHE_VERSION {
            return HashMap::new();
        }
        snap.previews
            .into_iter()
            .map(|(k, v)| (PathBuf::from(k), v))
            .collect()
    }

    pub fn write_local(dir: &Path, previews: &HashMap<PathBuf, Vec<CachedFilePreview>>) {
        let map: HashMap<String, Vec<CachedFilePreview>> = previews
            .iter()
            .filter_map(|(path, items)| Some((path.to_str()?.to_owned(), items.clone())))
            .collect();
        let snap = LocalDiskSnapshot {
            version: CACHE_VERSION,
            previews: map,
        };
        if let Ok(bytes) = serde_json::to_vec(&snap) {
            write_atomic(&dir.join(LOCAL_FILE), &bytes);
        }
    }
}

/// Clears the Cloud Home details disk cache on sign-out (called alongside
/// `CloudCatalog` sign-out cleanup).
pub fn clear_disk_cache(cloud_dir: &Path) {
    disk::clear_cloud(cloud_dir);
}

/// Shared app-wide SWR cache for Homepage Cloud previews, Cloud Agents, and
/// local folder previews.
pub struct HomeDetailsCache {
    scope: Option<String>,
    epoch: u64,
    projects: HashMap<String, CachedCloudProjectDetails>,
    in_flight: HashSet<String>,
    local_previews: HashMap<PathBuf, Vec<CachedFilePreview>>,
    local_loaded: bool,
    /// `<data_dir>/cloud`; `None` in tests unless explicitly injected.
    pub cloud_cache_dir: Option<PathBuf>,
    /// `<data_dir>`; `None` in tests unless explicitly injected.
    pub local_cache_dir: Option<PathBuf>,
}

struct Service(Entity<HomeDetailsCache>);
impl Global for Service {}

pub fn global_home_details(cx: &mut App) -> Entity<HomeDetailsCache> {
    if let Some(service) = cx.try_global::<Service>() {
        return service.0.clone();
    }
    let cache = cx.new(|_| HomeDetailsCache::new_default());
    cx.set_global(Service(cache.clone()));
    cache
}

pub fn read_home_details(cx: &App) -> Option<&HomeDetailsCache> {
    cx.try_global::<Service>().map(|s| s.0.read(cx))
}

impl HomeDetailsCache {
    pub fn new_default() -> Self {
        let data = (!cfg!(test)).then(crate::platform::data_dir);
        let mut cache = Self {
            scope: None,
            epoch: 0,
            projects: HashMap::new(),
            in_flight: HashSet::new(),
            local_previews: HashMap::new(),
            local_loaded: false,
            cloud_cache_dir: data.as_ref().map(|d| d.join("cloud")),
            local_cache_dir: data,
        };
        cache.ensure_local_loaded();
        cache
    }

    /// Account scope string matching `[api, user]`.
    pub fn scope_key(api: &str, user: &str) -> String {
        format!("{api}:{user}")
    }

    pub fn current_scope(cx: &App) -> Option<String> {
        let (_, binding) = crate::features::cloud::account::broker_and_binding(cx)?;
        Some(Self::scope_key(binding.environment.api(), &binding.user))
    }

    pub fn epoch(&self) -> u64 {
        self.epoch
    }

    pub fn projects(&self) -> &HashMap<String, CachedCloudProjectDetails> {
        &self.projects
    }

    pub fn local_previews(&self) -> &HashMap<PathBuf, Vec<CachedFilePreview>> {
        &self.local_previews
    }

    /// Hydrates local folder previews from disk once on startup.
    pub fn ensure_local_loaded(&mut self) {
        if self.local_loaded {
            return;
        }
        self.local_loaded = true;
        if let Some(dir) = &self.local_cache_dir {
            self.local_previews = disk::read_local(dir);
        }
    }

    /// Persists fresh local folder previews whenever they actually changed.
    pub fn record_local_previews(
        &mut self,
        previews: HashMap<PathBuf, Vec<CachedFilePreview>>,
        cx: &mut Context<Self>,
    ) {
        self.ensure_local_loaded();
        if self.local_previews == previews {
            return;
        }
        self.local_previews = previews;
        if let Some(dir) = &self.local_cache_dir {
            disk::write_local(dir, &self.local_previews);
        }
        cx.notify();
    }

    /// Synchronizes the cache to the current signed-in account scope.
    /// Hydrates immediately from disk on scope entry (unless offline), and
    /// clears both memory and disk on explicit sign-out.
    pub fn ensure_scope(
        &mut self,
        scope: Option<&str>,
        signed_out: bool,
        offline: bool,
        cx: &mut Context<Self>,
    ) {
        let Some(scope) = scope else {
            if signed_out && let Some(dir) = &self.cloud_cache_dir {
                disk::clear_cloud(dir);
            }
            if self.scope.is_some() || !self.projects.is_empty() || !self.in_flight.is_empty() {
                self.scope = None;
                self.epoch += 1;
                self.projects.clear();
                self.in_flight.clear();
                cx.notify();
            }
            return;
        };
        if self.scope.as_deref() == Some(scope) {
            return;
        }
        self.scope = Some(scope.to_owned());
        self.epoch += 1;
        self.in_flight.clear();
        self.projects = if offline {
            HashMap::new()
        } else {
            self.cloud_cache_dir
                .as_deref()
                .and_then(|dir| disk::read_cloud(dir, scope))
                .unwrap_or_default()
        };
        cx.notify();
    }

    /// Removes cached projects that no longer exist in a fresh `CloudCatalog`.
    pub fn prune_to_catalog(&mut self, known_ids: &HashSet<&str>, cx: &mut Context<Self>) {
        let before = self.projects.len();
        self.projects
            .retain(|id, _| known_ids.contains(id.as_str()));
        if self.projects.len() != before {
            self.persist_cloud();
            cx.notify();
        }
    }

    /// Evaluates freshness for `targets` (typically only the currently visible
    /// Space's projects), skips any already in flight, marks stale targets as
    /// in flight, and returns the exact fetch plans to run.
    pub fn plan_and_claim(
        &mut self,
        targets: &[(String, Option<i64>)],
        now_ms: i64,
        on_focus: bool,
    ) -> Vec<(String, Option<i64>, ProjectFetchPlan)> {
        let mut work = Vec::new();
        for (id, modified) in targets {
            if self.in_flight.contains(id) {
                continue;
            }
            let plan = fetch_plan(self.projects.get(id), *modified, now_ms, on_focus);
            if plan.any() {
                self.in_flight.insert(id.clone());
                work.push((id.clone(), *modified, plan));
            }
        }
        work
    }

    /// Merges one completed background fetch back into the cache without
    /// wiping cached fields when a network sub-call transiently failed; failed
    /// sub-calls record a backoff timestamp so focus switches never spam them.
    #[allow(clippy::too_many_arguments)]
    pub fn finish_fetch(
        &mut self,
        epoch: u64,
        project_id: &str,
        plan: ProjectFetchPlan,
        previews: Option<(Vec<CachedFilePreview>, Option<i64>)>,
        agents: Option<Vec<CachedProjectAgent>>,
        now_ms: i64,
        cx: &mut Context<Self>,
    ) {
        self.in_flight.remove(project_id);
        if epoch != self.epoch {
            return;
        }
        let mut changed = false;
        let mut updated = false;
        let entry = self.projects.entry(project_id.to_owned()).or_default();
        if plan.fetch_previews {
            if let Some((next_previews, modified)) = previews {
                if entry.previews != next_previews || entry.previews_modified != modified {
                    entry.previews = next_previews;
                    entry.previews_modified = modified;
                    changed = true;
                }
                entry.previews_fetched_ms = now_ms;
                entry.previews_error_ms = 0;
                updated = true;
            } else {
                entry.previews_error_ms = now_ms;
            }
        }
        if plan.fetch_agents {
            if let Some(next_agents) = agents {
                if entry.agents != next_agents {
                    entry.agents = next_agents;
                    changed = true;
                }
                entry.agents_fetched_ms = now_ms;
                entry.agents_error_ms = 0;
                updated = true;
            } else {
                entry.agents_error_ms = now_ms;
            }
        }
        if updated {
            self.persist_cloud();
        }
        if changed {
            cx.notify();
        }
    }

    /// Write-through from an open Cloud project's Explorer root listing:
    /// updates the cached folder previews immediately with zero extra HTTP calls.
    pub fn record_cloud_previews(
        &mut self,
        scope: &str,
        project_id: &str,
        previews: Vec<CachedFilePreview>,
        modified: Option<i64>,
        cx: &mut Context<Self>,
    ) {
        if self.scope.as_deref() != Some(scope) {
            self.ensure_scope(Some(scope), false, false, cx);
        }
        let now_ms = now_millis();
        let entry = self.projects.entry(project_id.to_owned()).or_default();
        let changed = entry.previews != previews
            || (modified.is_some() && entry.previews_modified != modified);
        entry.previews = previews;
        if modified.is_some() {
            entry.previews_modified = modified;
        }
        entry.previews_fetched_ms = now_ms;
        self.persist_cloud();
        if changed {
            cx.notify();
        }
    }

    /// Write-through from an open Cloud project's live `CloudAgents` roster:
    /// inviting, approving, or removing an Agent updates Home immediately.
    pub fn record_cloud_agents(
        &mut self,
        scope: &str,
        project_id: &str,
        agents: Vec<CachedProjectAgent>,
        cx: &mut Context<Self>,
    ) {
        if self.scope.as_deref() != Some(scope) {
            self.ensure_scope(Some(scope), false, false, cx);
        }
        let now_ms = now_millis();
        let entry = self.projects.entry(project_id.to_owned()).or_default();
        let changed = entry.agents != agents;
        entry.agents = agents;
        entry.agents_fetched_ms = now_ms;
        self.persist_cloud();
        if changed {
            cx.notify();
        }
    }

    fn persist_cloud(&self) {
        if let (Some(dir), Some(scope)) = (&self.cloud_cache_dir, &self.scope) {
            disk::write_cloud(dir, scope, &self.projects);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn fetch_plan_skips_unchanged_previews_and_respects_focus_cooldown() {
        let base = 1_700_000_000_000i64;
        let cached = CachedCloudProjectDetails {
            previews: vec![CachedFilePreview {
                name: "README.md".into(),
                kind: "md".into(),
            }],
            previews_modified: Some(12345),
            previews_fetched_ms: base,
            agents: vec![],
            agents_fetched_ms: base,
            ..Default::default()
        };

        // 10 s later, unchanged modified, normal navigation or focus: skip BOTH.
        let p = fetch_plan(Some(&cached), Some(12345), base + 10_000, false);
        assert!(!p.fetch_previews && !p.fetch_agents);
        let p_focus = fetch_plan(Some(&cached), Some(12345), base + 10_000, true);
        assert!(!p_focus.fetch_previews && !p_focus.fetch_agents);

        // 35 s later on focus: revalidate Agents (> 30s), still skip unchanged previews (< 2m).
        let p_focus_agents = fetch_plan(Some(&cached), Some(12345), base + 35_000, true);
        assert!(!p_focus_agents.fetch_previews && p_focus_agents.fetch_agents);

        // 10 s later when catalog `modified` advanced: immediately revalidate previews, skip agents.
        let p_changed = fetch_plan(Some(&cached), Some(99999), base + 10_000, false);
        assert!(p_changed.fetch_previews && !p_changed.fetch_agents);

        // 11 minutes later: both stale even when modified unchanged.
        let p_expired = fetch_plan(Some(&cached), Some(12345), base + 11 * 60 * 1000, false);
        assert!(p_expired.fetch_previews && p_expired.fetch_agents);

        // Error backoff suppresses immediate retries on 403 / transient failures.
        let errored = CachedCloudProjectDetails {
            agents_error_ms: base,
            previews_error_ms: base,
            ..Default::default()
        };
        let p_backed_off = fetch_plan(Some(&errored), Some(12345), base + 10_000, true);
        assert!(!p_backed_off.fetch_previews && !p_backed_off.fetch_agents);
        let p_retry = fetch_plan(
            Some(&errored),
            Some(12345),
            base + ERROR_BACKOFF_MS + 1,
            true,
        );
        assert!(p_retry.fetch_previews && p_retry.fetch_agents);
    }

    #[test]
    fn disk_roundtrip_is_account_scoped_and_clears_stale_active_flag() {
        let dir = tempfile::tempdir().unwrap();
        let mut projects = HashMap::new();
        projects.insert(
            "p-1".into(),
            CachedCloudProjectDetails {
                previews: vec![CachedFilePreview {
                    name: "index.html".into(),
                    kind: "html".into(),
                }],
                previews_modified: Some(500),
                previews_fetched_ms: 1000,
                agents: vec![CachedProjectAgent {
                    id: "a-1".into(),
                    name: "Grok Bot".into(),
                    avatar: None,
                    active: true,
                    last_active_at: Some("2026-11-26T10:00:00Z".into()),
                }],
                agents_fetched_ms: 1000,
                ..Default::default()
            },
        );
        disk::write_cloud(dir.path(), "https://api.a:user-1", &projects);

        // Wrong account cannot read another account's cached details.
        assert!(disk::read_cloud(dir.path(), "https://api.a:user-2").is_none());

        // Same account hydrates previews & agents immediately, with `active` reset to false.
        let restored = disk::read_cloud(dir.path(), "https://api.a:user-1").unwrap();
        let p1 = &restored["p-1"];
        assert_eq!(p1.previews.len(), 1);
        assert_eq!(p1.agents.len(), 1);
        assert_eq!(p1.agents[0].name, "Grok Bot");
        assert!(
            !p1.agents[0].active,
            "cold disk read must never fake a stale live active dot"
        );

        // Sign-out clears the disk file.
        clear_disk_cache(dir.path());
        assert!(disk::read_cloud(dir.path(), "https://api.a:user-1").is_none());
    }
}
