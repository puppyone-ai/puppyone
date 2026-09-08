

export function normalizeModels(value) {
  return asArray(value).slice(0, 100).map((model, index) => {
    const variants = asArray(model?.supportedEffortLevels)
      .filter((effort) => ["low", "medium", "high", "xhigh", "max"].includes(effort));
    return {
      id: bounded(model?.value, 512),
      model: bounded(model?.value, 512),
      displayName: bounded(model?.displayName, 300) || bounded(model?.value, 300),
      description: bounded(model?.description, 2_000),
      isDefault: index === 0,
      variants,
      defaultVariant: variants.includes("high") ? "high" : variants[0] ?? null,
    };
  }).filter((model) => model.id);
}

export function compatibleClaudeEffort(model, requested) {
  if (!requested) return model?.defaultVariant ?? null;
  if (model?.variants?.includes(requested)) return requested;
  throw new Error("The selected Claude Code reasoning effort is no longer available for this model.");
}

export function normalizeCommands(value) {
  return asArray(value).slice(0, 500).map((command) => ({
    name: bounded(command?.name, 160),
    description: bounded(command?.description, 1_000),
    argumentHint: bounded(command?.argumentHint, 500),
    source: "claude-code",
  })).filter((command) => command.name);
}

export function normalizeAccount(value, models, environment = {}) {
  const account = value && typeof value === "object" ? value : {};
  const hasNativeIdentity = Boolean(
    account.email || account.organization || account.subscriptionType || account.tokenSource
    || account.apiKeySource || account.apiProvider,
  );
  const hasApiKey = Boolean(account.apiKeySource || environment?.ANTHROPIC_API_KEY);
  const supportedCloud = Boolean(account.apiProvider && account.apiProvider !== "firstParty");
  const authenticated = hasApiKey || supportedCloud;
  return {
    account: authenticated ? {
      type: bounded(account.apiProvider, 80) || "claude-code",
      email: bounded(account.email, 300) || null,
      planType: bounded(account.subscriptionType, 160) || null,
    } : null,
    requiresOpenaiAuth: false,
    requiresRuntimeSetup: !authenticated,
    ...(!authenticated ? {
      setupReason: "runtime-setup-required",
      error: hasNativeIdentity && !authenticated
        ? "Claude subscription OAuth cannot be used by a third-party product. Configure an Anthropic API key or a supported cloud provider, then refresh."
        : models.length
          ? "Configure an Anthropic API key or a supported cloud provider for Claude Code, then refresh."
          : "Claude Code authentication and model access are unavailable.",
    } : {}),
  };
}

export function cleanEnvironment(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => typeof entry === "string"));
}

export function humanize(value) {
  const normalized = bounded(value, 160).replace(/[_-]+/g, " ");
  return normalized ? normalized.replace(/\b\w/g, (character) => character.toUpperCase()) : "tool";
}

export function bounded(value, limit) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

export function safeId(value) {
  return typeof value === "string" && /^[A-Za-z0-9:._-]{1,256}$/.test(value) ? value : null;
}

export function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function normalizeDate(value) {
  const date = new Date(Number.isFinite(value) ? value : value || Date.now());
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

export function numericCursor(value) {
  if (value == null || value === "") return 0;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

export function boundedPageSize(value) {
  return Number.isSafeInteger(value) && value > 0 ? Math.min(value, 100) : 50;
}
