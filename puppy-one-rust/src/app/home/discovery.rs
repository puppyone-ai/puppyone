//! Background discovery and caching for Projects Home (`useHomepageAgents`,
//! `useHomepageCloudAgents`, and `useProjectPreviews`):
//! - Local Agent CLI inventory + Hook enrollment (`HomepageLocalAgent`),
//! - Personal-space Cloud Agents (`HomepageCloudAgent`) and per-project badges,
//! - Top-level HTML/MD/CSV asset previews for local and Cloud folders.
use super::{
    Homepage, display::modification_time, folder::FolderAgentBadge, previews::ProjectAssetPreview,
};
use crate::{
    agent::connections::legacy_local_agent_inventory::Installation,
    features::local_agents::{LOCAL_AGENT_CHAT_RECIPES, local_agent_id_for_agent_chat_runtime},
    platform::agent_activity::{host::Host, registration::Enrollment},
    workspace::cloud::catalog::Item,
};
use gpui::{App, Context};
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

/// An Agent on this computer that can be asked to start a project
/// (`useHomepageAgents.HomepageLocalAgent`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub(in crate::app) struct HomepageLocalAgent {
    pub runtime_id: String,
    pub label: String,
    pub icon_key: String,
    pub connected: bool,
}

/// An Agent that can reach the person's personal-space Cloud projects
/// (`useHomepageCloudAgents.HomepageCloudAgent`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub(in crate::app) struct HomepageCloudAgent {
    pub id: String,
    pub name: String,
    pub avatar: Option<String>,
    pub last_active_at: Option<String>,
}

/// Projects Home's non-blocking preview and Agent discovery state.
#[derive(Default)]
pub(in crate::app) struct HomeDiscovery {
    /// Top-level HTML/MD/CSV asset previews read from each local folder.
    pub local_previews: HashMap<PathBuf, Vec<ProjectAssetPreview>>,
    /// Top-level HTML/MD/CSV asset previews read from each Cloud project.
    pub cloud_previews: HashMap<String, Vec<ProjectAssetPreview>>,
    /// Detected local Agent CLIs and their Hook enrollment.
    pub discovered_local_agents: Option<(Vec<Installation>, HashSet<String>)>,
    /// Test override for `visible_local_agents`.
    pub local_agents_override: Option<Vec<HomepageLocalAgent>>,
    pub scanning_local_agents: bool,
    pub local_agents_generation: u64,
    /// Connected Cloud Agents across the personal Space's projects.
    pub cloud_agents: Vec<HomepageCloudAgent>,
    /// Connected Cloud Agents per Cloud project id.
    pub cloud_project_agents: HashMap<String, Vec<FolderAgentBadge>>,
    /// Keeps test-injected Cloud previews and Agent badges from being cleared.
    pub cloud_details_override: bool,
}

/// Filters and orders detected installations by `LOCAL_AGENT_CHAT_RECIPES`,
/// omitting hidden Agents and the bundled Built-in Agent (`useHomepageLocalAgents`).
pub(in crate::app::home) fn resolve_local_agents(
    installations: &[Installation],
    enrolled_provider_ids: &HashSet<String>,
    hidden_agent_ids: &[String],
) -> Vec<HomepageLocalAgent> {
    let found_ids: HashSet<&str> = installations
        .iter()
        .filter(|inst| !inst.bundled() && !hidden_agent_ids.iter().any(|h| h == inst.id))
        .map(|inst| inst.id)
        .collect();
    LOCAL_AGENT_CHAT_RECIPES
        .iter()
        .filter(|recipe| found_ids.contains(local_agent_id_for_agent_chat_runtime(recipe.id)))
        .map(|recipe| {
            let provider_id = local_agent_id_for_agent_chat_runtime(recipe.id);
            HomepageLocalAgent {
                runtime_id: recipe.id.to_owned(),
                label: recipe.label.to_owned(),
                icon_key: recipe.icon_key.to_owned(),
                connected: enrolled_provider_ids.contains(provider_id),
            }
        })
        .collect()
}

pub(in crate::app::home) fn newer_iso_timestamp(
    left: Option<&str>,
    right: Option<&str>,
) -> Option<String> {
    match (left, right) {
        (None, r) => r.map(str::to_owned),
        (l, None) => l.map(str::to_owned),
        (Some(l), Some(r)) => {
            let left_ms = chrono::DateTime::parse_from_rfc3339(l)
                .ok()
                .map(|dt| dt.timestamp_millis());
            let right_ms = chrono::DateTime::parse_from_rfc3339(r)
                .ok()
                .map(|dt| dt.timestamp_millis());
            match (left_ms, right_ms) {
                (None, _) => Some(r.to_owned()),
                (_, None) => Some(l.to_owned()),
                (Some(lm), Some(rm)) if rm > lm => Some(r.to_owned()),
                _ => Some(l.to_owned()),
            }
        }
    }
}

pub(in crate::app::home) fn format_cloud_agent_activity(
    value: Option<&str>,
    now: SystemTime,
) -> Option<String> {
    let ms = chrono::DateTime::parse_from_rfc3339(value?)
        .ok()?
        .timestamp_millis();
    if ms < 0 {
        return None;
    }
    let at = UNIX_EPOCH + Duration::from_millis(ms as u64);
    Some(modification_time(at, now))
}

impl Homepage {
    /// `shell-home-projects` (`app/dev/home_lab.rs`): Local Agents to start
    /// with (their menu open with `agents`), and the personal space's Cloud
    /// Agents and root files.
    #[cfg(feature = "dev-capture")]
    pub(in crate::app) fn lab_projects(&mut self, agents: bool) {
        if agents {
            self.menu = Some(super::HomeMenu::NewProject);
        }
        use super::previews::PreviewKind;
        let local = |runtime_id: &str, label: &str, icon_key: &str, connected| HomepageLocalAgent {
            runtime_id: runtime_id.into(),
            label: label.into(),
            icon_key: icon_key.into(),
            connected,
        };
        self.discovery.local_agents_override = Some(vec![
            local("claude", "Claude Code", "claude", true),
            local("codex", "Codex", "codex", false),
            local("cursor", "Cursor", "cursor", false),
        ]);
        let agents = [
            ("a-codex", "Codex"),
            ("a-puppy", "Puppy"),
            ("a-scout", "Scout"),
        ];
        self.discovery.cloud_agents = agents
            .iter()
            .map(|(id, name)| HomepageCloudAgent {
                id: (*id).into(),
                name: (*name).into(),
                avatar: None,
                last_active_at: Some("2026-11-14T08:00:00Z".into()),
            })
            .collect();
        self.discovery.cloud_project_agents.insert(
            "p-issues".into(),
            agents
                .iter()
                .enumerate()
                .map(|(i, (id, name))| FolderAgentBadge {
                    id: (*id).into(),
                    name: (*name).into(),
                    avatar: None,
                    active: i == 0,
                })
                .collect(),
        );
        let previews = |files: &[(&str, PreviewKind)]| {
            files
                .iter()
                .map(|(name, kind)| ProjectAssetPreview {
                    name: (*name).into(),
                    kind: *kind,
                })
                .collect::<Vec<_>>()
        };
        self.discovery.cloud_previews.insert(
            "p-issues".into(),
            previews(&[
                ("board.html", PreviewKind::Html),
                ("README.md", PreviewKind::Md),
            ]),
        );
        self.discovery.cloud_previews.insert(
            "p-todo".into(),
            previews(&[
                ("today.md", PreviewKind::Md),
                ("week.md", PreviewKind::Md),
                ("tasks.csv", PreviewKind::Csv),
            ]),
        );
        self.discovery.cloud_previews.insert(
            "p-brand".into(),
            previews(&[("palette.md", PreviewKind::Md)]),
        );
        self.discovery.cloud_details_override = true;
    }

    /// Visible local Agents for the strip: test override when set, else the
    /// background discovery snapshot filtered by current preferences.
    pub(in crate::app) fn visible_local_agents(&self, cx: &App) -> Vec<HomepageLocalAgent> {
        let hidden = &self
            .preferences
            .read(cx)
            .state
            .local_agents
            .hidden_agent_ids;
        if let Some(override_list) = &self.discovery.local_agents_override {
            return override_list
                .iter()
                .filter(|agent| {
                    let provider_id = local_agent_id_for_agent_chat_runtime(&agent.runtime_id);
                    !hidden.iter().any(|h| h == provider_id)
                })
                .cloned()
                .collect();
        }
        let Some((installations, enrolled)) = &self.discovery.discovered_local_agents else {
            return Vec::new();
        };
        resolve_local_agents(installations, enrolled, hidden)
    }

    pub(in crate::app::home) fn item_previews<'a>(
        &'a self,
        item: &Item,
    ) -> &'a [ProjectAssetPreview] {
        if let Some(path) = &item.local_path {
            return self
                .discovery
                .local_previews
                .get(Path::new(path))
                .map_or(&[], Vec::as_slice);
        }
        if let Some(id) = &item.cloud_project {
            return self
                .discovery
                .cloud_previews
                .get(id)
                .map_or(&[], Vec::as_slice);
        }
        &[]
    }

    pub(in crate::app::home) fn item_cloud_agents<'a>(
        &'a self,
        item: &Item,
    ) -> &'a [FolderAgentBadge] {
        if item.local_path.is_none()
            && let Some(id) = &item.cloud_project
        {
            return self
                .discovery
                .cloud_project_agents
                .get(id)
                .map_or(&[], Vec::as_slice);
        }
        &[]
    }

    /// Read the application-session installation evidence. Focus refreshes Hook
    /// enrollment only; it never expires or repeats CLI discovery.
    pub(in crate::app) fn refresh_local_agents(&mut self, force: bool, cx: &mut Context<Self>) {
        if self.discovery.local_agents_override.is_some() {
            return;
        }
        if !self.session.home || !self.has_projects(cx) {
            return;
        }
        self.sync_local_agent_installations(cx);
        let shared = crate::features::local_agents::installation_store(cx);
        if self.discovery.scanning_local_agents
            || (!force && self.discovery.local_agents_generation > 0)
        {
            return;
        }
        self.discovery.scanning_local_agents = true;
        self.discovery.local_agents_generation += 1;
        let generation = self.discovery.local_agents_generation;
        let task = cx.background_executor().spawn(async move {
            Host::global()
                .enrollment()
                .into_iter()
                .filter(|p| p.enrollment == Enrollment::Enabled)
                .map(|p| p.provider_id.to_owned())
                .collect::<HashSet<String>>()
        });
        cx.spawn(async move |this, cx| {
            let found = task.await;
            let _ = this.update(cx, |s, cx| {
                if s.discovery.local_agents_generation == generation {
                    s.discovery.scanning_local_agents = false;
                    let installations = shared.read(cx).inventory().installations;
                    s.discovery.discovered_local_agents = Some((installations, found));
                    cx.notify();
                }
            });
        })
        .detach();
    }

    pub(in crate::app) fn sync_local_agent_installations(&mut self, cx: &mut Context<Self>) {
        if self.discovery.local_agents_override.is_some() {
            return;
        }
        let shared = crate::features::local_agents::installation_store(cx);
        let installations = shared.read(cx).inventory().installations;
        let enrolled = self
            .discovery
            .discovered_local_agents
            .as_ref()
            .map(|(_, ids)| ids.clone())
            .unwrap_or_default();
        self.discovery.discovered_local_agents = Some((installations, enrolled));
        cx.notify();
    }

    /// Hydrates cached Cloud folder previews & connected Agent badges into
    /// `self.discovery` synchronously from the shared app-wide SWR cache.
    pub(in crate::app) fn sync_cloud_details_from_cache(&mut self, cx: &mut Context<Self>) {
        if self.discovery.cloud_details_override {
            return;
        }
        let Some(cache) = crate::features::cloud::read_home_details(cx) else {
            return;
        };
        let personal_space = self
            .spaces
            .read(cx)
            .spaces()
            .iter()
            .find(|space| space.is_default)
            .map(|space| space.id.clone());
        let personal_ids: HashSet<String> = self
            .project_items(cx)
            .into_iter()
            .filter(|item| {
                item.local_path.is_none()
                    && personal_space.is_some()
                    && item.cloud_organization == personal_space
            })
            .filter_map(|item| item.cloud_project)
            .collect();

        let mut next_previews: HashMap<String, Vec<ProjectAssetPreview>> = HashMap::new();
        let mut next_project_agents: HashMap<String, Vec<FolderAgentBadge>> = HashMap::new();
        let mut dedup_order: Vec<String> = Vec::new();
        let mut dedup: HashMap<String, HomepageCloudAgent> = HashMap::new();

        // Iterate in deterministic project order so `cloud_agents` ordering never jitters.
        let mut project_ids: Vec<&String> = cache.projects().keys().collect();
        project_ids.sort();
        for project_id in project_ids {
            let details = &cache.projects()[project_id];
            if !details.previews.is_empty() {
                next_previews.insert(
                    project_id.clone(),
                    super::previews::from_cached(&details.previews),
                );
            }
            if !details.agents.is_empty() {
                let is_personal = personal_ids.contains(project_id);
                let mut badges = Vec::with_capacity(details.agents.len());
                for agent in &details.agents {
                    badges.push(FolderAgentBadge {
                        id: agent.id.clone(),
                        name: agent.name.clone(),
                        avatar: agent.avatar.clone(),
                        active: agent.active,
                    });
                    if is_personal {
                        let key =
                            format!("{}\0{}", agent.name, agent.avatar.as_deref().unwrap_or(""));
                        if let Some(existing) = dedup.get_mut(&key) {
                            existing.last_active_at = newer_iso_timestamp(
                                existing.last_active_at.as_deref(),
                                agent.last_active_at.as_deref(),
                            );
                        } else {
                            dedup_order.push(key.clone());
                            dedup.insert(
                                key,
                                HomepageCloudAgent {
                                    id: agent.id.clone(),
                                    name: agent.name.clone(),
                                    avatar: agent.avatar.clone(),
                                    last_active_at: agent.last_active_at.clone(),
                                },
                            );
                        }
                    }
                }
                next_project_agents.insert(project_id.clone(), badges);
            }
        }
        let next_cloud_agents: Vec<HomepageCloudAgent> = dedup_order
            .into_iter()
            .filter_map(|k| dedup.remove(&k))
            .collect();

        let changed = self.discovery.cloud_previews != next_previews
            || self.discovery.cloud_project_agents != next_project_agents
            || self.discovery.cloud_agents != next_cloud_agents;
        if changed {
            self.discovery.cloud_previews = next_previews;
            self.discovery.cloud_project_agents = next_project_agents;
            self.discovery.cloud_agents = next_cloud_agents;
            cx.notify();
        }
    }

    /// Selects only the Cloud projects currently visible on Home so inactive
    /// Spaces in Arc/Tabs mode incur zero network traffic until visited.
    fn visible_cloud_targets(&self, cx: &App) -> Vec<(String, Option<i64>)> {
        use crate::features::settings::HomeSpaceLayout;
        let items = self.project_items(cx);
        let mode = self
            .preferences
            .read(cx)
            .state
            .experimental
            .home_space_layout;
        let mut seen = HashSet::new();
        let mut out = Vec::new();
        let mut push_item = |item: &Item| {
            if item.local_path.is_none()
                && let Some(id) = &item.cloud_project
                && seen.insert(id.clone())
            {
                out.push((id.clone(), item.modified));
            }
        };
        if mode != HomeSpaceLayout::Classic {
            let groups = self.project_groups_now(self.visible_projects(cx), cx);
            let active = self.resolve_active_group(&groups);
            if let Some(active_id) = active
                && let Some(group) = groups.iter().find(|g| g.id == active_id)
            {
                for item in &group.items {
                    push_item(item);
                }
            }
            return out;
        }
        // Classic layout stacks all Spaces vertically: prioritize personal space first.
        let personal_space = self
            .spaces
            .read(cx)
            .spaces()
            .iter()
            .find(|space| space.is_default)
            .map(|space| space.id.as_str());
        for item in items.iter().filter(|i| {
            personal_space.is_some() && i.cloud_organization.as_deref() == personal_space
        }) {
            push_item(item);
        }
        for item in &items {
            push_item(item);
        }
        out
    }

    /// Stale-While-Revalidate + Space-scoped lazy loading for Cloud project
    /// previews and connected Agents:
    /// - Hydrates cached data immediately from `HomeDetailsCache` (0 ms).
    /// - Only revalidates projects in the currently visible Space.
    /// - Skips unchanged previews (version-keyed on `item.modified` + TTL) and
    ///   respects Agent cooldowns even on window focus (`on_focus`).
    /// - Deduplicates in-flight project ids and runs up to 4 concurrent
    ///   work-stealing workers, streaming each project back incrementally.
    pub(in crate::app) fn refresh_cloud_home_details(
        &mut self,
        on_focus: bool,
        cx: &mut Context<Self>,
    ) {
        use crate::features::cloud::{
            CachedProjectAgent, DETAILS_CONCURRENCY, home_details_now_millis as now_millis,
        };
        if self.discovery.cloud_details_override {
            return;
        }
        let cache = crate::features::cloud::global_home_details(cx);
        let enabled = self.session.home
            && self.has_projects(cx)
            && crate::features::flags::cloud_enabled(&self.preferences, cx);
        let status = crate::features::cloud::account::status(cx);
        let signed_out = status == Some(crate::cloud::auth::Status::SignedOut);
        let offline = status == Some(crate::cloud::auth::Status::Offline);
        let account_scope = crate::features::cloud::account::broker_and_binding(cx)
            .filter(|_| enabled)
            .map(|(_, b)| format!("{}:{}", b.environment.api(), b.user));

        cache.update(cx, |c, cx| {
            c.ensure_scope(account_scope.as_deref(), signed_out, offline, cx);
        });
        let Some(_) = account_scope else {
            if !self.discovery.cloud_previews.is_empty()
                || !self.discovery.cloud_project_agents.is_empty()
                || !self.discovery.cloud_agents.is_empty()
            {
                self.discovery.cloud_agents.clear();
                self.discovery.cloud_project_agents.clear();
                self.discovery.cloud_previews.clear();
                cx.notify();
            }
            return;
        };

        // Prune deleted Cloud projects once the catalog has a fresh listing.
        let fresh_known: Option<HashSet<String>> = {
            let cat = self.catalog.read(cx);
            if cat.fresh
                && let crate::features::cloud::CatalogState::Ready(entries) = &cat.state
            {
                Some(entries.iter().map(|e| e.id.clone()).collect())
            } else {
                None
            }
        };
        if let Some(known) = fresh_known {
            let refs: HashSet<&str> = known.iter().map(String::as_str).collect();
            cache.update(cx, |c, cx| c.prune_to_catalog(&refs, cx));
        }

        // Paint cached previews & Agents immediately (SWR: 0 ms).
        self.sync_cloud_details_from_cache(cx);
        if offline {
            return;
        }

        let targets = self.visible_cloud_targets(cx);
        if targets.is_empty() {
            return;
        }

        let (Some(services), Some(agents_client)) = (
            crate::features::cloud::services_client(cx),
            crate::features::cloud::agents_client(cx),
        ) else {
            return;
        };

        let now_ms = now_millis();
        let (epoch, work) = cache.update(cx, |c, _| {
            let epoch = c.epoch();
            let work = c.plan_and_claim(&targets, now_ms, on_focus);
            (epoch, work)
        });
        if work.is_empty() {
            return;
        }

        let (tx, rx) = async_channel::unbounded();
        let workers = work.len().min(DETAILS_CONCURRENCY).max(1);
        let queue = std::sync::Arc::new(std::sync::Mutex::new(work.into_iter()));
        for _ in 0..workers {
            let queue = queue.clone();
            let tx = tx.clone();
            let services = services.clone();
            let agents_client = agents_client.clone();
            cx.background_executor()
                .spawn(async move {
                    loop {
                        let next = { queue.lock().unwrap().next() };
                        let Some((project_id, modified, plan)) = next else {
                            break;
                        };
                        let previews = if plan.fetch_previews {
                            services.list_root_entries(&project_id).ok().map(|entries| {
                                let selected = super::previews::select_cloud_previews(&entries);
                                (super::previews::to_cached(&selected), modified)
                            })
                        } else {
                            None
                        };
                        let agents = if plan.fetch_agents {
                            agents_client.links(&project_id).ok().map(|inventory| {
                                if inventory.connections.is_empty() {
                                    return Vec::new();
                                }
                                let sessions = agents_client.sessions(&project_id).ok();
                                let resolved = crate::workspace::cloud::agents::resolve(
                                    &inventory.connections,
                                    sessions.as_deref(),
                                    now_millis(),
                                );
                                resolved
                                    .into_iter()
                                    .map(|ws_agent| CachedProjectAgent {
                                        id: ws_agent.agent.id,
                                        name: ws_agent.agent.name,
                                        avatar: ws_agent.agent.avatar,
                                        active: ws_agent.active,
                                        last_active_at: ws_agent.last_active_at,
                                    })
                                    .collect()
                            })
                        } else {
                            None
                        };
                        let _ = tx.send_blocking((project_id, plan, previews, agents));
                    }
                })
                .detach();
        }
        drop(tx);

        let cache_entity = cache.clone();
        cx.spawn(async move |this, cx| {
            while let Ok((project_id, plan, previews, agents)) = rx.recv().await {
                let finished_ms = now_millis();
                let _ = cache_entity.update(cx, |c, cx| {
                    c.finish_fetch(epoch, &project_id, plan, previews, agents, finished_ms, cx);
                });
                let _ = this.update(cx, |s, cx| {
                    s.sync_cloud_details_from_cache(cx);
                });
            }
        })
        .detach();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::connections::legacy_runtime_registry::Runtime;
    use core::prelude::v1::test;

    fn inst(runtime: Runtime, id: &'static str, label: &str) -> Installation {
        Installation {
            runtime,
            id,
            label: label.into(),
            executable: PathBuf::from(format!("/usr/bin/{id}")),
            chat: true,
        }
    }

    #[test]
    fn local_agents_follow_recipe_order_hide_bundled_and_mark_connected() {
        let installations = vec![
            Installation {
                runtime: Runtime::PuppyOne,
                id: crate::agent::connections::legacy_local_agent_inventory::BUILT_IN_AGENT_ID,
                label:
                    crate::agent::connections::legacy_local_agent_inventory::BUILT_IN_AGENT_LABEL
                        .into(),
                executable: PathBuf::new(),
                chat: true,
            },
            inst(Runtime::Cursor, "cursor", "Cursor"),
            inst(Runtime::OpenCode, "opencode", "OpenCode"),
            inst(Runtime::Claude, "claude", "Claude Code"),
        ];
        let enrolled = HashSet::from(["claude".to_owned(), "opencode".to_owned()]);
        let hidden = vec!["cursor".to_owned()];
        let resolved = resolve_local_agents(&installations, &enrolled, &hidden);
        assert_eq!(
            resolved,
            vec![
                HomepageLocalAgent {
                    runtime_id: "claude".into(),
                    label: "Claude Code".into(),
                    icon_key: "claude".into(),
                    connected: true,
                },
                HomepageLocalAgent {
                    runtime_id: "opencode-native".into(),
                    label: "OpenCode".into(),
                    icon_key: "opencode".into(),
                    connected: true,
                },
            ]
        );
    }

    #[test]
    fn newer_iso_timestamp_keeps_latest_valid_activity() {
        assert_eq!(
            newer_iso_timestamp(Some("2026-11-15T08:00:00Z"), Some("2026-11-15T09:30:00Z"))
                .as_deref(),
            Some("2026-11-15T09:30:00Z")
        );
        assert_eq!(
            newer_iso_timestamp(Some("2026-11-15T09:30:00Z"), Some("not-a-date")).as_deref(),
            Some("2026-11-15T09:30:00Z")
        );
    }
}
