/** Versioned, conservative JS retention limits. These are not OS memory quotas. */
export const DOCUMENT_HISTORY_POLICY = Object.freeze({
  version: 1,
  maxEntries: 200,
  maxBytes: 8 * 1024 * 1024,
});
