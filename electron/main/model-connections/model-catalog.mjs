import { modelEntry } from "./drivers/shared.mjs";

export function emptyModelCatalog(connection) {
  return { connectionId: connection.id, configGeneration: connection.configGeneration, status: "unread", endpoint: "unknown",
    authentication: connection.auth === "none" ? "not-required" : "unknown", observedAt: null, complete: false, models: [], errorCode: null };
}

export function projectModelCatalog(connection, result, observedAt) {
  const models = result.models;
  if (connection.manualModelId && !models.some((model) => model.id === connection.manualModelId)) {
    models.push(modelEntry(connection.manualModelId, { capabilities: { text: "unknown", tools: "unknown", images: "unknown" }, evidence: "user:model-id" }));
  }
  for (const model of models) {
    if (!model.contextWindow && connection.manualContextWindow) {
      model.contextWindow = Math.min(connection.manualContextWindow, model.maxContextWindow ?? connection.manualContextWindow);
      model.evidence += ";user:context-budget";
    }
    const verification = connection.verifications?.[model.id];
    if (verification && verification.securityGeneration === connection.securityGeneration) {
      model.capabilities.text = "supported";
      model.capabilities.tools = "supported";
      model.verifiedAt = verification.at;
      model.evidence += ";puppyone:tool-roundtrip";
    }
  }
  return { ...emptyModelCatalog(connection), status: "ready", endpoint: "reachable", authentication: connection.auth === "none" ? "not-required" : "valid",
    models, complete: result.complete, observedAt };
}
