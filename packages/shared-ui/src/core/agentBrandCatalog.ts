import { RENDERER_ASSET_PATHS } from "./rendererAssetCatalog";

export const AGENT_BRAND_IDS = Object.freeze([
  "chatgpt",
  "claude",
  "codex",
  "cursor",
  "hermes",
  "manus",
  "opencode",
  "pi",
  "workbuddy",
  "workspace-agent",
] as const);

export type AgentBrandId = (typeof AGENT_BRAND_IDS)[number];

export type AgentBrandDefinition = Readonly<{
  id: AgentBrandId;
  displayName: string;
  aliases: readonly string[];
  /** Compensates for transparent safety area in the source asset. */
  assetOpticalScale: number;
  assets: Readonly<{
    light: string;
    dark?: string;
  }>;
}>;

const agentAssets = RENDERER_ASSET_PATHS.icons.agents;

/**
 * Canonical renderer identity registry for Agent products.
 *
 * Runtime manifests own protocol capabilities. This registry owns only stable
 * visual identity: canonical ids, names, aliases, theme-aware local marks, and
 * source-asset optical normalization shared by every product surface.
 */
export const AGENT_BRAND_CATALOG: Readonly<Record<AgentBrandId, AgentBrandDefinition>> = Object.freeze({
  chatgpt: defineBrand("chatgpt", "ChatGPT", ["chatgpt"], agentAssets.chatgpt),
  claude: defineBrand("claude", "Claude Code", ["claude", "anthropic"], agentAssets.claude, 0.84),
  codex: defineBrand("codex", "Codex", ["codex", "openai"], agentAssets.codex),
  cursor: defineBrand("cursor", "Cursor", ["cursor"], agentAssets.cursor, 0.84),
  hermes: defineBrand("hermes", "Hermes Agent", ["hermes"], agentAssets.hermes, 0.82),
  manus: defineBrand("manus", "Manus", ["manus"], agentAssets.manus),
  opencode: defineBrand("opencode", "OpenCode", ["opencode"], agentAssets.opencode, 1.3),
  pi: defineBrand("pi", "Pi Agent", ["pi"], agentAssets.pi, 1.28),
  workbuddy: defineBrand("workbuddy", "WorkBuddy", ["workbuddy", "codebuddy"], agentAssets.workbuddy),
  "workspace-agent": defineBrand(
    "workspace-agent",
    "Workspace Agent",
    ["workspace-agent", "workspace"],
    agentAssets.workspaceAgent,
  ),
});

export function getAgentBrand(brandId: string | null | undefined): AgentBrandDefinition | null {
  if (!brandId) return null;
  return AGENT_BRAND_CATALOG[brandId.toLowerCase() as AgentBrandId] ?? null;
}

export function resolveAgentBrand(identity: {
  id?: string | null;
  iconKey?: string | null;
  label?: string | null;
}): AgentBrandDefinition | null {
  const direct = getAgentBrand(identity.id) ?? getAgentBrand(identity.iconKey);
  if (direct) return direct;

  const normalized = [identity.id, identity.iconKey, identity.label]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();
  const tokens = new Set(normalized.split(/[^a-z0-9]+/u).filter(Boolean));

  return AGENT_BRAND_IDS
    .map((brandId) => AGENT_BRAND_CATALOG[brandId])
    .find((brand) => brand.aliases.some((alias) => tokens.has(alias))) ?? null;
}

function defineBrand(
  id: AgentBrandId,
  displayName: string,
  aliases: readonly string[],
  assets: { readonly light: string; readonly dark?: string },
  assetOpticalScale = 1,
): AgentBrandDefinition {
  return Object.freeze({
    id,
    displayName,
    aliases: Object.freeze([...aliases]),
    assetOpticalScale,
    assets: Object.freeze({ ...assets }),
  });
}
