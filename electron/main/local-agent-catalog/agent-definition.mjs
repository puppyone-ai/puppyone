import { defineLocalAgentInstallation } from "../local-agent-installation/installation-definition.mjs";

const PLATFORMS = new Set(["darwin", "linux", "win32"]);
const STRATEGIES = new Set(["external-cli", "app-bundled-runtime", "companion-managed-runtime"]);
const token = value => typeof value === "string" && /^[a-z][a-z0-9-]{0,79}$/u.test(value);
const label = value => typeof value === "string" && value.trim().length > 0 && value.length <= 160 && !/[\0\r\n]/u.test(value);

/** Trusted static declarations only. No probes, services or runtime imports. */
export function defineLocalAgent(definition) {
  exact(definition, ["installation", "runtimeId", "terminalRecipeId", "setup", "companion", "provision"]);
  const installation = defineLocalAgentInstallation(definition.installation);
  const { runtimeId, terminalRecipeId, setup, companion, provision } = definition;
  if (![runtimeId, terminalRecipeId].every(value => value === null || token(value))
    || (!runtimeId && !terminalRecipeId)) throw new TypeError("Invalid Local Agent consumer mapping.");
  exact(setup, ["strategy", "guideUrl", "platforms", "reviewedAt", "publisher"]);
  if (!STRATEGIES.has(setup.strategy) || !label(setup.publisher)
    || !/^\d{4}-\d{2}-\d{2}$/u.test(setup.reviewedAt)
    || !Array.isArray(setup.platforms) || !setup.platforms.length
    || setup.platforms.some(value => !PLATFORMS.has(value))
    || new Set(setup.platforms).size !== setup.platforms.length) throw new TypeError("Invalid Local Agent setup capability.");
  httpsUrl(setup.guideUrl);
  if (companion !== null) {
    exact(companion, ["bundleId"]);
    if (typeof companion.bundleId !== "string" || !/^[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$/u.test(companion.bundleId)
      || companion.bundleId.length > 160) throw new TypeError("Invalid Local Agent companion identity.");
  }
  if (provision?.kind === "guided") exact(provision, ["kind"]);
  else if (provision?.kind === "managed-artifact") {
    exact(provision, ["kind", "recipeFor"]);
    if (typeof provision.recipeFor !== "function" || setup.strategy !== "external-cli") {
      throw new TypeError("Invalid managed-artifact capability.");
    }
  } else throw new TypeError("Invalid Local Agent provision capability.");
  return freeze({ installation, runtimeId, terminalRecipeId, setup: { ...setup, platforms: [...setup.platforms] },
    companion: companion && { ...companion }, provision: { ...provision } });
}

/** Selection is explicit and platform-qualified, never inferred from a brand. */
export function localAgentCapabilities(agent, { platform, arch }) {
  const supported = agent.setup.platforms.includes(platform);
  const recipe = supported && agent.provision.kind === "managed-artifact"
    ? agent.provision.recipeFor(platform, arch) : null;
  if (recipe !== null) assertManagedRecipe(recipe, agent.installation.id);
  return freeze({
    chat: supported && agent.runtimeId !== null,
    terminal: supported && agent.terminalRecipeId !== null,
    companionDiscovery: supported && platform === "darwin" && agent.companion !== null,
    automaticInstall: recipe !== null,
    recipe,
  });
}

/** Shared recommendation/activation admission also supports terminal-only definitions. */
export function supportsSetupSurface(route, surface) {
  return surface === "chat" ? Boolean(route.runtimeId)
    : surface === "terminal" ? Boolean(route.terminalRecipeId) : false;
}

function assertManagedRecipe(recipe, setupId) {
  exact(recipe, ["setupId", "version", "entry", "binary", "artifact"]);
  if (recipe.setupId !== setupId || typeof recipe.version !== "string"
    || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/u.test(recipe.version)
    || !relativeEntry(recipe.entry) || recipe.entry.includes("/") || !relativeEntry(recipe.binary)) {
    throw new TypeError("Invalid Local Agent installation recipe.");
  }
  exact(recipe.artifact, ["url", "algorithm", "digest"]);
  httpsUrl(recipe.artifact.url);
  const { algorithm, digest } = recipe.artifact;
  if (!["sha256", "sha512"].includes(algorithm) || typeof digest !== "string"
    || !/^[A-Za-z0-9+/]+={0,2}$/u.test(digest)
    || Buffer.from(digest, "base64").length !== (algorithm === "sha256" ? 32 : 64)
    || Buffer.from(digest, "base64").toString("base64") !== digest) throw new TypeError("Invalid Local Agent artifact integrity.");
}

function relativeEntry(value) {
  return typeof value === "string" && value.length > 0 && value.length < 4096
    && !/[\\\0\r\n:]/u.test(value) && value.split("/").every(part => part && part !== "." && part !== "..");
}
function httpsUrl(value) {
  if (typeof value !== "string") throw new TypeError("Invalid Local Agent official URL.");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash) throw new TypeError("Invalid Local Agent official URL.");
}
function exact(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some(key => !keys.includes(key)) || keys.some(key => !Object.hasOwn(value, key))) {
    throw new TypeError("Invalid Local Agent declaration fields.");
  }
}
function freeze(value) {
  if (!value || typeof value !== "object") return value;
  for (const nested of Object.values(value)) freeze(nested);
  return Object.freeze(value);
}
