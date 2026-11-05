//! `domain/agent-provider-routing.ts`.
use serde_json::{Value, json};

fn models(inspection: Option<&Value>) -> Vec<Value> {
    inspection
        .and_then(|i| i["models"].as_array())
        .cloned()
        .unwrap_or_default()
}

/// `listAgentInferenceProviders(inspection)`.
pub fn list_agent_inference_providers(inspection: Option<&Value>) -> Vec<Value> {
    if let Some(providers) = inspection
        .and_then(|i| i["providers"].as_array())
        .filter(|p| !p.is_empty())
    {
        return providers.clone();
    }
    let mut providers: Vec<Value> = Vec::new();
    for model in models(inspection) {
        let Some(provider_id) = agent_provider_id_for_model(Some(&model)) else {
            continue;
        };
        let description = model["description"].as_str().unwrap_or_default();
        let display_name = description
            .split(" · ")
            .next()
            .filter(|n| !n.is_empty())
            .unwrap_or(&provider_id);
        match providers
            .iter_mut()
            .find(|p| p["id"] == provider_id.as_str())
        {
            Some(current) => {
                let count = current["modelCount"].as_i64().unwrap_or(0) + 1;
                *current =
                    json!({ "id": provider_id, "displayName": display_name, "modelCount": count });
            }
            None => providers
                .push(json!({ "id": provider_id, "displayName": display_name, "modelCount": 1 })),
        }
    }
    providers
}

/// `listAgentModelsForProvider(inspection, providerId)`.
pub fn list_agent_models_for_provider(
    inspection: Option<&Value>,
    provider_id: Option<&str>,
) -> Vec<Value> {
    let models = models(inspection);
    match provider_id.filter(|id| !id.is_empty()) {
        None => models,
        Some(provider_id) => models
            .into_iter()
            .filter(|model| {
                agent_provider_id_for_model(Some(model)).as_deref() == Some(provider_id)
            })
            .collect(),
    }
}

/// `chooseAgentProvider(inspection, current, model)`.
pub fn choose_agent_provider(
    inspection: Option<&Value>,
    current: Option<&str>,
    model: Option<&str>,
) -> Option<String> {
    let providers = list_agent_inference_providers(inspection);
    let has = |id: &str| providers.iter().any(|p| p["id"] == id);
    if let Some(provider) = model.and_then(|m| agent_provider_id_for_model(Some(&Value::from(m))))
        && has(&provider)
    {
        return Some(provider);
    }
    if let Some(current) = current.filter(|c| !c.is_empty() && has(c)) {
        return Some(current.to_string());
    }
    (providers.len() == 1)
        .then(|| providers[0]["id"].as_str().map(str::to_string))
        .flatten()
}

/// `chooseAgentModel(inspection, current, providerId)`.
pub fn choose_agent_model(
    inspection: Option<&Value>,
    current: Option<&str>,
    provider_id: Option<&str>,
) -> Option<String> {
    let models = list_agent_models_for_provider(inspection, provider_id);
    let current = current.filter(|c| !c.is_empty());
    if let Some(current) = current
        && models.iter().any(|m| m["model"] == current)
    {
        return Some(current.to_string());
    }
    let model_connections = inspection.is_some_and(|i| {
        crate::agent::contract::js::truthy(&i["capabilities"]["modelConnections"])
    });
    // An unavailable app-managed route must not silently become a different endpoint or paid model.
    if model_connections && let Some(current) = current {
        return Some(current.to_string());
    }
    if model_connections {
        let defaults: Vec<&Value> = models.iter().filter(|m| m["isDefault"] == true).collect();
        return (defaults.len() == 1)
            .then(|| defaults[0]["model"].as_str().map(str::to_string))
            .flatten();
    }
    // The native backend owns catalog ordering. Keep the first advertised model
    // as the deterministic blank-composer default; an explicit user choice is
    // retained only while it remains valid for this backend/provider.
    models
        .first()
        .and_then(|m| m["model"].as_str())
        .filter(|m| !m.is_empty())
        .map(str::to_string)
}

/// `agentProviderIdForModel(model)`: a model DTO or a selection string.
pub fn agent_provider_id_for_model(model: Option<&Value>) -> Option<String> {
    let model = model?;
    let selection = match model {
        Value::String(selection) if !selection.is_empty() => selection.as_str(),
        Value::Object(_) => {
            if let Some(provider) = model["providerId"].as_str().filter(|p| !p.is_empty()) {
                return Some(provider.to_string());
            }
            model["model"].as_str().unwrap_or_default()
        }
        _ => return None,
    };
    match selection.find('/') {
        Some(slash) if slash > 0 => Some(selection[..slash].to_string()),
        _ => None,
    }
}
