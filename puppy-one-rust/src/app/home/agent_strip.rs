//! `OnboardingStartActions` and `HomepageAgentStrip`: the header row of a
//! Homepage that already has projects. On the left, `New project` (the one
//! filled key), `Open a folder` and `Import`; on the right, compact logo-only
//! marks for the person's own Local Agents and personal-space Cloud Agents,
//! plus `+` (`Settings -> Local Agents`).
use super::*;
use crate::agent::connections::legacy_local_agent_inventory::{
    self as agent_inventory, Installation,
};
use crate::features::local_agents::{
    LOCAL_AGENT_CHAT_RECIPES, local_agent_id_for_agent_chat_runtime,
};
use crate::platform::agent_activity::{host::Host, registration::Enrollment};
use crate::ui::agent_brands;
use std::collections::HashSet;

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

/// `HomepageAgentBrandMark`: compact optical brand mark (`18×18` in the strip,
/// `20×20` / `28×28` / `16×16` in `AgentProjectStartDialog`). Only `chatgpt`
/// and `codex` draw monochrome in `ink`; every other brand keeps its own
/// artwork, and unknown labels fall back to up to two uppercase initials.
pub(in crate::app::home) fn agent_brand_mark(
    icon_key: Option<&str>,
    label: &str,
    size: f32,
    radius: f32,
    ink: Rgba,
    t: Theme,
) -> Div {
    let brand = icon_key
        .and_then(agent_brands::get)
        .or_else(|| agent_brands::resolve(None, icon_key, Some(label)));
    if let Some(brand) = brand {
        let monochrome_path = (brand.id == "chatgpt" || brand.id == "codex")
            .then(|| agent_brands::monochrome(brand))
            .flatten();
        let artwork: AnyElement = match monochrome_path {
            Some(path) => svg()
                .path(path)
                .size(px(size))
                .text_color(ink)
                .into_any_element(),
            None => agent_brands::artwork(brand, t.dark, size).into_any_element(),
        };
        return div()
            .size(px(size))
            .flex_none()
            .flex()
            .items_center()
            .justify_center()
            .overflow_hidden()
            .rounded(px(radius))
            .text_color(ink)
            .child(artwork);
    }
    let initials: String = label
        .split_whitespace()
        .take(2)
        .filter_map(|word| word.chars().next())
        .flat_map(char::to_uppercase)
        .collect();
    let initials = if initials.is_empty() {
        "A".to_owned()
    } else {
        initials
    };
    div()
        .size(px(size))
        .flex_none()
        .flex()
        .items_center()
        .justify_center()
        .overflow_hidden()
        .rounded(px(radius))
        .bg(theme::alpha(ink, 0.12))
        .text_color(ink)
        .text_size(px(theme::ty().ui.caption))
        .font_weight(FontWeight::SEMIBOLD)
        .line_height(px(size))
        .child(initials)
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

fn format_cloud_agent_activity(value: Option<&str>, now: SystemTime) -> Option<String> {
    let ms = chrono::DateTime::parse_from_rfc3339(value?)
        .ok()?
        .timestamp_millis();
    if ms < 0 {
        return None;
    }
    let at = UNIX_EPOCH + Duration::from_millis(ms as u64);
    Some(super::modification_time(at, now))
}

impl Homepage {
    /// Visible local Agents for the strip: test override when set, else the
    /// background discovery snapshot filtered by current preferences.
    pub(in crate::app) fn visible_local_agents(&self, cx: &App) -> Vec<HomepageLocalAgent> {
        let hidden = &self
            .preferences
            .read(cx)
            .state
            .local_agents
            .hidden_agent_ids;
        if let Some(override_list) = &self.local_agents_override {
            return override_list
                .iter()
                .filter(|agent| {
                    let provider_id = local_agent_id_for_agent_chat_runtime(&agent.runtime_id);
                    !hidden.iter().any(|h| h == provider_id)
                })
                .cloned()
                .collect();
        }
        let Some((installations, enrolled)) = &self.discovered_local_agents else {
            return Vec::new();
        };
        resolve_local_agents(installations, enrolled, hidden)
    }

    /// Scans local Agent CLI installations and Hook enrollment off the main
    /// thread on mount, CLI activation, and window focus (`useHomepageLocalAgents`).
    pub(in crate::app) fn refresh_local_agents(&mut self, force: bool, cx: &mut Context<Self>) {
        if self.local_agents_override.is_some() {
            return;
        }
        if !self.session.home || !self.has_projects(cx) {
            return;
        }
        if self.scanning_local_agents || (!force && self.discovered_local_agents.is_some()) {
            return;
        }
        self.scanning_local_agents = true;
        self.local_agents_generation += 1;
        let generation = self.local_agents_generation;
        let task = cx.background_executor().spawn(async move {
            let installations = agent_inventory::discover();
            let enrolled: HashSet<String> = Host::global()
                .enrollment()
                .into_iter()
                .filter(|p| p.enrollment == Enrollment::Enabled)
                .map(|p| p.provider_id.to_owned())
                .collect();
            (installations, enrolled)
        });
        cx.spawn(async move |this, cx| {
            let found = task.await;
            let _ = this.update(cx, |s, cx| {
                if s.local_agents_generation == generation {
                    s.scanning_local_agents = false;
                    s.discovered_local_agents = Some(found);
                    cx.notify();
                }
            });
        })
        .detach();
    }

    /// Reads root file previews for visible Cloud projects and connected Agents
    /// for personal-space Cloud projects on scope change or window focus only
    /// (`useProjectPreviews` + `useHomepageCloudAgents`, never polling).
    pub(in crate::app) fn refresh_cloud_home_details(
        &mut self,
        force: bool,
        cx: &mut Context<Self>,
    ) {
        if self.cloud_details_override {
            return;
        }
        let enabled = self.session.home
            && self.has_projects(cx)
            && crate::features::flags::cloud_enabled(&self.preferences, cx);
        let account_scope = crate::features::cloud::account::broker_and_binding(cx)
            .filter(|_| enabled)
            .map(|(_, b)| format!("{}:{}", b.environment.api(), b.user));
        let Some(account_scope) = account_scope else {
            if !self.cloud_details_key.is_empty() {
                self.cloud_details_generation += 1;
                self.cloud_details_key.clear();
                self.cloud_agents.clear();
                self.cloud_project_agents.clear();
                self.cloud_previews.clear();
            }
            return;
        };
        let items = self.project_items(cx);
        let personal_space = self
            .spaces
            .read(cx)
            .spaces()
            .iter()
            .find(|space| space.is_default)
            .map(|space| space.id.clone());
        let mut cloud_ids: Vec<String> = Vec::new();
        let mut personal_ids: Vec<String> = Vec::new();
        for item in &items {
            if item.local_path.is_none()
                && let Some(id) = &item.cloud_project
            {
                if !cloud_ids.contains(id) {
                    cloud_ids.push(id.clone());
                }
                if personal_space.is_some()
                    && item.cloud_organization == personal_space
                    && !personal_ids.contains(id)
                {
                    personal_ids.push(id.clone());
                }
            }
        }
        let scope_key = format!(
            "{account_scope}|{}|{}",
            cloud_ids.join(","),
            personal_ids.join(",")
        );
        if !force && self.cloud_details_key == scope_key {
            return;
        }
        let (Some(services), Some(agents_client)) = (
            crate::features::cloud::services_client(cx),
            crate::features::cloud::agents_client(cx),
        ) else {
            return;
        };
        self.cloud_details_key = scope_key.clone();
        self.cloud_details_generation += 1;
        let generation = self.cloud_details_generation;
        let task = cx.background_executor().spawn(async move {
            let mut previews_map: HashMap<String, Vec<super::previews::ProjectAssetPreview>> =
                HashMap::new();
            for id in &cloud_ids {
                if let Ok(entries) = services.list_root_entries(id) {
                    let selected = super::previews::select_cloud_previews(&entries);
                    if !selected.is_empty() {
                        previews_map.insert(id.clone(), selected);
                    }
                }
            }
            let now_ms = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0);
            let mut dedup_order: Vec<String> = Vec::new();
            let mut dedup: HashMap<String, HomepageCloudAgent> = HashMap::new();
            let mut per_project: HashMap<String, Vec<super::folder::FolderAgentBadge>> =
                HashMap::new();
            for project_id in &personal_ids {
                let Ok(inventory) = agents_client.links(project_id) else {
                    continue;
                };
                let sessions = agents_client.sessions(project_id).ok();
                let resolved = crate::workspace::cloud::agents::resolve(
                    &inventory.connections,
                    sessions.as_deref(),
                    now_ms,
                );
                if resolved.is_empty() {
                    continue;
                }
                let mut badges = Vec::with_capacity(resolved.len());
                for ws_agent in resolved {
                    let entry = HomepageCloudAgent {
                        id: ws_agent.agent.id,
                        name: ws_agent.agent.name,
                        avatar: ws_agent.agent.avatar,
                        last_active_at: ws_agent.last_active_at,
                    };
                    badges.push(super::folder::FolderAgentBadge {
                        id: entry.id.clone(),
                        name: entry.name.clone(),
                        avatar: entry.avatar.clone(),
                    });
                    let key = format!("{}\0{}", entry.name, entry.avatar.as_deref().unwrap_or(""));
                    if let Some(existing) = dedup.get_mut(&key) {
                        existing.last_active_at = newer_iso_timestamp(
                            existing.last_active_at.as_deref(),
                            entry.last_active_at.as_deref(),
                        );
                    } else {
                        dedup_order.push(key.clone());
                        dedup.insert(key, entry);
                    }
                }
                per_project.insert(project_id.clone(), badges);
            }
            let cloud_agents: Vec<HomepageCloudAgent> = dedup_order
                .into_iter()
                .filter_map(|k| dedup.remove(&k))
                .collect();
            (previews_map, cloud_agents, per_project)
        });
        cx.spawn(async move |this, cx| {
            let (previews_map, cloud_agents, per_project) = task.await;
            let _ = this.update(cx, |s, cx| {
                if s.cloud_details_generation == generation && s.cloud_details_key == scope_key {
                    s.cloud_previews = previews_map;
                    s.cloud_agents = cloud_agents;
                    s.cloud_project_agents = per_project;
                    cx.notify();
                }
            });
        })
        .detach();
    }

    /// `OnboardingStartActions`: `New project`, `Open a folder`, and `Import`
    /// in compact toolbar geometry (`28px` tall, `10px` inline pad, `13px` medium).
    pub(in crate::app::home) fn start_actions(&self, busy: bool, cx: &mut Context<Self>) -> Div {
        let t = cx.palette();
        let meta = theme::ty().ui.meta;
        let create = Button::new("home-create-project")
            .variant(ButtonVariant::PatternDeep)
            .icon(Icon::new("file-plus-2").small().stroke(1.85))
            .label(tr("onboarding.action.createLocalProject"))
            .accessibility_label(tr("onboarding.action.createLocalProject"))
            .disabled(busy)
            .on_click(cx.listener(|s, _, w, cx| s.begin_create_project(w, cx)));
        let open_folder = Button::new("home-open-folder")
            .variant(ButtonVariant::Ghost)
            .icon(Icon::product(ProductIcon::Folder).small().stroke(1.85))
            .label(tr("onboarding.action.openFolder"))
            .disabled(busy)
            .h(px(theme::control_compact()))
            .px(px(10.))
            .rounded(px(metric::CONTROL_RADIUS))
            .text_size(px(meta))
            .font_weight(FontWeight::MEDIUM)
            .when(busy, |b| {
                b.bg(t.control).text_color(t.text_disabled).opacity(1.)
            })
            .on_click(cx.listener(|s, _, _, cx| s.command(Command::OpenFolder, cx)));
        let import = Button::new("home-import")
            .variant(ButtonVariant::Ghost)
            .icon(Icon::new("download").small().stroke(1.85))
            .label(tr("onboarding.action.importFromApps"))
            .disabled(busy)
            .h(px(theme::control_compact()))
            .px(px(10.))
            .rounded(px(metric::CONTROL_RADIUS))
            .text_size(px(meta))
            .font_weight(FontWeight::MEDIUM)
            .when(busy, |b| {
                b.bg(t.control).text_color(t.text_disabled).opacity(1.)
            })
            .on_click(cx.listener(|s, _, w, cx| s.begin_import(w, cx)));
        h_flex()
            .debug_selector(|| "home-start-actions".into())
            .flex_none()
            .items_center()
            .gap(px(6.))
            .child(create)
            .child(open_folder)
            .child(import)
    }

    /// `HomepageAgentStrip`: compact `28×28` brand marks for local Agents,
    /// Cloud Agents in the personal Space, and `+` (`Settings -> Local Agents`).
    pub(in crate::app::home) fn agent_strip(&self, busy: bool, cx: &mut Context<Self>) -> Div {
        let t = cx.palette();
        let size = theme::control_compact();
        let local = self.visible_local_agents(cx);
        let cloud = &self.cloud_agents;
        let now = SystemTime::now();

        let local_group = (!local.is_empty()).then(|| {
            let tiles = local.iter().enumerate().map(|(idx, agent)| {
                let isolated = crate::localization::bidi_isolate(&agent.label);
                let start = tf("onboarding.agents.start", &[("agent", isolated.into())]);
                let tip = if agent.connected {
                    format!("{start} · {}", tr("onboarding.agents.connected"))
                } else {
                    start.clone()
                };
                let runtime_id = agent.runtime_id.clone();
                let agent_clone = agent.clone();
                div()
                    .id(("home-local-agent", idx))
                    .debug_selector(move || format!("home-agent:{runtime_id}"))
                    .relative()
                    .size(px(size))
                    .flex_none()
                    .flex()
                    .items_center()
                    .justify_center()
                    .rounded(px(metric::CONTROL_RADIUS))
                    .border_1()
                    .border_color(t.border_subtle)
                    .bg(t.panel_raised)
                    .text_color(if busy { t.text_disabled } else { t.text })
                    .when(busy, |d| d.opacity(0.6))
                    .when(!busy, |d| {
                        d.cursor(theme::clickable_cursor())
                            .hover(move |s| s.border_color(t.border).bg(t.hover))
                            .on_click(cx.listener(move |s, _, w, cx| {
                                s.begin_agent_start(agent_clone.clone(), w, cx)
                            }))
                    })
                    .tooltip(crate::ui::components::tooltip(tip))
                    .child(agent_brand_mark(
                        Some(&agent.icon_key),
                        &agent.label,
                        18.,
                        4.,
                        if busy { t.text_disabled } else { t.text },
                        t,
                    ))
                    .when(agent.connected, |d| {
                        // `.onboarding-agent-connected`: 6px dot with 1.5px canvas ring.
                        d.child(
                            div()
                                .absolute()
                                .right(px(-2.5))
                                .bottom(px(-2.5))
                                .size(px(9.))
                                .rounded_full()
                                .bg(t.canvas)
                                .flex()
                                .items_center()
                                .justify_center()
                                .child(div().size(px(6.)).rounded_full().bg(t.success)),
                        )
                    })
            });
            h_flex()
                .debug_selector(|| "home-agent-group:local".into())
                .flex_none()
                .items_center()
                .gap(px(4.))
                .children(tiles)
        });

        let sep = (!local.is_empty() && !cloud.is_empty()).then(|| {
            div()
                .w(px(1.))
                .h(px(14.))
                .mx(px(3.))
                .flex_none()
                .bg(t.divider)
        });

        let cloud_group = (!cloud.is_empty()).then(|| {
            let cloud_label = tr("onboarding.agents.cloud");
            let place_mark = div()
                .id("home-agent-cloud-mark")
                .w(px(20.))
                .h(px(size))
                .flex_none()
                .flex()
                .items_center()
                .justify_center()
                .text_color(t.subtle)
                .tooltip(crate::ui::components::tooltip(cloud_label))
                .child(
                    Icon::product(ProductIcon::Cloud)
                        .with_size(px(13.))
                        .stroke(1.85)
                        .color(t.subtle),
                );
            let faces = cloud.iter().enumerate().map(|(idx, agent)| {
                let last_active = format_cloud_agent_activity(agent.last_active_at.as_deref(), now);
                let tip = match last_active {
                    Some(time) => {
                        let isolated = crate::localization::bidi_isolate(&agent.name);
                        tf(
                            "onboarding.agents.lastActive",
                            &[("agent", isolated.into()), ("time", time.into())],
                        )
                    }
                    None => agent.name.clone(),
                };
                let agent_id = agent.id.clone();
                div()
                    .id(("home-cloud-agent", idx))
                    .debug_selector(move || format!("home-cloud-agent:{agent_id}"))
                    .size(px(size))
                    .flex_none()
                    .flex()
                    .items_center()
                    .justify_center()
                    .rounded(px(metric::CONTROL_RADIUS))
                    .border_1()
                    .border_color(t.border_subtle)
                    .bg(t.panel_raised)
                    .text_color(t.text)
                    .tooltip(crate::ui::components::tooltip(tip))
                    .child(crate::app::cloud_agents_ui::compact_agent_face(
                        &agent.name,
                        agent.avatar.as_deref(),
                        18.,
                        4.,
                        t.panel_raised,
                        t,
                    ))
            });
            h_flex()
                .debug_selector(|| "home-agent-group:cloud".into())
                .flex_none()
                .items_center()
                .gap(px(4.))
                .child(place_mark)
                .children(faces)
        });

        let connect_label = tr("onboarding.agents.connect");
        let connect = div()
            .id("home-agent-connect")
            .debug_selector(|| "home-agent-connect".into())
            .size(px(size))
            .flex_none()
            .flex()
            .items_center()
            .justify_center()
            .rounded(px(metric::CONTROL_RADIUS))
            .text_color(if busy { t.text_disabled } else { t.muted })
            .when(busy, |d| d.opacity(0.6))
            .when(!busy, |d| {
                d.cursor(theme::clickable_cursor())
                    .hover(move |s| s.bg(t.hover).text_color(t.text))
                    .on_click(cx.listener(|_, _, _, cx| {
                        cx.emit(HomeEvent::OpenSettings(
                            crate::features::settings::Page::LocalAgents,
                        ))
                    }))
            })
            .tooltip(crate::ui::components::tooltip(connect_label))
            .child(Icon::new("plus").small().stroke(1.85));

        h_flex()
            .debug_selector(|| "home-agent-strip".into())
            .min_w_0()
            .ml_auto()
            .items_center()
            .justify_end()
            .gap(px(4.))
            .children(local_group)
            .children(sep)
            .children(cloud_group)
            .child(connect)
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
                id: agent_inventory::BUILT_IN_AGENT_ID,
                label: agent_inventory::BUILT_IN_AGENT_LABEL.into(),
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
            newer_iso_timestamp(Some("2026-11-15T08:00:00Z"), Some("2026-11-15T09:30:00Z"),)
                .as_deref(),
            Some("2026-11-15T09:30:00Z")
        );
        assert_eq!(
            newer_iso_timestamp(Some("2026-11-15T09:30:00Z"), Some("not-a-date")).as_deref(),
            Some("2026-11-15T09:30:00Z")
        );
    }
}
