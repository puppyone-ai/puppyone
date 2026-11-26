//! Pure domain state for the right sidebar's L1 composer-first launcher:
//! authoritative Agent selection synchronized with `AgentRoutingPreferences`,
//! deterministic resolution across incremental discovery, and cohesive
//! per-group UI state.
use crate::agent::connections::legacy_local_agent_inventory::{self as agents, Installation};
use crate::features::local_agents::{agent_chat_runtime_id, local_agent_id_for_agent_chat_runtime};
use crate::features::settings::AgentRoutingPreferences;
use crate::features::workbench::Id;
use crate::localization::{Arg, bidi_isolate, t as tr, tf};
use crate::ui::form_input::TextInput;
use gpui::{Entity, FocusHandle, ScrollHandle};
use std::collections::HashMap;
use std::path::PathBuf;

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

/// Cohesive per-group UI state for one workbench group's launcher surface.
pub(super) struct LauncherGroupState {
    pub input: Option<Entity<TextInput>>,
    pub tab: Option<Id>,
    pub picker_open: bool,
    pub row_focus: HashMap<&'static str, FocusHandle>,
    pub heading_focus: FocusHandle,
    pub launch_error: Option<String>,
    pub scroll: ScrollHandle,
}

impl LauncherGroupState {
    pub fn new(heading_focus: FocusHandle) -> Self {
        Self {
            input: None,
            tab: None,
            picker_open: false,
            row_focus: HashMap::new(),
            heading_focus,
            launch_error: None,
            scroll: ScrollHandle::new(),
        }
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
}
