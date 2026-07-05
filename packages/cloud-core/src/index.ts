/**
 * @puppyone/cloud-core — shared, transport-agnostic cloud domain (ISSUE-022).
 *
 * Single source of truth for the cloud entities + API contracts that the web
 * frontend and the desktop cloud panel both use. Platform-specific auth/HTTP is
 * injected via {@link CloudTransport}; nothing here imports Next.js, Electron,
 * Supabase, or any platform runtime (see check-data-ui-boundaries).
 */
export type { CloudTransport } from "./transport";

// ── Access-provider registry (pure domain data + helpers) ────────────────
export * from "./accessProviders";

// ── MCP endpoints ─────────────────────────────────────────────────────────
export { createMcpEndpointsApi } from "./endpoints/mcpEndpoints";
export type {
  McpEndpoint,
  McpToolsConfig,
  CreateMcpEndpointParams,
  UpdateMcpEndpointParams,
} from "./endpoints/mcpEndpoints";

// ── Sandbox endpoints ─────────────────────────────────────────────────────
export { createSandboxEndpointsApi } from "./endpoints/sandboxEndpoints";
export type {
  SandboxEndpoint,
  SandboxMount,
  SandboxMountPermissions,
  SandboxResourceLimits,
  SandboxRuntime,
  CreateSandboxEndpointParams,
  UpdateSandboxEndpointParams,
} from "./endpoints/sandboxEndpoints";

// ── Repo scopes ───────────────────────────────────────────────────────────
export { createScopesApi, matchScopeForPath, isWithinScope } from "./endpoints/scopes";
export type { RepoScope, ScopeMode } from "./endpoints/scopes";

// ── Connectors + repo identity ────────────────────────────────────────────
export {
  createConnectorsApi,
  BUILTIN_PROVIDERS,
  normalizeConnector,
  isAccessSurfaceConnector,
  normalizeAccessSurfaceConnectors,
  sortConnectorsBuiltinFirst,
} from "./endpoints/connectors";
export type {
  Connector,
  ConnectorDirection,
  ConnectorStatus,
  ConnectorRun,
  CreateConnectorBody,
  RepoIdentity,
} from "./endpoints/connectors";
