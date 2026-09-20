export type ModelConnectionDriver = "ollama" | "lm-studio" | "unsloth" | "openai-compatible";
/** User-facing connection category, not proof of where inference executes. */
export type ModelConnectionSourceKind = "local" | "api" | "managed";
export type ModelCapability = "supported" | "unsupported" | "unknown";
export type ConnectionModel = {
  id: string;
  name: string;
  available: boolean;
  loaded: boolean | null;
  capabilities: { text: ModelCapability; tools: ModelCapability; images: ModelCapability; reasoning?: ModelCapability };
  contextWindow: number | null;
  maxContextWindow: number | null;
  evidence: string;
  verifiedAt?: string;
};
export type ModelConnection = {
  id: string;
  sourceKind: ModelConnectionSourceKind;
  driver: ModelConnectionDriver;
  name: string;
  baseUrl: string;
  auth: "none" | "bearer";
  credentialConfigured: boolean;
  readOnly?: boolean;
  configGeneration: number;
  defaultModelId: string | null;
  manualModelId: string | null;
  manualContextWindow: number | null;
  serverToolsDisabled: boolean;
  transport: "loopback" | "remote";
  executionLocation: "unknown";
};
export type ModelCatalogSnapshot = {
  connectionId: string;
  configGeneration: number;
  status: "unread" | "refreshing" | "ready" | "stale" | "failed";
  endpoint: "unknown" | "reachable" | "unreachable";
  authentication: "unknown" | "not-required" | "valid" | "missing" | "invalid";
  observedAt: string | null;
  complete: boolean;
  models: ConnectionModel[];
  errorCode: string | null;
};
export type ModelConnectionSnapshot = {
  schemaVersion: 1;
  revision: number;
  connections: ModelConnection[];
  catalogs: ModelCatalogSnapshot[];
  managed: {
    available: boolean;
    reason: "gateway-unavailable" | "sign-in-required" | "insufficient-credit" | "ready";
    signedIn?: boolean; sandbox?: boolean; balanceMicroUsd?: number; reservedMicroUsd?: number;
    availableMicroUsd?: number; errorCode?: string | null; apiOrigin?: string | null;
    trialGrantedMicroUsd?: number;
    packs?: { id: string; name: string; price_cents: number; credit_micro_usd: number }[];
  };
};
export type ModelConnectionCandidate = { driver: ModelConnectionDriver; baseUrl: string; name: string };
export type SaveModelConnectionRequest = {
  id?: string;
  sourceKind?: ModelConnectionSourceKind;
  expectedGeneration?: number;
  driver: ModelConnectionDriver;
  name: string;
  baseUrl: string;
  auth: "none" | "bearer";
  /** Write-only. Never retained by a shared renderer store or returned in a snapshot. */
  apiKey?: string;
  defaultModelId?: string | null;
  manualModelId?: string | null;
  manualContextWindow?: number | null;
  serverToolsDisabled?: boolean;
};
export type ManagedConnectionAction = { action: "refresh" | "sign-in" } | { action: "checkout"; packId: string };
export type ModelConnectionCommand = "read" | "save" | "remove" | "refresh" | "discover" | "verify" | "managed";
export type ModelConnectionResult<T> = { ok: true; value: T } | { ok: false; code: string };
