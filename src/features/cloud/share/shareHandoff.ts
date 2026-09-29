import type { DesktopCloudMcpEndpoint } from "../../../lib/cloudApi";
import type { ShareTarget } from "./shareTargets";

/**
 * The handoff is the one thing the user carries into the destination product.
 * It must be paste-ready: a single URL for MCP-capable Agents, a single link
 * for everything else.
 */
export type ShareHandoff =
  | Readonly<{
      channel: "mcp";
      serverUrl: string;
      /** Full key when the endpoint was just issued; otherwise only its hint. */
      apiKey: string | null;
      apiKeyHint: string | null;
    }>
  | Readonly<{
      channel: "link";
      url: string;
    }>;

export function buildMcpServerUrl(apiBaseUrl: string | null, apiKey: string | null | undefined): string {
  const base = normalizeApiOrigin(apiBaseUrl);
  if (!base || !apiKey) return "";
  return `${base}/api/v1/mcp/server/${apiKey}`;
}

/**
 * Desktop stores the API base as `https://host/api/v1`; the hosted MCP server
 * lives at the origin. Strip any versioned suffix so both shapes work.
 */
export function normalizeApiOrigin(apiBaseUrl: string | null): string {
  if (!apiBaseUrl) return "";
  try {
    const url = new URL(apiBaseUrl);
    return `${url.protocol}//${url.host}`;
  } catch {
    return apiBaseUrl.replace(/\/api\/v\d+\/?$/, "").replace(/\/+$/, "");
  }
}

export function buildShareHandoff({
  target,
  endpoint,
  apiBaseUrl,
  projectLink,
}: {
  target: ShareTarget;
  endpoint: DesktopCloudMcpEndpoint | null;
  apiBaseUrl: string | null;
  projectLink: string | null;
}): ShareHandoff | null {
  if (target.channel === "link") {
    return projectLink ? { channel: "link", url: projectLink } : null;
  }
  if (!endpoint) return null;
  const apiKey = endpoint.api_key ?? null;
  const serverUrl = buildMcpServerUrl(apiBaseUrl, apiKey);
  if (!serverUrl) {
    return {
      channel: "mcp",
      serverUrl: "",
      apiKey: null,
      apiKeyHint: endpoint.api_key_hint ?? null,
    };
  }
  return {
    channel: "mcp",
    serverUrl,
    apiKey,
    apiKeyHint: endpoint.api_key_hint ?? null,
  };
}

export function maskApiKey(apiKey: string | null, hint: string | null): string {
  if (hint) return hint;
  if (!apiKey) return "";
  if (apiKey.length <= 8) return "••••";
  return `${apiKey.slice(0, 4)}••••${apiKey.slice(-4)}`;
}
