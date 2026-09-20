const counter = (value) => Number.isSafeInteger(value) && value >= 0;

/** Only server-owned customer amounts enter renderer state. */
export function parseManagedUsage(value, reservationId) {
  if (value?.reservation_id !== reservationId || typeof value.model_id !== "string"
    || value.model_id.length > 200 || !["reserved", "running", "uncertain", "manual_review", "released", "settled"].includes(value.status)) return null;
  const settled = value.status === "settled";
  if (settled && (!counter(value.charged_micro_usd) || !value.usage
    || ![value.usage.input_tokens, value.usage.cached_tokens, value.usage.output_tokens].every(counter)
    || value.usage.cached_tokens > value.usage.input_tokens)) return null;
  return { reservationId, modelId: value.model_id,
    status: settled ? "settled" : value.status === "released" ? "released" : "pending",
    chargedMicroUsd: settled ? value.charged_micro_usd : null,
    priceBookId: typeof value.price_book_id === "string" ? value.price_book_id : null,
    inputTokens: settled ? value.usage.input_tokens : null,
    cachedTokens: settled ? value.usage.cached_tokens : null,
    outputTokens: settled ? value.usage.output_tokens : null };
}

export function managedPrices(catalog) {
  return (catalog?.models ?? []).flatMap((model) => {
    const rates = model.pricing;
    if (!rates || ![rates.input_micro_usd_per_million, rates.cached_input_micro_usd_per_million,
      rates.output_micro_usd_per_million].every(counter)) return [];
    return [{ modelId: model.id, name: model.name,
      inputMicroUsdPerMillion: rates.input_micro_usd_per_million,
      cachedMicroUsdPerMillion: rates.cached_input_micro_usd_per_million,
      outputMicroUsdPerMillion: rates.output_micro_usd_per_million }];
  });
}
