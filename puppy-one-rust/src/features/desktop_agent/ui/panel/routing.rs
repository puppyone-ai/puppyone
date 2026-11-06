//! `useAgentRoutingPreferences.ts`: applies and records routing without
//! leaking one runtime's model into another.
use super::{AgentChatPanelEvent, AgentChatTabPanel};
use crate::features::desktop_agent::application::agent_controller_state::AgentControllerState;
use crate::features::desktop_agent::domain::agent_session_controls::AgentSessionControlId;
use crate::features::settings::agent_routing_preferences::{AgentRoutePatch, AgentRoutePreference};
use gpui::Context;
use serde_json::Value;

/// What the Workbench item passes in (`preferredRuntimeId`, `preferredRoute`).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct AgentRouting {
    pub preferred_runtime_id: Option<String>,
    pub preferred_route: AgentRoutePreference,
}

/// The preferences not yet applied to a session-less controller.
#[derive(Clone, Debug, Default, PartialEq)]
pub(super) struct PendingPreferences {
    preferred_model_id: Option<String>,
    preferred_effort: Option<String>,
    pub model: bool,
    pub mode: bool,
    pub effort: bool,
}

impl PendingPreferences {
    /// `preferencesReady`.
    pub fn ready(&self) -> bool {
        !self.model && !self.mode && !self.effort
    }
}

fn some(value: &Option<String>) -> Option<&str> {
    value.as_deref().filter(|v| !v.is_empty())
}

/// The pending flags (`modelPreferencePending`, …).
pub(super) fn pending_preferences(
    state: &AgentControllerState,
    runtime_models: &[Value],
    routing: &AgentRouting,
) -> PendingPreferences {
    let route = &routing.preferred_route;
    let preferred_runtime = routing.preferred_runtime_id.as_deref();
    let selected_runtime = state.selected_runtime_id.as_deref();
    let inspection = state.inspection.as_ref();
    let same_runtime = selected_runtime.is_some() && selected_runtime == preferred_runtime;
    let preferred_model_id = some(&route.model_id).map(str::to_string);
    let model_available = preferred_model_id.as_deref().is_some_and(|model| {
        same_runtime
            && inspection.is_some_and(|i| {
                i["selectedRuntimeId"].as_str() == selected_runtime
                    && i["models"]
                        .as_array()
                        .is_some_and(|models| models.iter().any(|m| m["model"] == model))
            })
    });
    let model = state.session.is_none()
        && model_available
        && state.selected_model.as_deref() != preferred_model_id.as_deref();
    let mode_available = some(&route.mode).is_some_and(|mode| {
        same_runtime
            && inspection.is_some_and(|i| {
                i["modes"]
                    .as_array()
                    .is_some_and(|modes| modes.iter().any(|m| m["id"] == mode))
            })
    });
    let mode = state.session.is_none()
        && mode_available
        && state.selected_mode.as_deref() != some(&route.mode);
    let selected_profile = runtime_models
        .iter()
        .find(|m| m["model"].as_str() == state.selected_model.as_deref());
    let preferred_effort = some(&route.effort)
        .or(some(&route.variant))
        .map(str::to_string);
    let effort_available = preferred_effort.as_deref().is_some_and(|effort| {
        selected_profile.is_some_and(|profile| {
            profile["variants"]
                .as_array()
                .is_some_and(|variants| variants.iter().any(|v| v == effort))
        })
    });
    let effort = state.session.is_none()
        && effort_available
        && state.selected_effort.as_deref() != preferred_effort.as_deref();
    PendingPreferences {
        preferred_model_id,
        preferred_effort,
        model,
        mode,
        effort,
    }
}

/// `routeChanged(left, right)`.
fn route_changed(left: &AgentRoutePreference, right: &AgentRoutePreference) -> bool {
    left != right
}

impl AgentChatTabPanel {
    /// `preferredRuntimeId`, `preferredRoute` from the Workbench item.
    pub fn set_routing(&mut self, routing: AgentRouting, cx: &mut Context<Self>) {
        if self.routing == routing {
            return;
        }
        self.routing = routing;
        self.apply_routing_preferences(cx);
        cx.notify();
    }

    /// The hook's effects for the command target.
    pub(super) fn apply_routing_preferences(&mut self, cx: &mut Context<Self>) {
        if !self.command_target {
            return;
        }
        let state = self.state();
        let runtime = self.runtime_view(&state);
        let pending = pending_preferences(&state, &runtime.runtime_models, &self.routing);
        let preferred_runtime = self.routing.preferred_runtime_id.clone();
        if state.initialized {
            match state.selected_runtime_id.as_deref() {
                Some(selected) if Some(selected) != preferred_runtime.as_deref() => {
                    cx.emit(AgentChatPanelEvent::PreferredRuntime(Some(
                        selected.to_string(),
                    )));
                }
                None if preferred_runtime.is_some() => {
                    let registered = state
                        .inspection
                        .as_ref()
                        .and_then(|i| i["runtimes"].as_array())
                        .is_some_and(|runtimes| {
                            runtimes.iter().any(|entry| {
                                entry["descriptor"]["id"].as_str() == preferred_runtime.as_deref()
                            })
                        });
                    if state.inspection.is_some() && !registered {
                        cx.emit(AgentChatPanelEvent::PreferredRuntime(None));
                    }
                }
                _ => {}
            }
        }
        if pending.model
            && let Some(model) = pending.preferred_model_id.as_deref()
        {
            self.controller.select_model(Some(model));
        }
        if pending.mode
            && let Some(mode) = self.routing.preferred_route.mode.clone()
        {
            self.controller.select_mode(Some(&mode));
        }
        if pending.effort
            && let Some(effort) = pending.preferred_effort.as_deref()
        {
            self.controller.select_effort(Some(effort));
        }
        if state.initialized
            && state.selected_runtime_id.is_some()
            && state.selected_runtime_id == preferred_runtime
            && pending.ready()
        {
            let current = &self.routing.preferred_route;
            let next = AgentRoutePreference {
                provider_id: state.selected_provider_id.clone(),
                model_id: state.selected_model.clone(),
                effort: state.selected_effort.clone(),
                mode: state.selected_mode.clone(),
                variant: current.variant.clone(),
            };
            if route_changed(current, &next) {
                cx.emit(AgentChatPanelEvent::PreferredRoute(AgentRoutePatch {
                    provider_id: Some(next.provider_id),
                    model_id: Some(next.model_id),
                    effort: Some(next.effort),
                    mode: Some(next.mode),
                    variant: None,
                }));
            }
        }
    }

    /// `selectSessionControl(id, value)` with the route it records.
    pub(super) fn select_routed_control(
        &mut self,
        id: AgentSessionControlId,
        value: String,
        cx: &mut Context<Self>,
    ) {
        let state = self.state();
        let preferred = self.routing.preferred_route.clone();
        let route = match id {
            AgentSessionControlId::Model => {
                self.controller.select_model(Some(&value));
                let runtime = self.runtime_view(&state);
                let selected = runtime
                    .runtime_models
                    .iter()
                    .find(|m| m["model"] == value.as_str());
                let variants = |model: Option<&Value>| -> Vec<String> {
                    model
                        .and_then(|m| m["variants"].as_array())
                        .map(|v| {
                            v.iter()
                                .filter_map(Value::as_str)
                                .map(str::to_string)
                                .collect()
                        })
                        .unwrap_or_default()
                };
                let offered = variants(selected);
                let effort = if state.selected_model.as_deref() == Some(value.as_str())
                    && state
                        .selected_effort
                        .as_ref()
                        .is_some_and(|e| offered.contains(e))
                {
                    state.selected_effort.clone()
                } else {
                    selected
                        .and_then(|m| m["defaultVariant"].as_str())
                        .map(str::to_string)
                        .or_else(|| offered.first().cloned())
                };
                AgentRoutePreference {
                    provider_id: selected
                        .and_then(|m| m["providerId"].as_str())
                        .map(str::to_string),
                    model_id: Some(value),
                    variant: None,
                    effort,
                    ..preferred
                }
            }
            AgentSessionControlId::Effort => {
                self.controller.select_effort(Some(&value));
                AgentRoutePreference {
                    provider_id: state.selected_provider_id.clone(),
                    model_id: state.selected_model.clone(),
                    variant: None,
                    effort: Some(value),
                    ..preferred
                }
            }
            AgentSessionControlId::Mode => {
                self.controller.select_mode(Some(&value));
                AgentRoutePreference {
                    provider_id: state.selected_provider_id.clone(),
                    model_id: state.selected_model.clone(),
                    effort: state.selected_effort.clone(),
                    mode: Some(value),
                    ..preferred
                }
            }
        };
        cx.emit(AgentChatPanelEvent::PreferredRoute(
            AgentRoutePatch::replacing(&route),
        ));
    }

    /// `selectRuntime(runtimeId)`: a switch that happened becomes the
    /// preferred Agent.
    pub(super) fn select_routed_runtime(&mut self, runtime_id: String, cx: &mut Context<Self>) {
        let switched = self.controller.select_runtime(&runtime_id);
        cx.spawn(async move |this, cx| {
            if switched.await {
                this.update(cx, |_, cx| {
                    cx.emit(AgentChatPanelEvent::PreferredRuntime(Some(runtime_id)))
                })
                .ok();
            }
        })
        .detach();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    use serde_json::json;

    #[test]
    fn a_preference_applies_only_to_its_session_less_runtime() {
        let mut state = AgentControllerState {
            selected_runtime_id: Some("codex".into()),
            selected_model: Some("codex/a".into()),
            inspection: Some(json!({
                "selectedRuntimeId": "codex",
                "models": [{ "model": "codex/a" }, { "model": "codex/b", "variants": ["low", "high"] }],
                "modes": [{ "id": "plan" }],
            })),
            ..Default::default()
        };
        let models = state.inspection.as_ref().unwrap()["models"]
            .as_array()
            .unwrap()
            .clone();
        let routing = AgentRouting {
            preferred_runtime_id: Some("codex".into()),
            preferred_route: AgentRoutePreference {
                model_id: Some("codex/b".into()),
                effort: Some("high".into()),
                mode: Some("plan".into()),
                ..Default::default()
            },
        };
        let pending = pending_preferences(&state, &models, &routing);
        assert!(pending.model && pending.mode && !pending.effort);
        state.selected_model = Some("codex/b".into());
        let pending = pending_preferences(&state, &models, &routing);
        assert!(!pending.model && pending.effort);
        let other = AgentRouting {
            preferred_runtime_id: Some("claude".into()),
            ..routing.clone()
        };
        let elsewhere = pending_preferences(&state, &models, &other);
        assert!(
            !elsewhere.model && !elsewhere.mode,
            "another runtime's route is not applied"
        );
        state.session = Some(json!({ "id": "s" }));
        assert!(pending_preferences(&state, &models, &routing).ready());
    }
}
