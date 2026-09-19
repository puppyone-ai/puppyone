import type { AgentInferenceProvider, AgentModel, AgentRuntimeInspection } from "./agent-contract";

export function listAgentInferenceProviders(inspection: AgentRuntimeInspection | null): AgentInferenceProvider[] {
  if (inspection?.providers?.length) return inspection.providers;
  const providers = new Map<string, AgentInferenceProvider>();
  for (const model of inspection?.models ?? []) {
    const providerId = agentProviderIdForModel(model);
    if (!providerId) continue;
    const current = providers.get(providerId);
    providers.set(providerId, {
      id: providerId,
      displayName: model.description.split(" · ")[0] || providerId,
      modelCount: (current?.modelCount ?? 0) + 1,
    });
  }
  return Array.from(providers.values());
}

export function listAgentModelsForProvider(inspection: AgentRuntimeInspection | null, providerId: string | null) {
  if (!providerId) return inspection?.models ?? [];
  return (inspection?.models ?? []).filter((model) => agentProviderIdForModel(model) === providerId);
}

export function chooseAgentProvider(
  inspection: AgentRuntimeInspection | null,
  current: string | null,
  model: string | null,
) {
  const providers = listAgentInferenceProviders(inspection);
  const modelProvider = agentProviderIdForModel(model);
  if (modelProvider && providers.some((provider) => provider.id === modelProvider)) return modelProvider;
  if (current && providers.some((provider) => provider.id === current)) return current;
  return providers.length === 1 ? providers[0].id : null;
}

export function chooseAgentModel(
  inspection: AgentRuntimeInspection | null,
  current: string | null,
  providerId: string | null,
) {
  const models = listAgentModelsForProvider(inspection, providerId);
  if (current && models.some((model) => model.model === current)) return current;
  // An unavailable app-managed route must not silently become a different endpoint or paid model.
  if (inspection?.capabilities?.modelConnections && current) return current;
  if (inspection?.capabilities?.modelConnections) {
    const defaults = models.filter((model) => model.isDefault);
    return defaults.length === 1 ? defaults[0].model : null;
  }
  // The native backend owns catalog ordering. Keep the first advertised model
  // as the deterministic blank-composer default; an explicit user choice is
  // retained only while it remains valid for this backend/provider.
  return models[0]?.model || null;
}

export function agentProviderIdForModel(model: AgentModel | string | null | undefined) {
  if (!model) return null;
  if (typeof model !== "string" && model.providerId) return model.providerId;
  const selection = typeof model === "string" ? model : model.model;
  const slash = selection.indexOf("/");
  return slash > 0 ? selection.slice(0, slash) : null;
}
