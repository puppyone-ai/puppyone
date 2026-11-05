//! `domain/agent-session-controls.ts`: a runtime's negotiated capability
//! surface projected into Renderer controls. Runtime identity never
//! participates: a new Harness gets the same controls as soon as its
//! adapter reports the corresponding normalized capabilities.
use serde_json::Value;

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

fn text(value: &Value) -> String {
    value.as_str().unwrap_or_default().to_string()
}

fn non_empty(value: &Value) -> Option<String> {
    value.as_str().filter(|v| !v.is_empty()).map(str::to_string)
}

/// `deriveAgentSessionControls(inspection, selection)`.
pub fn derive_agent_session_controls(
    inspection: Option<&Value>,
    selection: AgentSessionControlSelection,
) -> Vec<AgentSessionControl> {
    let Some(inspection) =
        inspection.filter(|i| crate::agent::contract::js::truthy(&i["capabilities"]))
    else {
        return Vec::new();
    };
    let truthy = crate::agent::contract::js::truthy;
    let models = inspection["models"].as_array().cloned().unwrap_or_default();
    let mut controls = Vec::new();
    if truthy(&inspection["capabilities"]["modelSelection"]) && !models.is_empty() {
        controls.push(AgentSessionControl {
            id: AgentSessionControlId::Model,
            value: selection.selected_model.map(str::to_string),
            options: models
                .iter()
                .map(|model| {
                    let variants: Vec<String> = model["variants"]
                        .as_array()
                        .map(|v| {
                            v.iter()
                                .map(|v| match v {
                                    Value::Null => String::new(),
                                    v => crate::agent::contract::js::to_js_string(Some(v)),
                                })
                                .collect()
                        })
                        .unwrap_or_default();
                    AgentSessionControlOption {
                        value: text(&model["model"]),
                        label: text(&model["displayName"]),
                        description: non_empty(&model["description"]),
                        keywords: Some(format!(
                            "{} {} {}",
                            text(&model["id"]),
                            text(&model["model"]),
                            variants.join(" ")
                        )),
                    }
                })
                .collect(),
        });
    }
    let selected_model = models.iter().find(|model| {
        selection
            .selected_model
            .is_some_and(|s| model["model"] == s)
    });
    if let Some(variants) = selected_model
        .and_then(|model| model["variants"].as_array())
        .filter(|v| !v.is_empty())
    {
        controls.push(AgentSessionControl {
            id: AgentSessionControlId::Effort,
            value: selection.selected_effort.map(str::to_string),
            options: variants
                .iter()
                .map(|effort| AgentSessionControlOption {
                    value: text(effort),
                    label: text(effort),
                    ..Default::default()
                })
                .collect(),
        });
    }
    if truthy(&inspection["capabilities"]["modeSelection"])
        && let Some(modes) = inspection["modes"].as_array().filter(|m| !m.is_empty())
    {
        controls.push(AgentSessionControl {
            id: AgentSessionControlId::Mode,
            value: selection.selected_mode.map(str::to_string),
            options: modes
                .iter()
                .map(|mode| AgentSessionControlOption {
                    value: text(&mode["id"]),
                    label: text(&mode["displayName"]),
                    description: non_empty(&mode["description"]),
                    keywords: Some(format!(
                        "{} {}",
                        text(&mode["id"]),
                        text(&mode["displayName"])
                    )),
                })
                .collect(),
        });
    }
    controls
}
