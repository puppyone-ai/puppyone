//! `domain/agent-provider-routing.ts`.
use crate::agent::contract::dto::{Capability, InferenceProvider, Model, RuntimeInspection};

fn models(inspection: Option<&RuntimeInspection>) -> &[Model] {
    inspection.map(|i| i.models.as_slice()).unwrap_or_default()
}

/// `listAgentInferenceProviders(inspection)`.
pub fn list_agent_inference_providers(
    inspection: Option<&RuntimeInspection>,
) -> Vec<InferenceProvider> {
    if let Some(providers) = inspection
        .map(|i| i.provider_list())
        .filter(|p| !p.is_empty())
    {
        return providers.to_vec();
    }
    let mut providers: Vec<InferenceProvider> = Vec::new();
    for model in models(inspection) {
        let Some(provider_id) = agent_provider_id_for_model(model) else {
            continue;
        };
        let display_name = model
            .description
            .split(" · ")
            .next()
            .filter(|n| !n.is_empty())
            .unwrap_or(&provider_id)
            .to_string();
        match providers.iter_mut().find(|p| p.id == provider_id) {
            Some(current) => {
                let count = current.model_count + 1.;
                *current = InferenceProvider {
                    id: provider_id,
                    display_name,
                    model_count: count,
                    ..InferenceProvider::default()
                };
            }
            None => providers.push(InferenceProvider {
                id: provider_id,
                display_name,
                model_count: 1.,
                ..InferenceProvider::default()
            }),
        }
    }
    providers
}

/// `listAgentModelsForProvider(inspection, providerId)`.
pub fn list_agent_models_for_provider<'a>(
    inspection: Option<&'a RuntimeInspection>,
    provider_id: Option<&str>,
) -> Vec<&'a Model> {
    let models = models(inspection);
    match provider_id.filter(|id| !id.is_empty()) {
        None => models.iter().collect(),
        Some(provider_id) => models
            .iter()
            .filter(|model| agent_provider_id_for_model(model).as_deref() == Some(provider_id))
            .collect(),
    }
}

/// `chooseAgentProvider(inspection, current, model)`.
pub fn choose_agent_provider(
    inspection: Option<&RuntimeInspection>,
    current: Option<&str>,
    model: Option<&str>,
) -> Option<String> {
    let providers = list_agent_inference_providers(inspection);
    let has = |id: &str| providers.iter().any(|p| p.id == id);
    if let Some(provider) = model.and_then(agent_provider_id_for_selection)
        && has(&provider)
    {
        return Some(provider);
    }
    if let Some(current) = current.filter(|c| !c.is_empty() && has(c)) {
        return Some(current.to_string());
    }
    (providers.len() == 1).then(|| providers[0].id.clone())
}

/// `chooseAgentModel(inspection, current, providerId)`.
pub fn choose_agent_model(
    inspection: Option<&RuntimeInspection>,
    current: Option<&str>,
    provider_id: Option<&str>,
) -> Option<String> {
    let models = list_agent_models_for_provider(inspection, provider_id);
    let current = current.filter(|c| !c.is_empty());
    if let Some(current) = current
        && models.iter().any(|m| m.model == current)
    {
        return Some(current.to_string());
    }
    let model_connections = inspection.is_some_and(|i| i.capability(Capability::ModelConnections));
    // An unavailable app-managed route must not silently become a different endpoint or paid model.
    if model_connections && let Some(current) = current {
        return Some(current.to_string());
    }
    if model_connections {
        let defaults: Vec<&&Model> = models.iter().filter(|m| m.is_default).collect();
        return (defaults.len() == 1).then(|| defaults[0].model.clone());
    }
    // The native backend owns catalog ordering. Keep the first advertised model
    // as the deterministic blank-composer default; an explicit user choice is
    // retained only while it remains valid for this backend/provider.
    models
        .first()
        .map(|m| m.model.clone())
        .filter(|m| !m.is_empty())
}

/// `agentProviderIdForModel(model)` of a model DTO.
pub fn agent_provider_id_for_model(model: &Model) -> Option<String> {
    if let Some(provider) = model.provider_id.as_deref().filter(|p| !p.is_empty()) {
        return Some(provider.to_string());
    }
    agent_provider_id_for_selection(&model.model)
}

/// `agentProviderIdForModel(selection)` of a selection string
/// (`provider/model`).
pub fn agent_provider_id_for_selection(selection: &str) -> Option<String> {
    match selection.find('/') {
        Some(slash) if slash > 0 => Some(selection[..slash].to_string()),
        _ => None,
    }
}
