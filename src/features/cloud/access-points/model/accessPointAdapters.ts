import type {
  DesktopCloudAccessSurface,
  DesktopCloudMcpEndpoint,
  DesktopCloudRepoIdentity,
  DesktopCloudRepositoryView,
  DesktopCloudScope,
} from "../../../../lib/cloudApi";
import { repositoryTargetKey, sameRepositoryTarget } from "../../repositoryTarget";
import {
  getApiBaseFromGitUrl,
  getCanonicalGitUrlForView,
  getCloudScopeRows,
  getScopeIdentifierName,
  getScopePathLabel,
  profileSlug,
  shellQuote,
} from "../../utils";
import type {
  AccessPoint,
  AccessPointCatalogKind,
  AccessPointKind,
  AccessPointRow,
} from "./accessPoint";
import { normalizeAccessPointStatus } from "./accessPoint";
import { resolveAccessPointKind } from "./accessPointKindRegistry";

export type AccessPointProjection = Readonly<{
  scopeRows: DesktopCloudRepositoryView[];
  connectorsByTarget: Map<string, DesktopCloudAccessSurface[]>;
  mcpEndpointsByTarget: Map<string, DesktopCloudMcpEndpoint[]>;
  accessPointRows: AccessPointRow[];
}>;

export type AccessPointAdapterOptions = Readonly<{
  scope: DesktopCloudRepositoryView;
  connectors: DesktopCloudAccessSurface[];
  mcpEndpoints: DesktopCloudMcpEndpoint[];
  identity: DesktopCloudRepoIdentity | null;
  apiBaseUrl: string | null;
  placeholderKinds?: readonly AccessPointKind[];
}>;

export function buildAccessPointProjection({
  scopes,
  connectors,
  mcpEndpoints,
  identity,
  apiBaseUrl,
  catalogKind = "all",
}: {
  scopes: DesktopCloudScope[];
  connectors: DesktopCloudAccessSurface[];
  mcpEndpoints: DesktopCloudMcpEndpoint[];
  identity: DesktopCloudRepoIdentity | null;
  apiBaseUrl: string | null;
  catalogKind?: AccessPointCatalogKind;
}): AccessPointProjection {
  const scopeRows = getCloudScopeRows(scopes, identity, connectors[0]?.project_id);
  const connectorsByTarget = groupConnectorsByTarget(connectors);
  const mcpEndpointsByTarget = groupMcpEndpointsByTarget(connectors, mcpEndpoints);
  return {
    scopeRows,
    connectorsByTarget,
    mcpEndpointsByTarget,
    accessPointRows: buildAccessPointRows({
      scopeRows,
      connectors,
      mcpEndpoints,
      identity,
      apiBaseUrl,
      placeholderKinds: catalogKind === "mcp" ? ["mcp"] : [],
    }),
  };
}

export function buildAccessPointRows({
  scopeRows,
  connectors,
  mcpEndpoints,
  identity,
  apiBaseUrl,
  placeholderKinds = [],
}: {
  scopeRows: DesktopCloudRepositoryView[];
  connectors: DesktopCloudAccessSurface[];
  mcpEndpoints: DesktopCloudMcpEndpoint[];
  identity: DesktopCloudRepoIdentity | null;
  apiBaseUrl: string | null;
  placeholderKinds?: readonly AccessPointKind[];
}): AccessPointRow[] {
  return scopeRows.flatMap((scope): AccessPointRow[] => (
    buildAccessPointsForScope({
      scope,
      connectors,
      mcpEndpoints,
      identity,
      apiBaseUrl,
      placeholderKinds,
    }).map((accessPoint) => ({
      id: `${scope.id}:${accessPoint.id}`,
      scope,
      accessPoint,
    }))
  ));
}

export function buildAccessPointsForScope({
  scope,
  connectors,
  mcpEndpoints,
  identity,
  apiBaseUrl,
  placeholderKinds = [],
}: AccessPointAdapterOptions): AccessPoint[] {
  const context = getAccessPointContext({ scope, identity, apiBaseUrl });
  const scopeConnectors = connectors.filter((connector) => sameRepositoryTarget(connector.target, scope.target));
  const scopeMcpSurfaces = scopeConnectors.filter((surface) => surface.kind === "mcp" || surface.kind === "mcp_endpoint");
  const cliConnector = scopeConnectors.find((connector) => resolveAccessPointKind(connector.kind) === "cli");
  const gitConnector = scopeConnectors.find((connector) => resolveAccessPointKind(connector.kind) === "git");
  const accessPoints: AccessPoint[] = [
    {
      id: `builtin:cli:${scope.id}`,
      kind: "cli",
      sourceProvider: "cli",
      title: "",
      subtitle: "",
      status: normalizeAccessPointStatus(cliConnector?.status),
      connector: cliConnector,
      placeholder: !cliConnector,
      commands: [
        { id: "login", value: context.cliCommand, disabled: !context.cliCommand },
        {
          id: "explore",
          value: `puppyone fs tree / --profile ${shellQuote(context.profileName)}\npuppyone fs ls / --profile ${shellQuote(context.profileName)}`,
          disabled: !context.cliCommand,
        },
      ],
    },
    {
      id: `builtin:git:${scope.id}`,
      kind: "git",
      sourceProvider: gitConnector?.kind ?? "git",
      title: "",
      subtitle: "",
      status: normalizeAccessPointStatus(gitConnector?.status),
      connector: gitConnector,
      placeholder: !gitConnector,
      commands: [
        {
          id: "existing-folder",
          value: `git remote add puppyone ${context.gitUrl || "<git-url>"}\ngit fetch puppyone`,
          disabled: !context.gitUrl,
        },
        {
          id: "clone",
          value: `git clone ${context.gitUrl || "<git-url>"} ${shellQuote(context.scopeName)}`,
          disabled: !context.gitUrl,
        },
      ],
    },
    ...scopeMcpSurfaces.map((surface): AccessPoint => {
      // Adapter detail is the same persisted Access ID, never a path-based join.
      const endpoint = mcpEndpoints.find((item) => item.id === surface.id && item.project_id === surface.project_id);
      const accessLabel = endpoint?.accesses?.length
        ? endpoint.accesses.map((access) => access.path || "/").join(", ")
        : scope.path || "/";
      return {
        id: `mcp:${surface.id}`,
        kind: "mcp",
        sourceProvider: surface.kind,
        title: surface.name || endpoint?.name || "",
        subtitle: accessLabel,
        status: normalizeAccessPointStatus(surface.status),
        connector: surface,
        endpoint,
        // Ordinary reads contain hints, not a runnable credential or key URL.
        commands: [],
      };
    }),
  ];

  return placeholderKinds.reduce(
    (points, kind) => ensureAccessPointPlaceholder(scope, points, kind),
    accessPoints,
  );
}

export function getAccessPointContext({
  scope,
  identity,
  apiBaseUrl,
}: {
  scope: DesktopCloudRepositoryView;
  identity: DesktopCloudRepoIdentity | null;
  apiBaseUrl: string | null;
}) {
  const apiBase = identity?.url ? getApiBaseFromGitUrl(identity.url) : apiBaseUrl ?? "";
  const scopeName = getScopeIdentifierName(scope);
  const profileName = profileSlug(scopeName);
  const gitUrl = getCanonicalGitUrlForView(identity, scope, apiBase);
  // Target metadata never exposes shared credentials. One-time issuance is
  // owned by the dedicated credential action, not ordinary repository reads.
  const cliCommand = "";
  return { apiBase, scopeName, profileName, gitUrl, cliCommand };
}

export function isAccessPointPlaceholder(accessPoint: AccessPoint): boolean {
  return accessPoint.placeholder === true;
}

export function isMcpAccessPointPlaceholder(accessPoint: AccessPoint): boolean {
  return accessPoint.placeholder === true && accessPoint.kind === "mcp";
}

export function isVmAccessPointPlaceholder(accessPoint: AccessPoint): boolean {
  return accessPoint.placeholder === true && accessPoint.kind === "vm";
}

export function isAccessPointNavigationResource(row: AccessPointRow): boolean {
  return row.accessPoint.kind !== "custom";
}

function ensureAccessPointPlaceholder(
  scope: DesktopCloudRepositoryView,
  accessPoints: AccessPoint[],
  kind: AccessPointKind,
): AccessPoint[] {
  if (accessPoints.some((accessPoint) => accessPoint.kind === kind)) return accessPoints;
  if (kind !== "mcp" && kind !== "vm") return accessPoints;
  return [
    ...accessPoints,
    {
      id: `placeholder:${kind}:${scope.id}`,
      kind,
      sourceProvider: kind,
      title: "",
      subtitle: getScopePathLabel(scope),
      status: normalizeAccessPointStatus("missing"),
      placeholder: true,
    },
  ];
}

function groupConnectorsByTarget(connectors: DesktopCloudAccessSurface[]) {
  const groups = new Map<string, DesktopCloudAccessSurface[]>();
  for (const connector of connectors) {
    const key = repositoryTargetKey(connector.target);
    const group = groups.get(key) ?? [];
    group.push(connector);
    groups.set(key, group);
  }
  return groups;
}

function groupMcpEndpointsByTarget(
  surfaces: DesktopCloudAccessSurface[],
  mcpEndpoints: DesktopCloudMcpEndpoint[],
) {
  const groups = new Map<string, DesktopCloudMcpEndpoint[]>();
  for (const surface of surfaces) {
    if (surface.kind !== "mcp" && surface.kind !== "mcp_endpoint") continue;
    const endpoint = mcpEndpoints.find((item) => item.id === surface.id && item.project_id === surface.project_id);
    if (!endpoint) continue;
    const key = repositoryTargetKey(surface.target);
    groups.set(key, [...(groups.get(key) ?? []), endpoint]);
  }
  return groups;
}
