//! `agentRoutingPreferences.ts` and `agentSlice.ts`'s routing actions: the
//! Agent a new chat starts with, and each Agent's remembered route. Only
//! PuppyOne-managed runtimes need provider/model fields.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

/// `AGENT_ROUTING_PREFERENCES_VERSION`.
pub const AGENT_ROUTING_PREFERENCES_VERSION: u32 = 2;

/// `AgentRoutePreference`.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AgentRoutePreference {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub variant: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub effort: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mode: Option<String>,
}

impl AgentRoutePreference {
    fn is_empty(&self) -> bool {
        self == &Self::default()
    }

    /// `normalizeRoute(value)`.
    fn normalized(&self) -> Self {
        let value = |v: &Option<String>| v.as_deref().and_then(route_value);
        Self {
            provider_id: value(&self.provider_id),
            model_id: value(&self.model_id),
            variant: value(&self.variant),
            effort: value(&self.effort),
            mode: value(&self.mode),
        }
    }

    /// `{ ...current, ...patch }` for the fields `patch` sets; `Some(None)`
    /// clears one (`undefined`).
    pub fn merged(&self, patch: &AgentRoutePatch) -> Self {
        let pick = |current: &Option<String>, next: &Option<Option<String>>| match next {
            Some(value) => value.clone(),
            None => current.clone(),
        };
        Self {
            provider_id: pick(&self.provider_id, &patch.provider_id),
            model_id: pick(&self.model_id, &patch.model_id),
            variant: pick(&self.variant, &patch.variant),
            effort: pick(&self.effort, &patch.effort),
            mode: pick(&self.mode, &patch.mode),
        }
    }
}

/// `Partial<AgentRoutePreference>`: an absent field keeps its value.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct AgentRoutePatch {
    pub provider_id: Option<Option<String>>,
    pub model_id: Option<Option<String>>,
    pub variant: Option<Option<String>>,
    pub effort: Option<Option<String>>,
    pub mode: Option<Option<String>>,
}

impl AgentRoutePatch {
    /// The whole route as a patch (`onPreferredRouteChange(route)`).
    pub fn replacing(route: &AgentRoutePreference) -> Self {
        Self {
            provider_id: Some(route.provider_id.clone()),
            model_id: Some(route.model_id.clone()),
            variant: Some(route.variant.clone()),
            effort: Some(route.effort.clone()),
            mode: Some(route.mode.clone()),
        }
    }
}

/// `AgentRoutingPreferences`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AgentRoutingPreferences {
    pub version: u32,
    pub selected_runtime_id: Option<String>,
    pub routes: BTreeMap<String, AgentRoutePreference>,
}

impl Default for AgentRoutingPreferences {
    fn default() -> Self {
        Self {
            version: AGENT_ROUTING_PREFERENCES_VERSION,
            selected_runtime_id: None,
            routes: BTreeMap::new(),
        }
    }
}

/// `runtimeId(value)`: the former WorkBuddy selection is channel-ambiguous,
/// so it requires a fresh explicit choice.
fn runtime_id(value: &str) -> Option<String> {
    let value = value.trim();
    let valid = (2..=40).contains(&value.len())
        && value.as_bytes()[0].is_ascii_lowercase()
        && value
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-');
    (valid && value != "workbuddy").then(|| value.to_string())
}

/// `routeValue(value)`.
fn route_value(value: &str) -> Option<String> {
    let normalized: String = value.trim().chars().take(512).collect();
    (!normalized.is_empty() && !normalized.contains(['\r', '\n', '\0'])).then_some(normalized)
}

impl AgentRoutingPreferences {
    /// `createAgentRoutingPreferences(value)`.
    pub fn normalized(&self) -> Self {
        Self {
            version: AGENT_ROUTING_PREFERENCES_VERSION,
            selected_runtime_id: self.selected_runtime_id.as_deref().and_then(runtime_id),
            routes: self
                .routes
                .iter()
                .take(32)
                .filter_map(|(id, route)| {
                    let route = route.normalized();
                    Some((runtime_id(id)?, route)).filter(|(_, r)| !r.is_empty())
                })
                .collect(),
        }
    }

    /// `parseAgentRoutingPreferences(value, { legacyRuntimeId, legacyModelId })`.
    pub fn parse(
        value: Option<&str>,
        legacy_runtime: Option<&str>,
        legacy_model: Option<&str>,
    ) -> Self {
        let parsed = value.and_then(|v| serde_json::from_str::<Value>(v).ok());
        if let Some(parsed) = parsed.as_ref() {
            if parsed["version"] == AGENT_ROUTING_PREFERENCES_VERSION
                && let Ok(preferences) = serde_json::from_value::<Self>(parsed.clone())
            {
                return preferences.normalized();
            }
            // Version 1 could be written after the old controller silently
            // selected its registry default. Keep scoped routes, but require
            // a fresh choice.
            if parsed["version"] == 1 {
                let routes = serde_json::from_value(parsed["routes"].clone()).unwrap_or_default();
                return Self {
                    routes,
                    ..Self::default()
                }
                .normalized();
            }
        }
        // The legacy key was also written by the old implicit-default flow,
        // so it cannot prove that the user chose this Agent. Preserve only
        // its route.
        let mut routes = BTreeMap::new();
        if let (Some(runtime), Some(model)) = (
            legacy_runtime.and_then(runtime_id),
            legacy_model.and_then(route_value),
        ) {
            routes.insert(
                runtime,
                AgentRoutePreference {
                    model_id: Some(model),
                    ..Default::default()
                },
            );
        }
        Self {
            routes,
            ..Self::default()
        }
        .normalized()
    }

    /// `updateAgentRoutePreference(preferences, runtime, patch)`.
    pub fn update_route(&self, runtime: &str, patch: &AgentRoutePatch) -> Self {
        let Some(id) = runtime_id(runtime) else {
            return self.normalized();
        };
        let current = self.routes.get(&id).cloned().unwrap_or_default();
        let route = current.merged(patch).normalized();
        if route == current {
            return self.clone();
        }
        let mut next = self.clone();
        if route.is_empty() {
            next.routes.remove(&id);
        } else {
            next.routes.insert(id, route);
        }
        next.normalized()
    }

    /// `selectAgentRuntime(preferences, runtime)`.
    pub fn select_runtime(&self, runtime: Option<&str>) -> Self {
        Self {
            selected_runtime_id: runtime.and_then(runtime_id),
            ..self.clone()
        }
        .normalized()
    }

    /// `setAgentPreferredRoute(patch)`: the selected runtime's route.
    pub fn set_preferred_route(&self, patch: &AgentRoutePatch) -> Self {
        match self.selected_runtime_id.clone() {
            Some(runtime) => self.update_route(&runtime, patch),
            None => self.clone(),
        }
    }

    /// `selectAgentPreferredRoute(state)`.
    pub fn preferred_route(&self) -> AgentRoutePreference {
        self.selected_runtime_id
            .as_ref()
            .and_then(|id| self.routes.get(id))
            .cloned()
            .unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn parses_versions_and_migrates_only_the_legacy_route() {
        let v2 = r#"{"version":2,"selectedRuntimeId":"codex","routes":{"codex":{"modelId":" gpt-5 ","effort":"high"},"BAD":{"modelId":"x"},"pi":{}}}"#;
        let parsed = AgentRoutingPreferences::parse(Some(v2), None, None);
        assert_eq!(parsed.selected_runtime_id.as_deref(), Some("codex"));
        assert_eq!(parsed.routes.len(), 1);
        assert_eq!(parsed.routes["codex"].model_id.as_deref(), Some("gpt-5"));
        let v1 =
            r#"{"version":1,"selectedRuntimeId":"codex","routes":{"claude":{"modelId":"sonnet"}}}"#;
        let parsed = AgentRoutingPreferences::parse(Some(v1), None, None);
        assert_eq!(parsed.selected_runtime_id, None);
        assert_eq!(parsed.routes["claude"].model_id.as_deref(), Some("sonnet"));
        let legacy = AgentRoutingPreferences::parse(None, Some("codex"), Some("gpt-5"));
        assert_eq!(legacy.selected_runtime_id, None);
        assert_eq!(legacy.routes["codex"].model_id.as_deref(), Some("gpt-5"));
        assert_eq!(
            AgentRoutingPreferences::parse(None, Some("workbuddy"), Some("m"))
                .routes
                .len(),
            0
        );
    }

    #[test]
    fn routes_follow_the_selected_runtime_and_empty_routes_are_dropped() {
        let preferences = AgentRoutingPreferences::default().select_runtime(Some("codex"));
        let next = preferences.set_preferred_route(&AgentRoutePatch {
            model_id: Some(Some("gpt-5".into())),
            effort: Some(Some("high".into())),
            ..Default::default()
        });
        assert_eq!(next.preferred_route().effort.as_deref(), Some("high"));
        let cleared =
            next.set_preferred_route(&AgentRoutePatch::replacing(&AgentRoutePreference::default()));
        assert!(cleared.routes.is_empty());
        assert_eq!(
            AgentRoutingPreferences::default().set_preferred_route(&AgentRoutePatch::default()),
            AgentRoutingPreferences::default()
        );
        assert_eq!(
            preferences
                .select_runtime(Some("workbuddy"))
                .selected_runtime_id,
            None
        );
    }
}
