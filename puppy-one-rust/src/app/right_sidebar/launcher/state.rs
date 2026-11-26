//! Pure domain state for the right sidebar's L1 composer-first launcher:
//! authoritative Agent selection synchronized with `AgentRoutingPreferences`,
//! deterministic resolution across incremental discovery, and cohesive
//! per-tab UI state.
use crate::agent::connections::legacy_local_agent_inventory::{self as agents, Installation};
use crate::agent::contract::dto::{Model, RuntimeInspection};
use crate::features::desktop_agent::{
    AgentSessionControl, AgentSessionControlId, AgentSessionControlSelection, SessionPickers,
    derive_agent_session_controls,
};
use crate::features::local_agents::{agent_chat_runtime_id, local_agent_id_for_agent_chat_runtime};
use crate::features::settings::{AgentRoutePatch, AgentRoutePreference, AgentRoutingPreferences};
use crate::features::workbench::Id;
use crate::localization::{Arg, bidi_isolate, t as tr, tf};
use crate::ui::form_input::TextInput;
use gpui::{Entity, FocusHandle, ImageFormat, ScrollHandle, SharedString};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// Normalizes either a local installation id (`"opencode"`) or a chat runtime
/// id (`"opencode-native"`) into its canonical chat runtime id.
pub(super) fn canonical_runtime_id(id: &str) -> String {
    if id == agents::BUILT_IN_AGENT_ID {
        return id.to_owned();
    }
    let local_id = local_agent_id_for_agent_chat_runtime(id);
    if let Some(product) = agents::LOCAL_AGENTS.iter().find(|a| a.id == local_id) {
        let probe = Installation {
            runtime: product.runtime,
            id: product.id,
            label: product.label.into(),
            executable: PathBuf::new(),
            chat: true,
        };
        return agent_chat_runtime_id(&probe);
    }
    id.to_owned()
}

/// Whether `installation` matches a local agent id or chat runtime id.
pub(super) fn installation_matches(installation: &Installation, target: &str) -> bool {
    installation.id == target
        || agent_chat_runtime_id(installation) == target
        || local_agent_id_for_agent_chat_runtime(target) == installation.id
}

/// A catalog placeholder for a remembered local Agent while discovery is still
/// probing executables, so startup never flashes a fallback Agent and jumps
/// mid-interaction once the remembered Agent arrives.
fn pending_local_installation(runtime_id: &str, hidden_agents: &[String]) -> Option<Installation> {
    if runtime_id == agents::BUILT_IN_AGENT_ID {
        return Some(Installation {
            runtime: crate::agent::connections::legacy_runtime_registry::Runtime::PuppyOne,
            id: agents::BUILT_IN_AGENT_ID,
            label: agents::BUILT_IN_AGENT_LABEL.into(),
            executable: PathBuf::new(),
            chat: true,
        });
    }
    let local_id = local_agent_id_for_agent_chat_runtime(runtime_id);
    if hidden_agents.iter().any(|h| h == local_id) {
        return None;
    }
    let product = agents::LOCAL_AGENTS.iter().find(|a| a.id == local_id)?;
    Some(Installation {
        runtime: product.runtime,
        id: product.id,
        label: product.label.into(),
        executable: PathBuf::new(),
        chat: true,
    })
}

/// Single source of truth for the launcher's selected Agent.
///
/// Mirrors `PreferencesStore.state.agent_routing.selected_runtime_id` and
/// protects explicit user clicks against cold-start preference loads or
/// incremental discovery progress.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(super) struct AgentSelection {
    /// Persisted runtime id last observed from `AgentRoutingPreferences`.
    preferred_runtime_id: Option<String>,
    /// Explicit runtime id picked by the user in this launcher.
    explicit_runtime_id: Option<String>,
    /// Explicit choice made before `PreferencesStore` finished loading, queued
    /// to flush once storage becomes writable.
    pending_persist: Option<String>,
}

impl AgentSelection {
    /// Hydrates the initial persisted preference when a `PreferencesStore`
    /// connects or finishes loading. Never clobbers an explicit click made
    /// before disk hydration settled.
    pub fn sync_preferences(&mut self, routing: &AgentRoutingPreferences) -> bool {
        let next = routing
            .selected_runtime_id
            .as_deref()
            .map(canonical_runtime_id);
        if self.pending_persist.is_some() {
            // An explicit user choice is waiting to flush; keep it authoritative
            // until persisted.
            return false;
        }
        if self.preferred_runtime_id == next {
            return false;
        }
        self.preferred_runtime_id = next.clone();
        // Follow external preference changes (another tab/window/dialog).
        self.explicit_runtime_id = next;
        true
    }

    /// Records an explicit Agent choice from the launcher UI and returns the
    /// canonical runtime id to persist.
    pub fn select_explicit(&mut self, id: &str, store_loaded: bool) -> String {
        let runtime_id = canonical_runtime_id(id);
        self.explicit_runtime_id = Some(runtime_id.clone());
        self.preferred_runtime_id = Some(runtime_id.clone());
        self.pending_persist = (!store_loaded).then(|| runtime_id.clone());
        runtime_id
    }

    /// Consumes a queued explicit choice once `PreferencesStore` finishes loading.
    pub fn take_pending_persist(&mut self) -> Option<String> {
        self.pending_persist.take()
    }

    /// The desired canonical runtime id, if any.
    pub fn desired_runtime_id(&self) -> Option<&str> {
        self.explicit_runtime_id
            .as_deref()
            .or(self.preferred_runtime_id.as_deref())
    }

    /// Resolves the active Agent for the L1 composer deterministically:
    /// 1. Hosted Cloud workspaces always use their single hosted Agent.
    /// 2. The user's selected/remembered Agent when visible in `visible`.
    /// 3. While local discovery is still scanning, a known non-hidden catalog
    ///    entry for the remembered Agent (preventing startup fallback jumps).
    /// 4. First detected local chat Agent, then Built-in Agent.
    pub fn resolve_active(
        &self,
        visible: &[Installation],
        hidden_agents: &[String],
        scanning: bool,
        hosted: bool,
    ) -> Option<Installation> {
        if hosted {
            return visible.iter().find(|i| i.chat).cloned();
        }
        if let Some(desired) = self.desired_runtime_id() {
            if let Some(found) = visible
                .iter()
                .find(|i| i.chat && installation_matches(i, desired))
            {
                return Some(found.clone());
            }
            if scanning && let Some(pending) = pending_local_installation(desired, hidden_agents) {
                return Some(pending);
            }
        }
        visible
            .iter()
            .find(|i| i.chat && !i.bundled())
            .or_else(|| visible.iter().find(|i| i.chat))
            .cloned()
    }
}

/// Dynamic L1 hero composer placeholder matching the active Agent.
pub(super) fn launcher_placeholder(active: Option<&Installation>) -> String {
    match active {
        Some(inst) => tf(
            "native.launcher.askPlaceholder",
            &[("agent", Arg::Text(bidi_isolate(&inst.label)))],
        ),
        None => tr("agent.composer.placeholder.default").to_string(),
    }
}

/// Identity of a single launcher page: strictly scoped to its tab (`1 tab = 1
/// page`) so multiple `New tab` tabs never share draft input, popover state, or
/// errors, and closing a tab destroys its page state cleanly.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub(super) enum LauncherSlot {
    Tab(Id),
    EmptyGroup(Id),
}

impl LauncherSlot {
    pub fn of(group: Id, tab: Option<Id>) -> Self {
        match tab {
            Some(id) => Self::Tab(id),
            None => Self::EmptyGroup(group),
        }
    }

    /// Collision-free GPUI element integer key per launcher page.
    pub fn element_key(self) -> u64 {
        match self {
            Self::Tab(id) => (id << 1) | 1,
            Self::EmptyGroup(id) => id << 1,
        }
    }
}

/// Whether two workspace root paths denote the same directory.
pub(super) fn same_root(a: &Path, b: &Path) -> bool {
    a == b
        || a.canonicalize()
            .ok()
            .zip(b.canonicalize().ok())
            .is_some_and(|(a, b)| a == b)
}

/// Computes a slash-normalized workspace-relative path if `path` lives inside
/// `root` (handling symlinks/canonicalization gracefully).
pub(super) fn workspace_relative_path(root: &Path, path: &Path) -> Option<String> {
    let rel = path
        .strip_prefix(root)
        .ok()
        .map(Path::to_path_buf)
        .or_else(|| {
            let canon_root = root.canonicalize().ok()?;
            let canon_path = path.canonicalize().ok()?;
            canon_path
                .strip_prefix(&canon_root)
                .ok()
                .map(Path::to_path_buf)
        })?;
    let rel_str = rel.to_string_lossy().replace('\\', "/");
    (!rel_str.is_empty()).then_some(rel_str)
}

/// Backing kind of an attachment staged on a launcher page before a chat tab
/// session is created.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) enum StagedAttachmentKind {
    WorkspacePath {
        path: PathBuf,
        relative_path: String,
    },
    ExternalFile {
        path: PathBuf,
        mime: String,
    },
    PastedImage {
        mime: String,
        format: ImageFormat,
        bytes: Arc<Vec<u8>>,
    },
}

/// One staged attachment on a single launcher page (either rendered on the 40px
/// visual shelf when `is_image == true`, or represented by an atomic inline
/// `@mention` token in `LauncherPageState::input`).
#[derive(Clone, Debug)]
pub(super) struct StagedAttachment {
    pub id: String,
    pub display_name: String,
    pub is_image: bool,
    pub kind: StagedAttachmentKind,
}

/// Projects a runtime's negotiated capabilities (`Model`, `Effort`, `Mode`)
/// into concrete picker controls, filling effective selections from the saved
/// per-runtime [`AgentRoutePreference`] or the runtime's own defaults.
pub(super) fn resolve_runtime_controls(
    inspection: &RuntimeInspection,
    route: &AgentRoutePreference,
) -> Vec<AgentSessionControl> {
    let selected_model = route
        .model_id
        .as_deref()
        .filter(|id| inspection.models.iter().any(|m| m.model == *id))
        .or_else(|| {
            inspection
                .models
                .iter()
                .find(|m| m.is_default)
                .or_else(|| inspection.models.first())
                .map(|m| m.model.as_str())
        });
    let model_entry =
        selected_model.and_then(|id| inspection.models.iter().find(|m| m.model == id));
    let offered_variants = model_entry
        .and_then(|m| m.variants.as_deref())
        .unwrap_or(&[]);
    let preferred_effort = route
        .effort
        .as_deref()
        .filter(|v| !v.is_empty())
        .or_else(|| route.variant.as_deref().filter(|v| !v.is_empty()));
    let selected_effort = preferred_effort
        .filter(|e| offered_variants.iter().any(|v| v == *e))
        .or_else(|| {
            model_entry
                .and_then(|m| m.default_variant.as_deref())
                .filter(|e| offered_variants.iter().any(|v| v == *e))
        })
        .or_else(|| offered_variants.first().map(String::as_str));
    let modes = inspection.mode_list();
    let selected_mode = route
        .mode
        .as_deref()
        .filter(|id| modes.iter().any(|m| m.id == *id))
        .or_else(|| {
            modes
                .iter()
                .find(|m| m.is_default)
                .or_else(|| modes.first())
                .map(|m| m.id.as_str())
        });
    derive_agent_session_controls(
        Some(inspection),
        AgentSessionControlSelection {
            selected_model,
            selected_effort,
            selected_mode,
        },
    )
}

/// Computes the [`AgentRoutePatch`] to persist when the user picks `value` for
/// parameter control `id` on the L1 launcher (matching `AgentChatTabPanel`'s
/// `select_routed_control` semantics: switching models preserves a compatible
/// effort or resets to the new model's default variant).
pub(super) fn route_patch_for_control(
    inspection: &RuntimeInspection,
    current: &AgentRoutePreference,
    id: AgentSessionControlId,
    value: &str,
) -> AgentRoutePatch {
    match id {
        AgentSessionControlId::Model => {
            let selected: Option<&Model> = inspection.models.iter().find(|m| m.model == value);
            let offered = selected.and_then(|m| m.variants.as_deref()).unwrap_or(&[]);
            let current_effort = current
                .effort
                .as_deref()
                .filter(|v| !v.is_empty())
                .or_else(|| current.variant.as_deref().filter(|v| !v.is_empty()));
            let effort = if let Some(existing) = current_effort
                && offered.iter().any(|v| v == existing)
            {
                Some(existing.to_owned())
            } else {
                selected
                    .and_then(|m| m.default_variant.clone())
                    .filter(|v| offered.iter().any(|o| o == v))
                    .or_else(|| offered.first().cloned())
            };
            AgentRoutePatch {
                provider_id: Some(selected.and_then(|m| m.provider_id.clone())),
                model_id: Some(Some(value.to_owned())),
                variant: Some(None),
                effort: Some(effort),
                mode: None,
            }
        }
        AgentSessionControlId::Effort => AgentRoutePatch {
            provider_id: None,
            model_id: None,
            variant: Some(None),
            effort: Some(Some(value.to_owned())),
            mode: None,
        },
        AgentSessionControlId::Mode => AgentRoutePatch {
            provider_id: None,
            model_id: None,
            variant: None,
            effort: None,
            mode: Some(Some(value.to_owned())),
        },
    }
}

/// Cohesive per-tab UI state for one launcher page instance.
pub(super) struct LauncherPageState {
    pub input: Option<Entity<TextInput>>,
    pub pickers: Option<Entity<SessionPickers>>,
    pub picker_open: bool,
    pub row_focus: HashMap<&'static str, FocusHandle>,
    pub heading_focus: FocusHandle,
    pub launch_error: Option<String>,
    pub notice: Option<SharedString>,
    pub attachments: Vec<StagedAttachment>,
    pub next_attachment_id: u64,
    pub scroll: ScrollHandle,
}

impl LauncherPageState {
    pub fn new(heading_focus: FocusHandle) -> Self {
        Self {
            input: None,
            pickers: None,
            picker_open: false,
            row_focus: HashMap::new(),
            heading_focus,
            launch_error: None,
            notice: None,
            attachments: Vec::new(),
            next_attachment_id: 1,
            scroll: ScrollHandle::new(),
        }
    }

    pub fn alloc_attachment_id(&mut self) -> String {
        let id = self.next_attachment_id;
        self.next_attachment_id += 1;
        format!("launcher-att-{id}")
    }

    pub fn remove_attachment(&mut self, id: &str) -> bool {
        let before = self.attachments.len();
        self.attachments.retain(|att| att.id != id);
        self.attachments.len() != before
    }

    /// Drops any non-image attachment whose inline `@mention` token was deleted
    /// from the editor (e.g., via Backspace/Delete).
    pub fn retain_token_attachments(&mut self, live_token_ids: &[String]) -> bool {
        let before = self.attachments.len();
        self.attachments
            .retain(|att| att.is_image || live_token_ids.iter().any(|id| id == &att.id));
        self.attachments.len() != before
    }

    pub fn has_attachments(&self) -> bool {
        !self.attachments.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::connections::legacy_runtime_registry::Runtime;

    fn inst(runtime: Runtime, id: &'static str, label: &str) -> Installation {
        Installation {
            runtime,
            id,
            label: label.into(),
            executable: PathBuf::from(format!("/fixture/{id}")),
            chat: true,
        }
    }

    #[test]
    fn remembered_agent_does_not_flash_fallback_while_scanning() {
        let mut selection = AgentSelection::default();
        selection
            .sync_preferences(&AgentRoutingPreferences::default().select_runtime(Some("codex")));

        let claude = inst(Runtime::Claude, "claude", "Claude Code");
        let codex = inst(Runtime::Codex, "codex", "Codex");
        let built_in = inst(
            Runtime::PuppyOne,
            agents::BUILT_IN_AGENT_ID,
            agents::BUILT_IN_AGENT_LABEL,
        );

        // Partial scan: only Claude & Built-in discovered so far — stay on Codex.
        let while_scanning = selection
            .resolve_active(&[claude.clone(), built_in.clone()], &[], true, false)
            .unwrap();
        assert_eq!(while_scanning.id, "codex");

        // Complete scan with Codex found — resolves to detected Codex with zero jump.
        let settled = selection
            .resolve_active(
                &[claude.clone(), codex, built_in.clone()],
                &[],
                false,
                false,
            )
            .unwrap();
        assert_eq!(settled.id, "codex");

        // Complete scan where Codex is uninstalled — falls back cleanly to Claude.
        let uninstalled = selection
            .resolve_active(&[claude, built_in], &[], false, false)
            .unwrap();
        assert_eq!(uninstalled.id, "claude");
    }

    #[test]
    fn explicit_choice_before_store_load_survives_hydration_and_normalizes_opencode() {
        let mut selection = AgentSelection::default();
        let runtime = selection.select_explicit("opencode", false);
        assert_eq!(runtime, "opencode-native");

        // Late preferences load with old "codex" must not clobber explicit pick.
        assert!(
            !selection.sync_preferences(
                &AgentRoutingPreferences::default().select_runtime(Some("codex"))
            )
        );
        assert_eq!(selection.desired_runtime_id(), Some("opencode-native"));
        assert_eq!(
            selection.take_pending_persist().as_deref(),
            Some("opencode-native")
        );

        let opencode = inst(Runtime::OpenCode, "opencode", "OpenCode");
        let codex = inst(Runtime::Codex, "codex", "Codex");
        let resolved = selection
            .resolve_active(&[codex, opencode], &[], false, false)
            .unwrap();
        assert_eq!(resolved.id, "opencode");
    }

    #[test]
    fn hidden_remembered_agent_falls_back_even_while_scanning() {
        let mut selection = AgentSelection::default();
        selection
            .sync_preferences(&AgentRoutingPreferences::default().select_runtime(Some("codex")));
        let claude = inst(Runtime::Claude, "claude", "Claude Code");
        let resolved = selection
            .resolve_active(&[claude], &["codex".into()], true, false)
            .unwrap();
        assert_eq!(resolved.id, "claude");
    }

    #[test]
    fn resolve_runtime_controls_uses_route_or_defaults_and_resets_incompatible_effort_on_model_switch()
     {
        use crate::agent::contract::dto::{Capabilities, Mode};

        let inspection = RuntimeInspection {
            selected_runtime_id: Some("codex".into()),
            capabilities: Some(Capabilities {
                model_selection: true,
                mode_selection: true,
                ..Default::default()
            }),
            models: vec![
                Model {
                    id: "gpt-5.4".into(),
                    model: "gpt-5.4".into(),
                    display_name: "GPT-5.4".into(),
                    description: String::new(),
                    is_default: true,
                    provider_id: Some("openai".into()),
                    variants: Some(vec!["low".into(), "medium".into(), "high".into()]),
                    default_variant: Some("medium".into()),
                    ..Default::default()
                },
                Model {
                    id: "o3".into(),
                    model: "o3".into(),
                    display_name: "o3".into(),
                    description: String::new(),
                    is_default: false,
                    provider_id: Some("openai".into()),
                    variants: Some(vec!["high".into(), "xhigh".into()]),
                    default_variant: Some("xhigh".into()),
                    ..Default::default()
                },
            ],
            modes: Some(vec![
                Mode {
                    id: "agent".into(),
                    display_name: "Agent".into(),
                    description: String::new(),
                    is_default: true,
                },
                Mode {
                    id: "plan".into(),
                    display_name: "Plan".into(),
                    description: String::new(),
                    is_default: false,
                },
            ]),
            ..Default::default()
        };

        // Defaults resolve cleanly when no route is saved yet.
        let defaults = resolve_runtime_controls(&inspection, &AgentRoutePreference::default());
        assert_eq!(defaults.len(), 3);
        assert_eq!(defaults[0].value.as_deref(), Some("gpt-5.4"));
        assert_eq!(defaults[1].value.as_deref(), Some("medium"));
        assert_eq!(defaults[2].value.as_deref(), Some("agent"));

        // Switching to a model that does not offer "low" resets effort to its default_variant ("xhigh").
        let current = AgentRoutePreference {
            model_id: Some("gpt-5.4".into()),
            effort: Some("low".into()),
            mode: Some("plan".into()),
            ..Default::default()
        };
        let patch =
            route_patch_for_control(&inspection, &current, AgentSessionControlId::Model, "o3");
        let next = current.merged(&patch);
        assert_eq!(next.model_id.as_deref(), Some("o3"));
        assert_eq!(next.provider_id.as_deref(), Some("openai"));
        assert_eq!(next.effort.as_deref(), Some("xhigh"));
        assert_eq!(next.mode.as_deref(), Some("plan"));

        let updated = resolve_runtime_controls(&inspection, &next);
        assert_eq!(updated[0].value.as_deref(), Some("o3"));
        assert_eq!(updated[1].value.as_deref(), Some("xhigh"));
        assert_eq!(updated[2].value.as_deref(), Some("plan"));
    }
}
