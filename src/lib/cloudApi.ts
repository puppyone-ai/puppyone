import {
  CLOUD_API_BASE_URL_STORAGE_KEY,
  buildCloudApiUrl as buildCanonicalCloudApiUrl,
  cloudApiBaseUrlFromRemote,
  formatCloudApiHost as formatCanonicalCloudApiHost,
  normalizeCloudApiBaseUrl,
  resolveCloudApiBaseUrl,
  sameCloudApiBaseUrl,
} from "../../shared/cloudEndpoint.js";
import {
  REPOSITORY_TARGET_CONTRACT_HEADER,
  REPOSITORY_TARGET_CONTRACT_VERSION,
} from "../../shared/repositoryContract.js";
import { invalidateCloudCacheForMutation } from "../features/cloud/cache/cloudCache";
import { createCloudAutomationApi } from "./cloud/automationApi";
import type { RepositoryTarget } from "../features/cloud/repositoryTarget";

export type { RepositoryTarget } from "../features/cloud/repositoryTarget";

export {
  REPOSITORY_TARGET_CONTRACT_HEADER,
  REPOSITORY_TARGET_CONTRACT_VERSION,
};

type ApiEnvelope<T> = {
  code?: number;
  message?: string;
  data?: T;
  detail?: unknown;
  error?: string;
};

export type MutableSessionHandler = (session: DesktopCloudSession | null) => void | Promise<void>;

export type DesktopCloudSession = {
  expires_in: number;
  expires_at: number;
  user_id: string;
  user_email: string;
  api_base_url: string;
  session_generation: string;
  status:
    | "restoring"
    | "signing-in"
    | "authenticated"
    | "refreshing"
    | "offline-authenticated"
    | "signing-out"
    | "expired"
    | "signed-out";
};

export type DesktopCloudProject = {
  id: string;
  name: string;
  description?: string | null;
  org_id?: string | null;
  visibility?: string | null;
  bound_git_branch?: string | null;
  updated_at?: string | null;
  access_point_count?: number | null;
  effective_role?: "admin" | "editor" | "viewer";
  grant_source?: "org_owner" | "project_member" | "org_visibility";
  capabilities?: string[];
};

export type DesktopCloudRepositoryContext = {
  target: RepositoryTarget;
  project: DesktopCloudProject;
  scope_path?: string | null;
};

export type DesktopCloudOrganization = {
  id: string;
  name: string;
  slug: string;
  avatar_url?: string | null;
  plan: string;
  seat_limit: number;
  created_at: string;
  member_count?: number | null;
};

export type DesktopCloudOrgMember = {
  id: string;
  user_id: string;
  email?: string | null;
  display_name?: string | null;
  avatar_url?: string | null;
  role: "owner" | "member" | "viewer" | string;
  joined_at: string;
};

export type DesktopCloudOrganizationEntitlements = {
  org_id: string;
  plan_id: string;
  status: string;
  source: string;
  seat_quantity: number;
  catalog_version: string;
  source_revision: number;
  payload_hash?: string | null;
  entitlements: {
    features?: Record<string, boolean>;
    limits?: Record<string, number | string | null>;
    allow?: Record<string, string[] | string | null>;
  };
  current_period_end?: string | null;
  effective_until?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type DesktopCloudOrganizationSeatUsage = {
  billable_seat_quantity: number;
};

export type DesktopCloudOrganizationAccess = {
  org_id: string;
  user_id: string;
  role: string;
  can_manage_billing: boolean;
};

export type DesktopBillingSeatPolicy = {
  minimum: number;
  retention_minimum?: number | null;
  maximum: number | null;
  transition_to?: string | null;
};

export type DesktopBillingPlan = {
  id: string;
  aliases: string[];
  name: string;
  description: string;
  public: boolean;
  purchasable: boolean;
  highlighted: boolean;
  currency: string;
  interval: "month" | "year" | "contract" | "none";
  price_per_seat_cents: number | null;
  seats: DesktopBillingSeatPolicy;
  features: Record<string, boolean>;
  fixed_limits: Record<string, number | null>;
  per_seat_limits: Record<string, number>;
  allow: Record<string, string[] | string | null>;
  runtime: {
    fixed_units: number;
    units_per_seat: number;
  };
};

export type DesktopBillingCatalog = {
  schema_version: string;
  catalog_version: string;
  effective_at: string;
  currency: string;
  plans: DesktopBillingPlan[];
  runtime: {
    top_ups_enabled: boolean;
    overage_enabled: boolean;
    unit_seconds: number;
    minimum_units: number;
    overage_price_cents_per_unit: number;
    profiles: Array<{
      id: string;
      vcpu: number;
      memory_gib: number;
      multiplier: number;
    }>;
    top_up_packs: Array<{
      id: string;
      name: string;
      runtime_units: number;
      price_cents: number;
      currency: string;
    }>;
  };
};

export type DesktopBillingSummary = {
  org_id: string;
  plan_id: string;
  status:
    | "free"
    | "checkout_pending"
    | "active"
    | "change_pending"
    | "cancel_scheduled"
    | "past_due"
    | "revoked"
    | "disputed";
  seat_quantity: number;
  pending_plan_id: string | null;
  cancel_at_period_end: boolean;
  current_period_end: string | null;
  catalog_version: string;
  source_revision: number;
  portal_available: boolean;
  seat_changes_available: boolean;
  runtime_available_units: number;
  runtime_reserved_units: number;
  runtime_overage_enabled: boolean;
  runtime_monthly_limit_cents: number;
};

export type DesktopRuntimeBalance = {
  org_id: string;
  available_units: number;
  reserved_units: number;
  granted_units: number;
  consumed_units: number;
  postpaid_available_units: number;
  postpaid_consumed_units: number;
  buckets: Array<Record<string, unknown>>;
};

export type DesktopBillingUsage = {
  runtime: DesktopRuntimeBalance;
  storage: {
    logical_bytes: number;
    limit_bytes: number | null;
    percent: number | null;
    threshold_percent: number;
    version: number;
  };
};

export type DesktopBillingQuote = {
  quote_id: string;
  org_id: string;
  kind: "checkout" | "plan" | "seats";
  current_plan_id: string;
  target_plan_id: string;
  current_seats: number;
  target_seats: number;
  currency: string;
  current_amount_cents: number;
  target_amount_cents: number;
  delta_amount_cents: number;
  application_mode: "checkout" | "plan_change" | "seat_change";
  requires_confirmation: boolean;
  catalog_version: string;
  expires_at: string;
  details: Record<string, unknown>;
};

export type DesktopBillingCheckout = {
  checkout_id: string;
  checkout_url: string;
  quote: DesktopBillingQuote;
  operation: DesktopBillingOperation;
};

export type DesktopBillingOperationKind =
  | "checkout"
  | "seat_increase"
  | "seat_decrease"
  | "plan_change"
  | "member_activation"
  | "member_deactivation"
  | "entitlement_provision";

export type DesktopBillingOperationState =
  | "pending"
  | "requires_action"
  | "processing"
  | "retryable_failed"
  | "succeeded"
  | "canceled"
  | "failed";

export type DesktopBillingOperation = {
  id: string;
  org_id: string;
  kind: DesktopBillingOperationKind;
  state: DesktopBillingOperationState;
  terminal: boolean;
  retryable: boolean;
  action_required: boolean;
  target_plan_id: string | null;
  current_seat_quantity: number | null;
  target_seat_quantity: number | null;
  quote_id: string | null;
  confirmed_revision: number | null;
  error_code: string | null;
  created_at: string | null;
  updated_at: string | null;
  completed_at: string | null;
};

export type DesktopBillingAppliedQuote = DesktopBillingQuote & {
  operation: DesktopBillingOperation;
};

export type DesktopCloudDashboard = {
  project: {
    id: string;
    name: string;
    description?: string | null;
  };
  nodes: {
    total: number;
    folders: number;
    files: number;
    storage_bytes?: number | null;
    storage_limit_bytes?: number | null;
  };
  connections: DesktopCloudDashboardConnection[];
  tools: Array<{
    id: string;
    name: string;
    type?: string | null;
    index_status?: string | null;
    chunks_count?: number | null;
    total_files?: number | null;
    indexed_files?: number | null;
  }>;
  uploads: Array<{
    id: string;
    status: string;
    type: string;
    progress?: number;
    message?: string | null;
  }>;
};

export type DesktopCloudDashboardConnection = {
  id: string;
  provider: string;
  name?: string | null;
  path?: string | null;
  direction?: string | null;
  status: string;
  access_key?: string | null;
  trigger?: Record<string, unknown> | null;
  last_synced_at?: string | null;
  error_message?: string | null;
  created_at?: string | null;
  usage_buckets?: number[];
};

export type DesktopCloudTreeEntry = {
  name: string;
  path: string;
  type: string;
  content_hash?: string | null;
  size_bytes?: number | null;
  mime_type?: string | null;
  children_count?: number | null;
  integrity_status?: "ok" | "damaged" | "unknown";
};

export type DesktopCloudTree = {
  path: string;
  entries: DesktopCloudTreeEntry[];
  head_commit_id?: string;
};

export type DesktopCloudAccessPointSemantics = {
  project_id?: string | null;
  scope?: {
    id?: string | null;
    project_id?: string | null;
    repo_id?: string | null;
    repo_kind?: string | null;
    repo_ref?: string | null;
    path?: string | null;
    mode?: string | null;
    exclude?: string[] | null;
  } | null;
};

export type DesktopCloudScope = {
  id: string;
  project_id: string;
  name: string;
  path: string;
  exclude: string[];
  max_mode: "r" | "rw";
  created_at?: string | null;
  updated_at?: string | null;
};

/** Presentation projection over the Project root or one real path Scope. */
export type DesktopCloudRepositoryView = {
  id: string;
  target: RepositoryTarget;
  project_id: string;
  name: string;
  path: string;
  exclude: string[];
  max_mode: "r" | "rw";
  created_at?: string | null;
  updated_at?: string | null;
};

export type DesktopCloudScopePatch = {
  name?: string;
  exclude?: string[];
  max_mode?: "r" | "rw";
};

export type DesktopCloudCreateScopeRequest = {
  name: string;
  path: string;
  exclude?: string[];
  max_mode?: "r" | "rw";
};

export type DesktopCloudConnector = {
  id: string;
  target: RepositoryTarget;
  provider: string;
  name: string;
  direction: string;
  config?: Record<string, unknown>;
  oauth_connection_id?: number | null;
  trigger?: Record<string, unknown>;
  status: string;
  last_run_at?: string | null;
  last_run_id?: string | null;
  error_message?: string | null;
  created_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type DesktopCloudConnectorPatch = {
  name?: string;
  direction?: string;
  config?: Record<string, unknown>;
  policy?: unknown;
  oauth_connection_id?: number | null;
  trigger?: Record<string, unknown> | null;
  status?: string;
};

export type DesktopCloudAutomationConfigField = {
  key: string;
  label: string;
  type: "text" | "select" | "number" | "url";
  required: boolean;
  default: string | number | null;
  options: { value: string; label: string }[] | null;
  placeholder: string | null;
  hint: string | null;
};

export type DesktopCloudAutomationProviderSpec = {
  provider: string;
  display_name: string;
  description: string | null;
  auth: "none" | "oauth" | "optional_oauth" | "api_key" | "access_key";
  creation_mode: "direct" | "bootstrap";
  category: "datasource" | "agent" | "endpoint";
  icon: string | null;
  oauth_type?: string | null;
  oauth_ui_type?: string | null;
  default_sync_mode?: string;
  supported_sync_modes?: string[];
  supported_directions?: string[];
  config_fields?: DesktopCloudAutomationConfigField[];
  icon_url?: string | null;
};

export type DesktopCloudAutomationConnection = {
  id: string;
  project_id: string;
  path: string | null;
  direction: string;
  provider: string;
  config: Record<string, unknown>;
  status: string;
  last_sync_commit_id?: string | null;
  error_message?: string | null;
};

export type DesktopCloudCreateAutomationRequest = {
  project_id: string;
  provider: string;
  config: Record<string, unknown>;
  target_folder_path?: string;
  target_path?: string;
  direction?: string;
  conflict_strategy?: string;
  sync_mode?: "manual" | "scheduled" | "realtime";
  trigger?: { type: string; schedule?: string; timezone?: string };
};

export type DesktopCloudCreateAutomationResult = {
  /** Legacy server response key. Product/domain code calls this Automation. */
  sync: DesktopCloudAutomationConnection;
  execution_result?: Record<string, unknown> | null;
};

export type DesktopCloudAutomationOauthStatus = {
  connected: boolean;
  workspace_name: string | null;
  connected_at: string | null;
  connection_id: number | null;
};

export type DesktopCloudAutomationProviderResource = {
  id: string;
  type: string;
  name: string;
  url: string | null;
  subtitle: string | null;
  icon: string | null;
  authorized: boolean;
  metadata: Record<string, unknown>;
};

export type DesktopCloudAutomationProviderResources = {
  resources: DesktopCloudAutomationProviderResource[];
  next_cursor: string | null;
};

export type DesktopCloudUpdateAutomationConnectionRequest = {
  config?: Record<string, unknown>;
  target_path?: string;
  direction?: string;
  conflict_strategy?: string;
};

export type DesktopCloudUpdateAutomationTriggerRequest = {
  sync_mode: "manual" | "scheduled" | "realtime";
  trigger?: { type: string; schedule?: string; timezone?: string } | null;
};

export type DesktopCloudAutomationRun = {
  id: string;
  access_point_id: string;
  status: string;
  worker_job_id?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  duration_ms?: number | null;
  exit_code?: number | null;
  stdout?: string | null;
  error?: string | null;
  trigger_type?: string | null;
  result_summary?: string | null;
};

export type DesktopCloudMcpEndpoint = {
  id: string;
  project_id: string;
  path: string | null;
  name: string;
  description?: string | null;
  api_key?: string;
  api_key_hint?: string;
  api_key_revealed?: boolean;
  status: string;
  accesses?: Array<{ path: string; json_path?: string; readonly?: boolean }>;
  config?: Record<string, unknown>;
  tools_config?: unknown;
  created_at?: string | null;
  updated_at?: string | null;
};

export type DesktopCloudCreateMcpEndpointRequest = {
  project_id: string;
  name?: string;
  path?: string;
  description?: string;
  accesses?: Array<{ path: string; json_path?: string; readonly?: boolean }>;
  tools_config?: unknown;
};

export type DesktopCloudUpdateMcpEndpointRequest = {
  name?: string;
  description?: string;
  path?: string;
  status?: string;
  accesses?: Array<{ path: string; json_path?: string; readonly?: boolean }>;
  tools_config?: unknown;
};

export type DesktopCloudRepoIdentity = {
  project_id: string;
  url: string;
  prompt_template?: string;
  content_initialized?: boolean;
  head_commit_id?: string | null;
  scopes: Array<{
    id: string;
    name: string;
    path: string;
    git_url: string;
  }>;
};

function normalizeSessionApiBase(apiBaseUrl: string | null | undefined): string {
  if (typeof apiBaseUrl === "string" && apiBaseUrl.trim()) {
    return resolveCloudApiBaseUrl(apiBaseUrl);
  }
  return getDesktopCloudApiBaseUrl();
}

export function getDesktopCloudApiBaseUrl(): string {
  try {
    const stored = window.localStorage.getItem(CLOUD_API_BASE_URL_STORAGE_KEY)?.trim();
    if (stored) {
      const normalized = normalizeCloudApiBaseUrl(stored);
      if (normalized) {
        if (normalized !== stored.replace(/\/+$/, "")) {
          window.localStorage.setItem(CLOUD_API_BASE_URL_STORAGE_KEY, normalized);
        }
        return normalized;
      }
      window.localStorage.removeItem(CLOUD_API_BASE_URL_STORAGE_KEY);
    }
  } catch {
    // Fall through to env/default.
  }

  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  const configured = env?.VITE_DESKTOP_CLOUD_API_URL || env?.VITE_CLOUD_API_URL || env?.VITE_API_URL;
  const normalized = normalizeCloudApiBaseUrl(configured);
  if (!normalized) {
    throw new Error("VITE_DESKTOP_CLOUD_API_URL must configure the Cloud API endpoint.");
  }
  return normalized;
}

export function desktopCloudApiUrl(path: string): string {
  return buildCanonicalCloudApiUrl(path);
}

export function desktopCloudApiBaseUrlFromRemote(remoteUrl: string | null): string | null {
  return cloudApiBaseUrlFromRemote(remoteUrl);
}

export function isCloudSessionForApiBase(
  session: DesktopCloudSession | null | undefined,
  apiBaseUrl?: string | null,
): boolean {
  if (!session) return false;
  return sameCloudApiBaseUrl(session.api_base_url, apiBaseUrl);
}

export function getDesktopCloudWebUrl(path: string): string {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  const configured = env?.VITE_DESKTOP_CLOUD_WEB_URL?.trim();
  if (!configured) {
    throw new Error("VITE_DESKTOP_CLOUD_WEB_URL must configure the Cloud web endpoint.");
  }

  let baseUrl: URL;
  try {
    baseUrl = new URL(configured);
  } catch {
    throw new Error("VITE_DESKTOP_CLOUD_WEB_URL is invalid.");
  }
  if (
    !["http:", "https:"].includes(baseUrl.protocol)
    || !baseUrl.hostname
    || baseUrl.username
    || baseUrl.password
  ) {
    throw new Error("VITE_DESKTOP_CLOUD_WEB_URL is invalid.");
  }

  const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
  return new URL(normalizedPath, `${baseUrl.toString().replace(/\/+$/, "")}/`).toString();
}

export function openCloudApp(path: string): void {
  window.open(getDesktopCloudWebUrl(path), "_blank", "noopener,noreferrer");
}

export async function cloudApiRequest<T>(
  path: string,
  session: DesktopCloudSession,
  onSessionChange?: MutableSessionHandler,
  init: RequestInit = {},
  apiBaseUrl?: string | null,
): Promise<T> {
  const requestedApiBase = normalizeSessionApiBase(apiBaseUrl);
  const sessionApiBase = normalizeSessionApiBase(session.api_base_url);
  if (sessionApiBase !== requestedApiBase) {
    const error = new Error(`Sign in to ${formatCloudApiHost(requestedApiBase)} to load this Cloud workspace.`);
    (error as Error & { status?: number }).status = 401;
    throw error;
  }

  if (window.puppyoneDesktop?.requestCloudSessionApi) {
    const body = typeof init.body === "string" ? init.body : undefined;
    try {
      const transported = await window.puppyoneDesktop.requestCloudSessionApi({
        apiBaseUrl: requestedApiBase,
        path: path.startsWith("/") ? path : `/${path}`,
        method: init.method ?? "GET",
        headers: {
          ...normalizeRequestHeaders(init.headers),
          [REPOSITORY_TARGET_CONTRACT_HEADER]: REPOSITORY_TARGET_CONTRACT_VERSION,
        },
        ...(body === undefined ? {} : { body }),
      });
      const result = unwrapCloudIpcEnvelope<T>(transported);
      if (isMutationMethod(init.method)) {
        invalidateCloudCacheForMutation({ session, apiPath: path });
      }
      return result;
    } catch (error) {
      throw normalizeCloudBridgeInvocationError(error);
    }
  }

  const error = new Error("Desktop secure Cloud session service is unavailable.");
  (error as Error & { status?: number }).status = 401;
  throw error;
}

function isMutationMethod(method: string | undefined) {
  const normalized = (method ?? "GET").toUpperCase();
  return normalized !== "GET" && normalized !== "HEAD" && normalized !== "OPTIONS";
}

export function getCloudProject(
  session: DesktopCloudSession,
  projectId: string,
  onSessionChange?: MutableSessionHandler,
  apiBaseUrl?: string | null,
): Promise<DesktopCloudProject> {
  return cloudApiRequest<DesktopCloudProject>(
    `/projects/${encodeURIComponent(projectId)}`,
    session,
    onSessionChange,
    {},
    apiBaseUrl,
  );
}

export type UpdateCloudProjectInput = {
  name?: string;
  description?: string | null;
  visibility?: "org" | "private";
  bound_git_branch?: string;
};

export function updateCloudProject(
  session: DesktopCloudSession,
  projectId: string,
  input: UpdateCloudProjectInput,
  onSessionChange?: MutableSessionHandler,
  apiBaseUrl?: string | null,
): Promise<DesktopCloudProject> {
  const payload: UpdateCloudProjectInput = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw new Error("Cloud Project name cannot be empty.");
    payload.name = name;
  }
  if (input.description !== undefined) payload.description = input.description;
  if (input.bound_git_branch !== undefined) {
    const branch = input.bound_git_branch.trim();
    if (!branch) throw new Error("Cloud Project branch cannot be empty.");
    payload.bound_git_branch = branch;
  }
  if (input.visibility !== undefined) payload.visibility = input.visibility;
  if (Object.keys(payload).length === 0) {
    throw new Error("Cloud Project update requires at least one setting.");
  }
  return cloudApiRequest<DesktopCloudProject>(
    `/projects/${encodeURIComponent(projectId)}`,
    session,
    onSessionChange,
    { method: "PUT", body: JSON.stringify(payload) },
    apiBaseUrl,
  );
}

export function getCloudRepositoryContext(
  session: DesktopCloudSession,
  projectId: string,
  target: RepositoryTarget,
  onSessionChange?: MutableSessionHandler,
  apiBaseUrl?: string | null,
): Promise<DesktopCloudRepositoryContext> {
  return cloudApiRequest<DesktopCloudRepositoryContext>(
    `/projects/${encodeURIComponent(projectId)}/repository-context`,
    session,
    onSessionChange,
    { method: "POST", body: JSON.stringify({ target }) },
    apiBaseUrl,
  );
}

export function projectAllows(
  project: DesktopCloudProject | null | undefined,
  capability: string,
): boolean {
  return project?.capabilities?.includes(capability) === true;
}

export function listCloudOrganizations(
  session: DesktopCloudSession,
  onSessionChange?: MutableSessionHandler,
  apiBaseUrl?: string | null,
): Promise<DesktopCloudOrganization[]> {
  return cloudApiRequest<DesktopCloudOrganization[]>("/organizations/", session, onSessionChange, {}, apiBaseUrl);
}

export function listCloudOrganizationMembers(
  session: DesktopCloudSession,
  orgId: string,
  onSessionChange?: MutableSessionHandler,
  apiBaseUrl?: string | null,
): Promise<DesktopCloudOrgMember[]> {
  return cloudApiRequest<DesktopCloudOrgMember[]>(`/organizations/${encodeURIComponent(orgId)}/members`, session, onSessionChange, {}, apiBaseUrl);
}

export function getCloudOrganizationEntitlements(
  session: DesktopCloudSession,
  orgId: string,
  onSessionChange?: MutableSessionHandler,
  apiBaseUrl?: string | null,
): Promise<DesktopCloudOrganizationEntitlements> {
  return cloudApiRequest<DesktopCloudOrganizationEntitlements>(`/organizations/${encodeURIComponent(orgId)}/entitlements`, session, onSessionChange, {}, apiBaseUrl);
}

export function getCloudOrganizationSeatUsage(
  session: DesktopCloudSession,
  orgId: string,
  onSessionChange?: MutableSessionHandler,
  apiBaseUrl?: string | null,
): Promise<DesktopCloudOrganizationSeatUsage> {
  return cloudApiRequest<unknown>(
    `/organizations/${encodeURIComponent(orgId)}/seat-usage`,
    session,
    onSessionChange,
    {},
    apiBaseUrl,
  ).then(validateDesktopCloudOrganizationSeatUsage);
}

export function getCloudOrganizationAccess(
  session: DesktopCloudSession,
  orgId: string,
  onSessionChange?: MutableSessionHandler,
  apiBaseUrl?: string | null,
): Promise<DesktopCloudOrganizationAccess> {
  return cloudApiRequest<unknown>(
    `/organizations/${encodeURIComponent(orgId)}/access`,
    session,
    onSessionChange,
    {},
    apiBaseUrl,
  ).then(validateDesktopCloudOrganizationAccess);
}

export function validateDesktopCloudOrganizationAccess(
  value: unknown,
): DesktopCloudOrganizationAccess {
  if (!isRecord(value)
    || typeof value.org_id !== "string"
    || !value.org_id
    || typeof value.user_id !== "string"
    || !value.user_id
    || typeof value.role !== "string"
    || !value.role.trim()
    || typeof value.can_manage_billing !== "boolean"
    || value.can_manage_billing !== (value.role === "owner")) {
    throw new Error("Invalid organization access response.");
  }
  return value as DesktopCloudOrganizationAccess;
}

export function validateDesktopCloudOrganizationSeatUsage(
  value: unknown,
): DesktopCloudOrganizationSeatUsage {
  if (!isRecord(value)
    || !Number.isSafeInteger(value.billable_seat_quantity)
    || (value.billable_seat_quantity as number) < 0) {
    throw new Error("Invalid organization billable_seat_quantity response.");
  }
  return value as DesktopCloudOrganizationSeatUsage;
}

function billingOrganizationPath(orgId: string, suffix: string): string {
  return `/billing/organizations/${encodeURIComponent(orgId)}/${suffix}`;
}

function billingMutationInit(
  method: "POST" | "PUT",
  idempotencyKey: string,
  body?: Record<string, unknown>,
): RequestInit {
  const key = idempotencyKey.trim();
  if (!key || key.length > 255) {
    throw new Error("A valid billing idempotency key is required.");
  }
  return {
    method,
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": key,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}

export function createDesktopBillingIdempotencyKey(scope: string): string {
  const normalizedScope = scope.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").slice(0, 48);
  if (!normalizedScope) throw new Error("Billing operation scope is required.");
  if (typeof globalThis.crypto?.randomUUID !== "function") {
    throw new Error("Secure billing operation identifiers are unavailable.");
  }
  return `desktop:${normalizedScope}:${globalThis.crypto.randomUUID()}`;
}

export function getCloudBillingCatalog(
  session: DesktopCloudSession,
  onSessionChange?: MutableSessionHandler,
  apiBaseUrl?: string | null,
): Promise<DesktopBillingCatalog> {
  return cloudApiRequest<unknown>("/billing/catalog", session, onSessionChange, {}, apiBaseUrl)
    .then(validateDesktopBillingCatalog);
}

export function validateDesktopBillingCatalog(value: unknown): DesktopBillingCatalog {
  const catalog = requireBillingRecord(value, "catalog");
  const schemaVersion = requireBillingString(catalog.schema_version, "schema_version");
  if (schemaVersion.split(".")[0] !== "1") {
    throw new Error("Cloud returned an unsupported billing catalog schema.");
  }
  requireBillingString(catalog.catalog_version, "catalog_version");
  requireBillingString(catalog.effective_at, "effective_at");
  requireBillingString(catalog.currency, "currency");
  if (!Array.isArray(catalog.plans) || catalog.plans.length === 0) {
    throw new Error("Cloud returned an empty billing catalog.");
  }
  const planIds = new Set<string>();
  for (const rawPlan of catalog.plans) {
    const plan = requireBillingRecord(rawPlan, "plan");
    const planId = requireBillingString(plan.id, "plan.id");
    if (!/^[a-z][a-z0-9_-]*$/.test(planId) || planIds.has(planId)) {
      throw new Error("Cloud returned an invalid billing plan identifier.");
    }
    planIds.add(planId);
    requireBillingStringArray(plan.aliases, "plan.aliases");
    if (Object.prototype.hasOwnProperty.call(plan, "provider")) {
      throw new Error("Cloud returned private provider data in the public billing catalog.");
    }
    requireBillingString(plan.name, "plan.name");
    requireBillingString(plan.description, "plan.description");
    requireBillingString(plan.currency, "plan.currency");
    if (!['month', 'year', 'contract', 'none'].includes(String(plan.interval))) {
      throw new Error("Cloud returned an invalid billing plan.interval.");
    }
    requireBillingBoolean(plan.public, "plan.public");
    requireBillingBoolean(plan.purchasable, "plan.purchasable");
    requireBillingBoolean(plan.highlighted, "plan.highlighted");
    if (plan.price_per_seat_cents !== null) {
      requireBillingInteger(plan.price_per_seat_cents, "plan.price_per_seat_cents", 0);
    }
    const seats = requireBillingRecord(plan.seats, "plan.seats");
    const minimum = requireBillingInteger(seats.minimum, "plan.seats.minimum", 0);
    if (seats.retention_minimum !== null && seats.retention_minimum !== undefined) {
      requireBillingInteger(seats.retention_minimum, "plan.seats.retention_minimum", 0);
    }
    if (seats.maximum !== null) {
      const maximum = requireBillingInteger(seats.maximum, "plan.seats.maximum", minimum);
      if (maximum < minimum) throw new Error("Cloud returned an invalid billing seat range.");
    }
    if (seats.transition_to !== null && seats.transition_to !== undefined) {
      requireBillingString(seats.transition_to, "plan.seats.transition_to");
    }
    const runtime = requireBillingRecord(plan.runtime, "plan.runtime");
    requireBillingInteger(runtime.fixed_units, "plan.runtime.fixed_units", 0);
    requireBillingInteger(runtime.units_per_seat, "plan.runtime.units_per_seat", 0);
    requireBillingBooleanRecord(plan.features, "plan.features");
    requireBillingLimitRecord(plan.fixed_limits, "plan.fixed_limits", true);
    requireBillingLimitRecord(plan.per_seat_limits, "plan.per_seat_limits", false);
    requireBillingAllowRecord(plan.allow, "plan.allow");
  }
  const catalogRuntime = requireBillingRecord(catalog.runtime, "runtime");
  const topUpsEnabled = requireBillingBoolean(
    catalogRuntime.top_ups_enabled,
    "runtime.top_ups_enabled",
  );
  const overageEnabled = requireBillingBoolean(
    catalogRuntime.overage_enabled,
    "runtime.overage_enabled",
  );
  requireBillingInteger(catalogRuntime.unit_seconds, "runtime.unit_seconds", 1);
  requireBillingInteger(catalogRuntime.minimum_units, "runtime.minimum_units", 1);
  const overagePrice = requireBillingInteger(
    catalogRuntime.overage_price_cents_per_unit,
    "runtime.overage_price_cents_per_unit",
    0,
  );
  if (!overageEnabled && overagePrice !== 0) {
    throw new Error("Cloud returned a disabled billing overage price.");
  }
  if (!Array.isArray(catalogRuntime.profiles)) {
    throw new Error("Cloud returned invalid billing Runtime profiles.");
  }
  for (const rawProfile of catalogRuntime.profiles) {
    const profile = requireBillingRecord(rawProfile, "runtime.profile");
    requireBillingString(profile.id, "runtime.profile.id");
    requireBillingPositiveNumber(profile.vcpu, "runtime.profile.vcpu");
    requireBillingPositiveNumber(profile.memory_gib, "runtime.profile.memory_gib");
    requireBillingInteger(profile.multiplier, "runtime.profile.multiplier", 1);
  }
  if (!Array.isArray(catalogRuntime.top_up_packs)) {
    throw new Error("Cloud returned invalid billing Runtime top-up packs.");
  }
  if (!topUpsEnabled && catalogRuntime.top_up_packs.length !== 0) {
    throw new Error("Cloud returned disabled billing Runtime top-up packs.");
  }
  for (const rawPack of catalogRuntime.top_up_packs) {
    const pack = requireBillingRecord(rawPack, "runtime.top_up_pack");
    requireBillingString(pack.id, "runtime.top_up_pack.id");
    requireBillingString(pack.name, "runtime.top_up_pack.name");
    requireBillingString(pack.currency, "runtime.top_up_pack.currency");
    requireBillingInteger(pack.runtime_units, "runtime.top_up_pack.runtime_units", 1);
    requireBillingInteger(pack.price_cents, "runtime.top_up_pack.price_cents", 1);
  }
  return catalog as unknown as DesktopBillingCatalog;
}

function requireBillingRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Cloud returned an invalid billing ${label}.`);
  }
  return value as Record<string, unknown>;
}

function requireBillingString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Cloud returned an invalid billing ${label}.`);
  }
  return value;
}

function requireBillingEnum<T extends string>(
  value: unknown,
  values: readonly T[],
  label: string,
): T {
  if (typeof value !== "string" || !values.includes(value as T)) {
    throw new Error(`Cloud returned an invalid billing ${label}.`);
  }
  return value as T;
}

function requireBillingTimestamp(value: unknown, label: string): string {
  const timestamp = requireBillingString(value, label);
  if (!Number.isFinite(Date.parse(timestamp))) {
    throw new Error(`Cloud returned an invalid billing ${label}.`);
  }
  return timestamp;
}

function requireBillingStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`Cloud returned an invalid billing ${label}.`);
  }
  return value;
}

function requireBillingBooleanRecord(value: unknown, label: string): Record<string, boolean> {
  const record = requireBillingRecord(value, label);
  if (Object.values(record).some((item) => typeof item !== "boolean")) {
    throw new Error(`Cloud returned an invalid billing ${label}.`);
  }
  return record as Record<string, boolean>;
}

function requireBillingLimitRecord(
  value: unknown,
  label: string,
  allowNull: boolean,
): Record<string, number | null> {
  const record = requireBillingRecord(value, label);
  for (const item of Object.values(record)) {
    if (item === null && allowNull) continue;
    if (!Number.isSafeInteger(item) || (item as number) < 0) {
      throw new Error(`Cloud returned an invalid billing ${label}.`);
    }
  }
  return record as Record<string, number | null>;
}

function requireBillingAllowRecord(value: unknown, label: string): Record<string, unknown> {
  const record = requireBillingRecord(value, label);
  for (const item of Object.values(record)) {
    if (item === null || typeof item === "string") continue;
    if (Array.isArray(item) && item.every((entry) => typeof entry === "string")) continue;
    throw new Error(`Cloud returned an invalid billing ${label}.`);
  }
  return record;
}

function requireBillingBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`Cloud returned an invalid billing ${label}.`);
  }
  return value;
}

function requireBillingInteger(value: unknown, label: string, minimum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new Error(`Cloud returned an invalid billing ${label}.`);
  }
  return value as number;
}

function requireBillingPositiveNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`Cloud returned an invalid billing ${label}.`);
  }
  return value;
}

function requireBillingSafeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`Cloud returned an invalid billing ${label}.`);
  }
  return value as number;
}

export function validateDesktopBillingSummary(value: unknown): DesktopBillingSummary {
  const summary = requireBillingRecord(value, "summary");
  requireBillingString(summary.org_id, "summary.org_id");
  requireBillingString(summary.plan_id, "summary.plan_id");
  requireBillingEnum(summary.status, [
    "free",
    "checkout_pending",
    "active",
    "change_pending",
    "cancel_scheduled",
    "past_due",
    "revoked",
    "disputed",
  ] as const, "summary.status");
  requireBillingString(summary.catalog_version, "summary.catalog_version");
  requireBillingInteger(summary.seat_quantity, "summary.seat_quantity", 0);
  requireBillingInteger(summary.source_revision, "summary.source_revision", 1);
  requireBillingBoolean(summary.portal_available, "summary.portal_available");
  requireBillingBoolean(summary.seat_changes_available, "summary.seat_changes_available");
  requireBillingInteger(summary.runtime_available_units, "summary.runtime_available_units", 0);
  requireBillingInteger(summary.runtime_reserved_units, "summary.runtime_reserved_units", 0);
  requireBillingBoolean(summary.runtime_overage_enabled, "summary.runtime_overage_enabled");
  requireBillingBoolean(summary.cancel_at_period_end, "summary.cancel_at_period_end");
  requireBillingInteger(
    summary.runtime_monthly_limit_cents,
    "summary.runtime_monthly_limit_cents",
    0,
  );
  requireBillingOptionalString(summary.pending_plan_id, "summary.pending_plan_id");
  requireBillingOptionalTimestamp(summary.current_period_end, "summary.current_period_end");
  return summary as unknown as DesktopBillingSummary;
}

function requireBillingOptionalString(value: unknown, label: string): string | null {
  if (value === null) return null;
  return requireBillingString(value, label);
}

function requireBillingOptionalTimestamp(value: unknown, label: string): string | null {
  if (value === null) return null;
  return requireBillingTimestamp(value, label);
}

export function validateDesktopBillingQuote(value: unknown): DesktopBillingQuote {
  const quote = requireBillingRecord(value, "quote");
  requireBillingString(quote.quote_id, "quote.quote_id");
  requireBillingString(quote.org_id, "quote.org_id");
  requireBillingEnum(quote.kind, ["checkout", "plan", "seats"] as const, "quote.kind");
  requireBillingString(quote.current_plan_id, "quote.current_plan_id");
  requireBillingString(quote.target_plan_id, "quote.target_plan_id");
  requireBillingString(quote.currency, "quote.currency");
  requireBillingString(quote.catalog_version, "quote.catalog_version");
  requireBillingTimestamp(quote.expires_at, "quote.expires_at");
  requireBillingInteger(quote.current_seats, "quote.current_seats", 0);
  requireBillingInteger(quote.target_seats, "quote.target_seats", 1);
  requireBillingInteger(quote.current_amount_cents, "quote.current_amount_cents", 0);
  requireBillingInteger(quote.target_amount_cents, "quote.target_amount_cents", 0);
  requireBillingSafeInteger(quote.delta_amount_cents, "quote.delta_amount_cents");
  requireBillingBoolean(quote.requires_confirmation, "quote.requires_confirmation");
  if (!["checkout", "plan_change", "seat_change"].includes(String(quote.application_mode))) {
    throw new Error("Cloud returned an invalid billing quote.application_mode.");
  }
  requireBillingRecord(quote.details, "quote.details");
  return quote as unknown as DesktopBillingQuote;
}

export function getCloudBillingSummary(
  session: DesktopCloudSession,
  orgId: string,
  onSessionChange?: MutableSessionHandler,
  apiBaseUrl?: string | null,
): Promise<DesktopBillingSummary> {
  return cloudApiRequest<unknown>(
    billingOrganizationPath(orgId, "summary"),
    session,
    onSessionChange,
    {},
    apiBaseUrl,
  ).then(validateDesktopBillingSummary);
}

export function getCloudBillingUsage(
  session: DesktopCloudSession,
  orgId: string,
  onSessionChange?: MutableSessionHandler,
  apiBaseUrl?: string | null,
): Promise<DesktopBillingUsage> {
  return cloudApiRequest<unknown>(
    billingOrganizationPath(orgId, "usage"),
    session,
    onSessionChange,
    {},
    apiBaseUrl,
  ).then(validateDesktopBillingUsage);
}

export function validateDesktopBillingUsage(value: unknown): DesktopBillingUsage {
  const usage = requireBillingRecord(value, "usage");
  const runtime = requireBillingRecord(usage.runtime, "usage.runtime");
  requireBillingString(runtime.org_id, "usage.runtime.org_id");
  for (const key of [
    "available_units",
    "reserved_units",
    "granted_units",
    "consumed_units",
    "postpaid_available_units",
    "postpaid_consumed_units",
  ]) {
    requireBillingInteger(runtime[key], `usage.runtime.${key}`, 0);
  }
  if (!Array.isArray(runtime.buckets) || runtime.buckets.some((item) => !isRecord(item))) {
    throw new Error("Cloud returned an invalid billing usage.runtime.buckets.");
  }
  const storage = requireBillingRecord(usage.storage, "usage.storage");
  requireBillingInteger(storage.logical_bytes, "usage.storage.logical_bytes", 0);
  requireBillingInteger(storage.version, "usage.storage.version", 0);
  const threshold = requireBillingInteger(
    storage.threshold_percent,
    "usage.storage.threshold_percent",
    0,
  );
  if (![0, 80, 95, 100].includes(threshold)) {
    throw new Error("Cloud returned an invalid billing usage.storage.threshold_percent.");
  }
  if (storage.limit_bytes !== null) {
    requireBillingInteger(storage.limit_bytes, "usage.storage.limit_bytes", 1);
  }
  if (storage.percent !== null) {
    const percent = requireBillingInteger(storage.percent, "usage.storage.percent", 0);
    if (percent > 100) {
      throw new Error("Cloud returned an invalid billing usage.storage.percent.");
    }
  }
  return usage as unknown as DesktopBillingUsage;
}

export function listCloudBillingOperations(
  session: DesktopCloudSession,
  orgId: string,
  onSessionChange?: MutableSessionHandler,
  apiBaseUrl?: string | null,
): Promise<DesktopBillingOperation[]> {
  return cloudApiRequest<unknown>(
    billingOrganizationPath(orgId, "operations"),
    session,
    onSessionChange,
    {},
    apiBaseUrl,
  ).then(validateDesktopBillingOperations);
}

export function getCloudBillingOperation(
  session: DesktopCloudSession,
  orgId: string,
  operationId: string,
  onSessionChange?: MutableSessionHandler,
  apiBaseUrl?: string | null,
): Promise<DesktopBillingOperation> {
  return cloudApiRequest<unknown>(
    billingOrganizationPath(orgId, `operations/${encodeURIComponent(operationId)}`),
    session,
    onSessionChange,
    {},
    apiBaseUrl,
  ).then(validateDesktopBillingOperation);
}

export function validateDesktopBillingOperations(value: unknown): DesktopBillingOperation[] {
  if (!Array.isArray(value)) {
    throw new Error("Cloud returned invalid billing operations.");
  }
  for (const rawOperation of value) validateDesktopBillingOperation(rawOperation);
  return value as DesktopBillingOperation[];
}

export function validateDesktopBillingOperation(value: unknown): DesktopBillingOperation {
  const operation = requireBillingRecord(value, "operation");
  requireBillingString(operation.id, "operation.id");
  requireBillingString(operation.org_id, "operation.org_id");
  requireBillingEnum(operation.kind, [
    "checkout",
    "seat_increase",
    "seat_decrease",
    "plan_change",
    "member_activation",
    "member_deactivation",
    "entitlement_provision",
  ] as const, "operation.kind");
  const state = requireBillingEnum(operation.state, [
    "pending",
    "requires_action",
    "processing",
    "retryable_failed",
    "succeeded",
    "canceled",
    "failed",
  ] as const, "operation.state");
  const terminal = requireBillingBoolean(operation.terminal, "operation.terminal");
  const retryable = requireBillingBoolean(operation.retryable, "operation.retryable");
  const actionRequired = requireBillingBoolean(
    operation.action_required,
    "operation.action_required",
  );
  const lifecycle = {
    pending: [false, true, false],
    requires_action: [false, false, true],
    processing: [false, true, false],
    retryable_failed: [false, true, false],
    succeeded: [true, false, false],
    canceled: [true, false, false],
    failed: [true, false, false],
  } satisfies Record<DesktopBillingOperationState, [boolean, boolean, boolean]>;
  const expected = lifecycle[state];
  if (terminal !== expected[0] || retryable !== expected[1] || actionRequired !== expected[2]) {
    throw new Error("Cloud returned inconsistent billing operation lifecycle flags.");
  }
  if (state === "retryable_failed" && operation.kind !== "entitlement_provision") {
    throw new Error("Cloud returned an inconsistent retryable billing operation.");
  }
  requireBillingOptionalString(operation.target_plan_id, "operation.target_plan_id");
  requireBillingOptionalString(operation.quote_id, "operation.quote_id");
  requireBillingOptionalString(operation.error_code, "operation.error_code");
  for (const [field, minimum] of [
    ["current_seat_quantity", 0],
    ["target_seat_quantity", 1],
    ["confirmed_revision", 1],
  ] as const) {
    const fieldValue = operation[field];
    if (fieldValue !== null) {
      requireBillingInteger(fieldValue, `operation.${field}`, minimum);
    }
  }
  for (const field of ["created_at", "updated_at", "completed_at"] as const) {
    requireBillingOptionalTimestamp(operation[field], `operation.${field}`);
  }
  if (state === "succeeded"
    && (operation.confirmed_revision === null || operation.completed_at === null)) {
    throw new Error("Cloud returned an incomplete succeeded billing operation.");
  }
  if (["checkout", "plan_change", "seat_increase", "seat_decrease"].includes(
    String(operation.kind),
  ) && (
    operation.target_plan_id === null
    || operation.current_seat_quantity === null
    || operation.target_seat_quantity === null
    || operation.quote_id === null
  )) {
    throw new Error("Cloud returned an incomplete commercial billing operation.");
  }
  return value as DesktopBillingOperation;
}

export function quoteCloudBillingPlan(
  session: DesktopCloudSession,
  orgId: string,
  targetPlanId: string,
  seatQuantity: number,
  idempotencyKey: string,
  onSessionChange?: MutableSessionHandler,
  apiBaseUrl?: string | null,
): Promise<DesktopBillingQuote> {
  return cloudApiRequest<unknown>(
    billingOrganizationPath(orgId, "plan/quote"),
    session,
    onSessionChange,
    billingMutationInit(
      "POST",
      idempotencyKey,
      { target_plan_id: targetPlanId, seat_quantity: seatQuantity },
    ),
    apiBaseUrl,
  ).then(validateDesktopBillingQuote);
}

export function quoteCloudBillingSeats(
  session: DesktopCloudSession,
  orgId: string,
  seatQuantity: number,
  idempotencyKey: string,
  operationId?: string | null,
  onSessionChange?: MutableSessionHandler,
  apiBaseUrl?: string | null,
): Promise<DesktopBillingQuote> {
  return cloudApiRequest<unknown>(
    billingOrganizationPath(orgId, "seats/quote"),
    session,
    onSessionChange,
    billingMutationInit(
      "POST",
      idempotencyKey,
      {
        seat_quantity: seatQuantity,
        ...(operationId ? { operation_id: operationId } : {}),
      },
    ),
    apiBaseUrl,
  ).then(validateDesktopBillingQuote);
}

export function createCloudBillingCheckout(
  session: DesktopCloudSession,
  orgId: string,
  values: {
    planId: string;
    seatQuantity: number;
    quoteId?: string | null;
    operationId?: string | null;
  },
  idempotencyKey: string,
  onSessionChange?: MutableSessionHandler,
  apiBaseUrl?: string | null,
): Promise<DesktopBillingCheckout> {
  return cloudApiRequest<unknown>(
    billingOrganizationPath(orgId, "checkout"),
    session,
    onSessionChange,
    billingMutationInit("POST", idempotencyKey, {
      plan_id: values.planId,
      seat_quantity: values.seatQuantity,
      ...(values.quoteId ? { quote_id: values.quoteId } : {}),
      ...(values.operationId ? { operation_id: values.operationId } : {}),
    }),
    apiBaseUrl,
  ).then(validateDesktopBillingCheckout);
}

export function validateDesktopBillingCheckout(value: unknown): DesktopBillingCheckout {
  const checkout = requireBillingRecord(value, "checkout");
  requireBillingString(checkout.checkout_id, "checkout.checkout_id");
  requireBillingString(checkout.checkout_url, "checkout.checkout_url");
  validateDesktopBillingQuote(checkout.quote);
  validateDesktopBillingOperation(checkout.operation);
  return checkout as unknown as DesktopBillingCheckout;
}

export function applyCloudBillingPlanChange(
  session: DesktopCloudSession,
  orgId: string,
  quoteId: string,
  idempotencyKey: string,
  onSessionChange?: MutableSessionHandler,
  apiBaseUrl?: string | null,
): Promise<DesktopBillingAppliedQuote> {
  return cloudApiRequest<unknown>(
    billingOrganizationPath(orgId, "plan/change"),
    session,
    onSessionChange,
    billingMutationInit("POST", idempotencyKey, { quote_id: quoteId }),
    apiBaseUrl,
  ).then(validateDesktopBillingAppliedQuote);
}

export function applyCloudBillingSeatChange(
  session: DesktopCloudSession,
  orgId: string,
  quoteId: string,
  idempotencyKey: string,
  operationId?: string | null,
  onSessionChange?: MutableSessionHandler,
  apiBaseUrl?: string | null,
): Promise<DesktopBillingAppliedQuote> {
  return cloudApiRequest<unknown>(
    billingOrganizationPath(orgId, "seats/change"),
    session,
    onSessionChange,
    billingMutationInit("POST", idempotencyKey, {
      quote_id: quoteId,
      ...(operationId ? { operation_id: operationId } : {}),
    }),
    apiBaseUrl,
  ).then(validateDesktopBillingAppliedQuote);
}

export function validateDesktopBillingAppliedQuote(value: unknown): DesktopBillingAppliedQuote {
  const applied = requireBillingRecord(value, "applied quote");
  validateDesktopBillingQuote(applied);
  validateDesktopBillingOperation(applied.operation);
  return value as DesktopBillingAppliedQuote;
}

export function createCloudBillingPortal(
  session: DesktopCloudSession,
  orgId: string,
  idempotencyKey: string,
  onSessionChange?: MutableSessionHandler,
  apiBaseUrl?: string | null,
): Promise<{ portal_url: string; expires_at: string | null }> {
  return cloudApiRequest<unknown>(
    billingOrganizationPath(orgId, "portal"),
    session,
    onSessionChange,
    billingMutationInit("POST", idempotencyKey),
    apiBaseUrl,
  ).then(validateDesktopBillingPortal);
}

export function validateDesktopBillingPortal(
  value: unknown,
): { portal_url: string; expires_at: string | null } {
  const portal = requireBillingRecord(value, "portal");
  requireBillingString(portal.portal_url, "portal.portal_url");
  requireBillingOptionalString(portal.expires_at, "portal.expires_at");
  return portal as { portal_url: string; expires_at: string | null };
}

export async function openCloudBillingExternalUrl(href: string): Promise<void> {
  if (/[\u0000-\u001f\u007f]/.test(href) || /%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(href)) {
    throw new Error("Cloud returned an unsafe billing URL.");
  }
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    throw new Error("Cloud returned an invalid billing URL.");
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(loopback && url.protocol === "http:")) || url.username || url.password) {
    throw new Error("Cloud returned an unsafe billing URL.");
  }
  if (window.puppyoneDesktop?.openExternalUrl) {
    await window.puppyoneDesktop.openExternalUrl(url.toString());
    return;
  }
  const opened = window.open(url.toString(), "_blank", "noopener,noreferrer");
  if (!opened) throw new Error("The billing page could not be opened.");
}


export function getCloudDashboard(
  session: DesktopCloudSession,
  projectId: string,
  onSessionChange?: MutableSessionHandler,
  apiBaseUrl?: string | null,
): Promise<DesktopCloudDashboard> {
  return cloudApiRequest<DesktopCloudDashboard>(`/projects/${projectId}/dashboard`, session, onSessionChange, {}, apiBaseUrl);
}

export function listCloudRoot(
  session: DesktopCloudSession,
  projectId: string,
  onSessionChange?: MutableSessionHandler,
  apiBaseUrl?: string | null,
): Promise<DesktopCloudTree> {
  return listCloudDirectory(session, projectId, "", onSessionChange, apiBaseUrl);
}

export function listCloudDirectory(
  session: DesktopCloudSession,
  projectId: string,
  path = "",
  onSessionChange?: MutableSessionHandler,
  apiBaseUrl?: string | null,
): Promise<DesktopCloudTree> {
  return cloudApiRequest<DesktopCloudTree>(
    `/content/${projectId}/ls?path=${encodeURIComponent(path.replace(/^\/+/, ""))}`,
    session,
    onSessionChange,
    {},
    apiBaseUrl,
  );
}

export function listCloudAccessPointDirectory(
  accessKey: string,
  path = "",
  userEmail?: string | null,
  remoteUrl?: string | null,
  apiBaseUrl?: string | null,
): Promise<DesktopCloudTree> {
  const normalizedPath = path.replace(/^\/+/, "");
  if (window.puppyoneDesktop?.listCloudAccessPointDirectory) {
    return window.puppyoneDesktop.listCloudAccessPointDirectory({
      accessKey,
      path: normalizedPath,
      userEmail: userEmail ?? null,
      remoteUrl: remoteUrl ?? null,
      apiBaseUrl: apiBaseUrl ?? getDesktopCloudApiBaseUrl(),
    });
  }

  const headers: Record<string, string> = {
    "X-Access-Key": accessKey,
    "X-Puppy-Client": "cli",
  };
  if (userEmail) headers["X-PuppyOne-User"] = userEmail;

  const query = new URLSearchParams({
    path: normalizedPath,
    include_hidden: "true",
    include_size: "true",
  });

  return requestPublic<DesktopCloudTree>(
    `/ap-fs/ls?${query.toString()}`,
    {
      method: "GET",
      headers,
    },
    desktopCloudApiBaseUrlFromRemote(remoteUrl ?? null) ?? apiBaseUrl,
  );
}

export function getCloudAccessPointSemantics(
  accessKey: string,
  userEmail?: string | null,
  remoteUrl?: string | null,
  apiBaseUrl?: string | null,
): Promise<DesktopCloudAccessPointSemantics> {
  if (window.puppyoneDesktop?.getCloudAccessPointSemantics) {
    return window.puppyoneDesktop.getCloudAccessPointSemantics({
      accessKey,
      userEmail: userEmail ?? null,
      remoteUrl: remoteUrl ?? null,
      apiBaseUrl: apiBaseUrl ?? getDesktopCloudApiBaseUrl(),
    });
  }

  const headers: Record<string, string> = {
    "X-Access-Key": accessKey,
    "X-Puppy-Client": "cli",
  };
  if (userEmail) headers["X-PuppyOne-User"] = userEmail;

  return requestPublic<DesktopCloudAccessPointSemantics>(
    "/ap-fs/semantics",
    {
      method: "GET",
      headers,
    },
    desktopCloudApiBaseUrlFromRemote(remoteUrl ?? null) ?? apiBaseUrl,
  );
}

export function listCloudScopes(
  session: DesktopCloudSession,
  projectId: string,
  onSessionChange?: MutableSessionHandler,
  apiBaseUrl?: string | null,
): Promise<DesktopCloudScope[]> {
  return cloudApiRequest<DesktopCloudScope[]>(`/projects/${projectId}/scopes`, session, onSessionChange, {}, apiBaseUrl);
}

export function createCloudScope(
  session: DesktopCloudSession,
  projectId: string,
  body: DesktopCloudCreateScopeRequest,
  onSessionChange?: MutableSessionHandler,
  apiBaseUrl?: string | null,
): Promise<DesktopCloudScope> {
  return cloudApiRequest<DesktopCloudScope>(
    `/projects/${encodeURIComponent(projectId)}/scopes`,
    session,
    onSessionChange,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
    apiBaseUrl,
  );
}

export function listCloudConnectors(
  session: DesktopCloudSession,
  projectId: string,
  onSessionChange?: MutableSessionHandler,
  apiBaseUrl?: string | null,
): Promise<DesktopCloudConnector[]> {
  return cloudApiRequest<DesktopCloudConnector[]>(`/projects/${projectId}/connectors`, session, onSessionChange, {}, apiBaseUrl);
}

export function updateCloudConnector(
  session: DesktopCloudSession,
  projectId: string,
  connectorId: string,
  body: DesktopCloudConnectorPatch,
  onSessionChange?: MutableSessionHandler,
  apiBaseUrl?: string | null,
): Promise<DesktopCloudConnector> {
  return cloudApiRequest<DesktopCloudConnector>(
    `/projects/${encodeURIComponent(projectId)}/connectors/${encodeURIComponent(connectorId)}`,
    session,
    onSessionChange,
    {
      method: "PATCH",
      body: JSON.stringify(body),
    },
    apiBaseUrl,
  );
}

export const {
  supportsCloudAutomationOauth,
  getCloudAutomationOauthStatus,
  getCloudAutomationOauthAuthorizeUrl,
  openCloudAutomationAuthorizationUrl,
  listCloudAutomationProviderResources,
  listCloudAutomationProviderSpecs,
  createCloudAutomation,
  updateCloudAutomationConnection,
  updateCloudAutomationTrigger,
  listCloudAutomationConnectionRuns,
  getCloudAutomationRun,
  refreshCloudAutomationConnection,
  pauseCloudAutomationConnection,
  resumeCloudAutomationConnection,
  deleteCloudAutomationConnection,
} = createCloudAutomationApi(cloudApiRequest);

export function listCloudMcpEndpoints(
  session: DesktopCloudSession,
  projectId: string,
  onSessionChange?: MutableSessionHandler,
  apiBaseUrl?: string | null,
): Promise<DesktopCloudMcpEndpoint[]> {
  return cloudApiRequest<DesktopCloudMcpEndpoint[]>(
    `/mcp-endpoints?project_id=${encodeURIComponent(projectId)}`,
    session,
    onSessionChange,
    {},
    apiBaseUrl,
  );
}

export function createCloudMcpEndpoint(
  session: DesktopCloudSession,
  body: DesktopCloudCreateMcpEndpointRequest,
  onSessionChange?: MutableSessionHandler,
  apiBaseUrl?: string | null,
): Promise<DesktopCloudMcpEndpoint> {
  return cloudApiRequest<DesktopCloudMcpEndpoint>(
    "/mcp-endpoints",
    session,
    onSessionChange,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
    apiBaseUrl,
  );
}

export function updateCloudMcpEndpoint(
  session: DesktopCloudSession,
  endpointId: string,
  body: DesktopCloudUpdateMcpEndpointRequest,
  onSessionChange?: MutableSessionHandler,
  apiBaseUrl?: string | null,
): Promise<DesktopCloudMcpEndpoint> {
  return cloudApiRequest<DesktopCloudMcpEndpoint>(
    `/mcp-endpoints/${encodeURIComponent(endpointId)}`,
    session,
    onSessionChange,
    {
      method: "PUT",
      body: JSON.stringify(body),
    },
    apiBaseUrl,
  );
}

export function deleteCloudMcpEndpoint(
  session: DesktopCloudSession,
  endpointId: string,
  onSessionChange?: MutableSessionHandler,
  apiBaseUrl?: string | null,
): Promise<void> {
  return cloudApiRequest<void>(
    `/mcp-endpoints/${encodeURIComponent(endpointId)}`,
    session,
    onSessionChange,
    { method: "DELETE" },
    apiBaseUrl,
  );
}

export function getCloudRepoIdentity(
  session: DesktopCloudSession,
  projectId: string,
  onSessionChange?: MutableSessionHandler,
  apiBaseUrl?: string | null,
): Promise<DesktopCloudRepoIdentity> {
  return cloudApiRequest<DesktopCloudRepoIdentity>(`/projects/${projectId}/access-point`, session, onSessionChange, {}, apiBaseUrl);
}

export function updateCloudScope(
  session: DesktopCloudSession,
  projectId: string,
  scopeId: string,
  patch: DesktopCloudScopePatch,
  onSessionChange?: MutableSessionHandler,
  apiBaseUrl?: string | null,
): Promise<DesktopCloudScope> {
  return cloudApiRequest<DesktopCloudScope>(
    `/projects/${projectId}/scopes/${scopeId}`,
    session,
    onSessionChange,
    {
      method: "PATCH",
      body: JSON.stringify(patch),
    },
    apiBaseUrl,
  );
}

export function deleteCloudScope(
  session: DesktopCloudSession,
  projectId: string,
  scopeId: string,
  onSessionChange?: MutableSessionHandler,
  apiBaseUrl?: string | null,
): Promise<void> {
  return cloudApiRequest<void>(
    `/projects/${projectId}/scopes/${scopeId}`,
    session,
    onSessionChange,
    { method: "DELETE" },
    apiBaseUrl,
  );
}

async function requestPublic<T>(path: string, init: RequestInit, apiBaseUrl?: string | null): Promise<T> {
  return requestRaw<T>(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init.headers,
    },
  }, apiBaseUrl);
}

function normalizeRequestHeaders(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) {
    const out: Record<string, string> = {};
    headers.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers.map(([key, value]) => [key, value]));
  }
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, String(value)]));
}

async function requestRaw<T = unknown>(path: string, init: RequestInit, apiBaseUrl?: string | null): Promise<T> {
  const normalizedApiBaseUrl = resolveCloudApiBaseUrl(apiBaseUrl || getDesktopCloudApiBaseUrl());
  if (window.puppyoneDesktop?.requestCloudApi) {
    const body = typeof init.body === "string" ? init.body : undefined;
    try {
      const transported = await window.puppyoneDesktop.requestCloudApi({
        apiBaseUrl: normalizedApiBaseUrl,
        path: path.startsWith("/") ? path : `/${path}`,
        method: init.method ?? "GET",
        headers: normalizeRequestHeaders(init.headers),
        ...(body === undefined ? {} : { body }),
      });
      return unwrapCloudIpcEnvelope<T>(transported);
    } catch (error) {
      throw normalizeCloudBridgeInvocationError(error);
    }
  }

  const response = await fetch(buildCanonicalCloudApiUrl(path, apiBaseUrl), init);
  let payload: ApiEnvelope<T> | null = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const error = new Error(getCloudApiErrorMessage(payload, `Request failed (${response.status})`));
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }

  return (payload && "data" in payload ? payload.data : payload) as T;
}

function getCloudApiErrorMessage(payload: ApiEnvelope<unknown> | null, fallback: string): string {
  const detail = payload?.detail;
  if (typeof payload?.message === "string" && payload.message) return payload.message;
  if (typeof detail === "string" && detail) return detail;
  if (isRecord(detail) && typeof detail.message === "string" && detail.message) return detail.message;
  if (typeof payload?.error === "string" && payload.error) return payload.error;
  return fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object");
}

function unwrapCloudIpcEnvelope<T>(value: unknown): T {
  if (!isRecord(value) || value.transport !== "puppyone-cloud-ipc-v1") {
    // Unit-test adapters may return data directly. The production Electron
    // bridge always uses the versioned envelope above.
    return value as T;
  }
  if (value.ok === true) return value.data as T;
  const transported = isRecord(value.error) ? value.error : {};
  const normalized = new Error(
    typeof transported.message === "string" && transported.message
      ? transported.message
      : "Cloud request failed.",
  );
  if (typeof transported.status === "number") {
    (normalized as Error & { status?: number }).status = transported.status;
  }
  if (typeof transported.code === "string" && transported.code) {
    (normalized as Error & { code?: string }).code = transported.code;
  }
  throw normalized;
}

function normalizeCloudBridgeInvocationError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(String(error || "Cloud IPC invocation failed."));
}

function formatCloudApiHost(apiBaseUrl: string) {
  return formatCanonicalCloudApiHost(apiBaseUrl);
}
