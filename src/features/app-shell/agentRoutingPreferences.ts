import type { AgentRoutePreference } from "../desktop-agent/domain/agent-route-preference";

export type { AgentRoutePreference } from "../desktop-agent/domain/agent-route-preference";

export const AGENT_ROUTING_PREFERENCES_VERSION = 2 as const;

export type AgentRoutingPreferences = {
  version: typeof AGENT_ROUTING_PREFERENCES_VERSION;
  selectedRuntimeId: string | null;
  routes: Record<string, AgentRoutePreference>;
};

type LegacyAgentPreference = {
  legacyRuntimeId?: string | null;
  legacyModelId?: string | null;
};

const RUNTIME_ID = /^[a-z][a-z0-9-]{1,39}$/;
const ROUTE_VALUE = /^[^\r\n\0]{1,512}$/;

export function createAgentRoutingPreferences(
  value: Partial<AgentRoutingPreferences> = {},
): AgentRoutingPreferences {
  return {
    version: AGENT_ROUTING_PREFERENCES_VERSION,
    selectedRuntimeId: runtimeId(value.selectedRuntimeId),
    routes: normalizeRoutes(value.routes),
  };
}

export function parseAgentRoutingPreferences(
  value: string | null | undefined,
  legacy: LegacyAgentPreference = {},
): AgentRoutingPreferences {
  try {
    const parsed = value ? JSON.parse(value) : null;
    if (parsed?.version === AGENT_ROUTING_PREFERENCES_VERSION) {
      return createAgentRoutingPreferences(parsed);
    }
    if (parsed?.version === 1) {
      // Version 1 could be written after the old controller silently selected
      // its registry default. Keep scoped routes, but require a fresh choice.
      return createAgentRoutingPreferences({ selectedRuntimeId: null, routes: parsed.routes });
    }
  } catch {
    // Invalid preferences are replaced with a bounded migration result.
  }
  const legacyRuntimeId = runtimeId(legacy.legacyRuntimeId);
  const legacyModelId = routeValue(legacy.legacyModelId);
  return createAgentRoutingPreferences({
    // The legacy key was also written by the old implicit-default flow, so it
    // cannot prove that the user chose this Agent. Preserve only its route.
    selectedRuntimeId: null,
    routes: legacyRuntimeId && legacyModelId
      ? { [legacyRuntimeId]: { modelId: legacyModelId } }
      : {},
  });
}

export function updateAgentRoutePreference(
  preferences: AgentRoutingPreferences,
  runtime: string,
  patch: Partial<AgentRoutePreference>,
): AgentRoutingPreferences {
  const id = runtimeId(runtime);
  if (!id) return createAgentRoutingPreferences(preferences);
  const route = normalizeRoute({ ...(preferences.routes[id] ?? {}), ...patch });
  const currentRoute = preferences.routes[id] ?? {};
  if (routeEquals(currentRoute, route)) return preferences;
  const routes = { ...preferences.routes };
  if (Object.keys(route).length > 0) routes[id] = route;
  else delete routes[id];
  return createAgentRoutingPreferences({ ...preferences, routes });
}

function routeEquals(left: AgentRoutePreference, right: AgentRoutePreference) {
  return ["providerId", "modelId", "variant", "effort", "mode"]
    .every((key) => left[key as keyof AgentRoutePreference] === right[key as keyof AgentRoutePreference]);
}

export function selectAgentRuntime(
  preferences: AgentRoutingPreferences,
  runtime: string | null,
): AgentRoutingPreferences {
  return createAgentRoutingPreferences({ ...preferences, selectedRuntimeId: runtimeId(runtime) });
}

export function serializeAgentRoutingPreferences(preferences: AgentRoutingPreferences): string {
  return JSON.stringify(createAgentRoutingPreferences(preferences));
}

function normalizeRoutes(value: unknown): Record<string, AgentRoutePreference> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .slice(0, 32)
    .map(([id, route]) => [runtimeId(id), normalizeRoute(route)] as const)
    .filter(([id, route]) => Boolean(id) && Object.keys(route).length > 0)
    .map(([id, route]) => [id as string, route]));
}

function normalizeRoute(value: unknown): AgentRoutePreference {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return compact({
    providerId: routeValue(source.providerId),
    modelId: routeValue(source.modelId),
    variant: routeValue(source.variant),
    effort: routeValue(source.effort),
    mode: routeValue(source.mode),
  });
}

function runtimeId(value: unknown): string | null {
  if (typeof value !== "string" || !RUNTIME_ID.test(value.trim())) return null;
  // The former WorkBuddy selection is channel-ambiguous. Requiring a fresh
  // explicit choice prevents silently routing a China account to International.
  return value.trim() === "workbuddy" ? null : value.trim();
}

function routeValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().slice(0, 512);
  return ROUTE_VALUE.test(normalized) ? normalized : undefined;
}

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}
