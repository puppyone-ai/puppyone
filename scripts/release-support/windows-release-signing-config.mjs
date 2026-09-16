export function configureWindowsReleaseSigning(builderConfig, { publisherNames } = {}) {
  if (!builderConfig || typeof builderConfig !== "object" || Array.isArray(builderConfig)) {
    throw new Error("Electron Builder configuration must be an object.");
  }
  if (!builderConfig.win || typeof builderConfig.win !== "object" || Array.isArray(builderConfig.win)) {
    throw new Error("Electron Builder configuration does not contain a Windows target.");
  }

  const targets = Array.isArray(builderConfig.win.target)
    ? builderConfig.win.target
    : [builderConfig.win.target];
  if (!targets.some((target) => target === "nsis" || target?.target === "nsis")) {
    throw new Error("Windows release signing can only be configured for an NSIS target.");
  }

  const normalizedPublisherNames = normalizePublisherNames(publisherNames);
  const existingSigntoolOptions = builderConfig.win.signtoolOptions;
  if (
    existingSigntoolOptions != null
    && (typeof existingSigntoolOptions !== "object" || Array.isArray(existingSigntoolOptions))
  ) {
    throw new Error("win.signtoolOptions must be an object.");
  }

  return {
    ...builderConfig,
    win: {
      ...builderConfig.win,
      signtoolOptions: {
        ...(existingSigntoolOptions ?? {}),
        signingHashAlgorithms: ["sha256"],
        publisherName: normalizedPublisherNames,
      },
    },
  };
}

function normalizePublisherNames(values) {
  const candidates = Array.isArray(values) ? values : [values];
  const normalized = candidates.map((value) => {
    if (typeof value !== "string") {
      throw new Error("Every Windows publisher name must be a string.");
    }
    const publisherName = value.trim();
    if (!publisherName || /[\r\n\0]/.test(publisherName)) {
      throw new Error("Windows publisher names must be non-empty single-line values.");
    }
    if (!/(?:^|,)\s*CN\s*=/i.test(publisherName)) {
      throw new Error("Windows publisher names must use a full certificate subject containing CN=.");
    }
    return publisherName;
  });
  if (normalized.length === 0) throw new Error("At least one Windows publisher name is required.");
  return [...new Set(normalized)];
}
