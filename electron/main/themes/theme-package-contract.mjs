const THEME_TARGETS = Object.freeze(["application", "typography", "markdown", "csv"]);
const THEME_COLOR_MODES = Object.freeze(["light", "dark"]);
const targetSet = new Set(THEME_TARGETS);
const colorModeSet = new Set(THEME_COLOR_MODES);
const themeIdPattern = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*){2,}$/;
const reservedBuiltinThemeIdPattern = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/;
const rootThemeIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const entrypointPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*\.css$/;

export { THEME_COLOR_MODES, THEME_TARGETS };

export function parseThemeManifest(value, { allowReservedBuiltinId = false } = {}) {
  if (!isRecord(value)) throw new TypeError("Theme manifest must be an object.");
  if (value.schemaVersion !== 1) {
    throw new TypeError("Unsupported theme schema version; expected version 1.");
  }

  const id = requireString(value.id, "Theme id is required.");
  if (
    !themeIdPattern.test(id)
    && !(allowReservedBuiltinId && reservedBuiltinThemeIdPattern.test(id))
  ) {
    throw new TypeError("Theme id must be a reverse-domain identifier using lowercase letters, digits, dots, and hyphens.");
  }

  const name = requireString(value.name, "Theme name is required.");
  const version = requireString(value.version, "Theme version is required.");
  const author = value.author === undefined
    ? undefined
    : requireString(value.author, "Theme author must be a non-empty string.");
  const modes = parseUniqueList(value.modes, colorModeSet, "Unsupported theme color mode");
  const targets = parseUniqueList(value.targets, targetSet, "Unsupported theme target");
  const compatibleRootThemeIds = parseRootThemeIds(value.compatibleRootThemeIds);

  if (!isRecord(value.entrypoints)) {
    throw new TypeError("Theme entrypoints must be an object.");
  }

  const entrypointTargets = Object.keys(value.entrypoints);
  for (const target of entrypointTargets) {
    if (!targetSet.has(target)) throw new TypeError(`Unsupported theme target: ${target}.`);
    const entrypoint = value.entrypoints[target];
    if (typeof entrypoint !== "string" || !entrypointPattern.test(entrypoint)) {
      throw new TypeError("Theme entrypoint must be a direct relative CSS filename.");
    }
  }

  if (
    targets.length !== entrypointTargets.length
    || targets.some((target) => !entrypointTargets.includes(target))
  ) {
    throw new TypeError("Theme targets and entrypoints must match.");
  }

  const entrypoints = Object.freeze(Object.fromEntries(
    targets.map((target) => [target, value.entrypoints[target]]),
  ));
  const manifest = {
    schemaVersion: 1,
    contractVersion: 1,
    id,
    name,
    version,
    ...(author === undefined ? {} : { author }),
    modes: Object.freeze([...modes]),
    targets: Object.freeze([...targets]),
    compatibleRootThemeIds: Object.freeze(compatibleRootThemeIds),
    entrypoints,
  };
  return Object.freeze(manifest);
}

function parseRootThemeIds(value) {
  if (value === undefined) return ["default"];
  if (
    !Array.isArray(value)
    || value.length === 0
    || value.some((id) => typeof id !== "string" || !rootThemeIdPattern.test(id))
    || new Set(value).size !== value.length
  ) {
    throw new TypeError("compatibleRootThemeIds must contain unique Root Theme ids.");
  }
  return [...value];
}

function parseUniqueList(value, allowed, errorPrefix) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError(`${errorPrefix}: at least one value is required.`);
  }
  const normalized = [];
  for (const item of value) {
    if (typeof item !== "string" || !allowed.has(item)) {
      throw new TypeError(`${errorPrefix}: ${String(item)}.`);
    }
    if (normalized.includes(item)) {
      throw new TypeError(`${errorPrefix}: duplicate ${item}.`);
    }
    normalized.push(item);
  }
  return normalized;
}

function requireString(value, message) {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 200) {
    throw new TypeError(message);
  }
  return value.trim();
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
