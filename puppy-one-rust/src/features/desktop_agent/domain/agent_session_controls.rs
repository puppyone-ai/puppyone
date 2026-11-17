//! `domain/agent-session-controls.ts`: a runtime's negotiated capability
//! surface projected into Renderer controls. Runtime identity never
//! participates: a new Harness gets the same controls as soon as its
//! adapter reports the corresponding normalized capabilities.
use crate::agent::contract::dto::{Capability, RuntimeInspection};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AgentSessionControlId {
    Model,
    Effort,
    Mode,
}

#[derive(Clone, Debug, PartialEq, Default)]
pub struct AgentSessionControlOption {
    pub value: String,
    pub label: String,
    pub description: Option<String>,
    pub keywords: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct AgentSessionControl {
    pub id: AgentSessionControlId,
    pub value: Option<String>,
    pub options: Vec<AgentSessionControlOption>,
}

/// `AgentSessionControlSelection`.
#[derive(Clone, Copy, Debug, Default)]
pub struct AgentSessionControlSelection<'a> {
    pub selected_model: Option<&'a str>,
    pub selected_effort: Option<&'a str>,
    pub selected_mode: Option<&'a str>,
}

fn non_empty(value: &str) -> Option<String> {
    (!value.is_empty()).then(|| value.to_string())
}

/// `deriveAgentSessionControls(inspection, selection)`.
pub fn derive_agent_session_controls(
    inspection: Option<&RuntimeInspection>,
    selection: AgentSessionControlSelection,
) -> Vec<AgentSessionControl> {
    let Some(inspection) = inspection.filter(|i| i.capabilities.is_some()) else {
        return Vec::new();
    };
    let models = &inspection.models;
    let mut controls = Vec::new();
    if inspection.capability(Capability::ModelSelection) && !models.is_empty() {
        controls.push(AgentSessionControl {
            id: AgentSessionControlId::Model,
            value: selection.selected_model.map(str::to_string),
            options: models
                .iter()
                .map(|model| AgentSessionControlOption {
                    value: model.model.clone(),
                    label: model.display_name.clone(),
                    description: non_empty(&model.description),
                    keywords: Some(format!(
                        "{} {} {}",
                        model.id,
                        model.model,
                        model.variants.as_deref().unwrap_or_default().join(" ")
                    )),
                })
                .collect(),
        });
    }
    let selected_model = models
        .iter()
        .find(|model| selection.selected_model == Some(model.model.as_str()));
    if let Some(variants) = selected_model
        .and_then(|model| model.variants.as_ref())
        .filter(|v| !v.is_empty())
    {
        controls.push(AgentSessionControl {
            id: AgentSessionControlId::Effort,
            value: selection.selected_effort.map(str::to_string),
            options: variants
                .iter()
                .map(|effort| AgentSessionControlOption {
                    value: effort.clone(),
                    label: effort.clone(),
                    ..Default::default()
                })
                .collect(),
        });
    }
    if inspection.capability(Capability::ModeSelection)
        && let Some(modes) = inspection.modes.as_ref().filter(|m| !m.is_empty())
    {
        controls.push(AgentSessionControl {
            id: AgentSessionControlId::Mode,
            value: selection.selected_mode.map(str::to_string),
            options: modes
                .iter()
                .map(|mode| AgentSessionControlOption {
                    value: mode.id.clone(),
                    label: mode.display_name.clone(),
                    description: non_empty(&mode.description),
                    keywords: Some(format!("{} {}", mode.id, mode.display_name)),
                })
                .collect(),
        });
    }
    controls
}
