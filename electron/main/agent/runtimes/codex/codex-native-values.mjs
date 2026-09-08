

export function normalizeProviderSession(result) {
  return {
    providerSessionId: result.thread.id,
    title: result.thread.name || result.thread.preview || "Codex session",
    model: result.model || null,
    createdAt: toIsoFromSeconds(result.thread.createdAt),
    updatedAt: toIsoFromSeconds(result.thread.updatedAt),
  };
}

export function normalizeAccount(result) {
  const account = result?.account;
  if (!account || typeof account !== "object") {
    const requiresOpenaiAuth = Boolean(result?.requiresOpenaiAuth);
    return {
      account: null,
      requiresOpenaiAuth,
      ...(requiresOpenaiAuth ? { setupReason: "authentication-required" } : {}),
    };
  }
  return {
    account: {
      type: typeof account.type === "string" ? account.type : "unknown",
      email: typeof account.email === "string" ? account.email : null,
      planType: typeof account.planType === "string" ? account.planType : null,
    },
    requiresOpenaiAuth: Boolean(result?.requiresOpenaiAuth),
  };
}

export function normalizeModels(result) {
  if (!Array.isArray(result?.data)) return [];
  return result.data.filter((model) => !model?.hidden).slice(0, 100).map((model) => {
    const variants = Array.isArray(model?.supportedReasoningEfforts)
      ? model.supportedReasoningEfforts
        .map((entry) => normalizeCodexReasoningEffort(entry?.reasoningEffort))
        .filter(Boolean)
        .filter((value, index, values) => values.indexOf(value) === index)
        .slice(0, 20)
      : [];
    const advertisedDefault = normalizeCodexReasoningEffort(model?.defaultReasoningEffort);
    return {
      id: String(model.id ?? model.model ?? ""),
      model: String(model.model ?? model.id ?? ""),
      displayName: String(model.displayName ?? model.model ?? model.id ?? "Codex"),
      description: String(model.description ?? ""),
      isDefault: Boolean(model.isDefault),
      variants,
      defaultVariant: variants.includes(advertisedDefault)
        ? advertisedDefault
        : variants.includes("medium")
          ? "medium"
          : variants[0] ?? null,
    };
  }).filter((model) => model.id);
}

export function normalizeCodexReasoningEffort(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  // Older catalogs/configs used `max`; the app-server wire value is `xhigh`.
  const compatible = normalized === "max" ? "xhigh" : normalized;
  return CODEX_REASONING_EFFORTS.has(compatible) ? compatible : null;
}

export function compatibleReasoningEffort(model, requested = null) {
  if (!model || !Array.isArray(model.variants) || model.variants.length === 0) {
    if (requested) throw new Error("The selected Codex model does not support configurable reasoning effort.");
    return null;
  }
  if (requested) {
    const normalized = normalizeCodexReasoningEffort(requested);
    if (normalized && model.variants.includes(normalized)) return normalized;
    throw new Error("The selected Codex reasoning effort is no longer available for this model.");
  }
  if (model.defaultVariant && model.variants.includes(model.defaultVariant)) return model.defaultVariant;
  return model.variants.includes("medium") ? "medium" : model.variants[0] ?? null;
}

export function isApprovalDecision(value) {
  return ["accept", "acceptForSession", "decline", "cancel"].includes(value);
}

export function normalizeNetworkApprovalContext(value) {
  if (!value || typeof value !== "object") return null;
  const host = typeof value.host === "string" ? value.host.trim() : "";
  const protocol = typeof value.protocol === "string" ? value.protocol.trim() : "";
  if (!host || !protocol) return null;
  return { host: host.slice(0, 512), protocol: protocol.slice(0, 40) };
}

export function normalizeCodexQuestions(value) {
  return (Array.isArray(value) ? value : []).slice(0, 16).map((question, index) => ({
    id: stringOrNull(question?.id) || `question-${index + 1}`,
    header: String(question?.header || `Question ${index + 1}`).slice(0, 160),
    question: String(question?.question || "Input required").slice(0, 2_000),
    multiple: Boolean(question?.multiple || question?.multiSelect),
    custom: question?.custom !== false,
    options: (Array.isArray(question?.options) ? question.options : []).slice(0, 64).map((option) => ({
      label: String(option?.label ?? option ?? "").slice(0, 300),
      description: String(option?.description ?? "").slice(0, 1_000),
    })).filter((option) => option.label),
  }));
}

export function codexQuestionAnswers(questions, answers) {
  return Object.fromEntries(questions.map((question, index) => [
    question.id,
    { answers: (Array.isArray(answers?.[index]) ? answers[index] : []).map((answer) => String(answer).slice(0, 2_000)) },
  ]));
}

export function requireString(value, message) {
  if (typeof value !== "string" || value.length === 0) throw new Error(message);
  return value;
}

export function stringOrNull(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function toIsoFromSeconds(value) {
  return Number.isFinite(value) ? new Date(value * 1000).toISOString() : new Date().toISOString();
}

export function boundedPageSize(value) {
  return Number.isSafeInteger(value) && value > 0 ? Math.min(value, 100) : 50;
}

const CODEX_REASONING_EFFORTS = new Set(["none", "minimal", "low", "medium", "high", "xhigh"]);
