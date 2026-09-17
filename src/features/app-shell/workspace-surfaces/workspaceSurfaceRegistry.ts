import type {
  ResolvedWorkspaceSurface,
  WorkspaceSurfaceAdapters,
  WorkspaceSurfaceCapabilities,
  WorkspaceSurfaceContribution,
  WorkspaceSurfaceContributionDefinition,
  WorkspaceSurfaceId,
} from "./workspaceSurfaceTypes";

const WORKSPACE_SURFACE_CONTRIBUTIONS = [
  defineWorkspaceSurface({
    id: "data",
    navigation: { labelId: "shell.navigation.data", group: "workspace", order: 10 },
    lifecycle: { sidebar: "keep-alive", main: "keep-alive" },
    isAvailable: () => true,
  }),
  defineWorkspaceSurface({
    id: "git",
    navigation: { labelId: "shell.navigation.git", group: "workspace", order: 20 },
    lifecycle: { sidebar: "on-demand", main: "on-demand" },
    isAvailable: () => true,
  }),
  defineWorkspaceSurface({
    id: "cloud",
    navigation: { labelId: "shell.navigation.cloud", group: "cloud-hub", order: 30 },
    lifecycle: { sidebar: "on-demand", main: "on-demand" },
    isAvailable: ({ cloudEnabled }) => cloudEnabled,
  }),
  defineWorkspaceSurface({
    id: "settings",
    navigation: { labelId: "shell.navigation.settings", group: "settings", order: 40 },
    lifecycle: { sidebar: "on-demand", main: "on-demand" },
    isAvailable: () => true,
  }),
] as const satisfies readonly WorkspaceSurfaceContribution[];

export function defineWorkspaceSurface<T extends WorkspaceSurfaceContributionDefinition>(
  definition: T,
): T & Pick<WorkspaceSurfaceContribution, "create"> {
  return {
    ...definition,
    create: (adapters) => adapters[definition.id](),
  };
}

export function getAvailableWorkspaceSurfaces(
  capabilities: WorkspaceSurfaceCapabilities,
): readonly WorkspaceSurfaceContribution[] {
  return WORKSPACE_SURFACE_CONTRIBUTIONS
    .filter((contribution) => contribution.isAvailable(capabilities))
    .sort((left, right) => left.navigation.order - right.navigation.order);
}

export function resolveWorkspaceSurface({
  capabilities,
  adapters,
  requestedId,
}: {
  capabilities: WorkspaceSurfaceCapabilities;
  adapters: WorkspaceSurfaceAdapters;
  requestedId: WorkspaceSurfaceId;
}): ResolvedWorkspaceSurface {
  const contribution = resolveWorkspaceSurfaceContribution(requestedId, capabilities);
  return {
    ...contribution,
    content: contribution.create(adapters),
  };
}

export function resolveWorkspaceSurfaceContribution(
  requestedId: WorkspaceSurfaceId,
  capabilities: WorkspaceSurfaceCapabilities,
): WorkspaceSurfaceContribution {
  const available = getAvailableWorkspaceSurfaces(capabilities);
  return available.find(({ id }) => id === requestedId)
    ?? available.find(({ id }) => id === "data")
    ?? WORKSPACE_SURFACE_CONTRIBUTIONS[0];
}

export function isWorkspaceSurfaceAvailable(
  id: WorkspaceSurfaceId,
  capabilities: WorkspaceSurfaceCapabilities,
): boolean {
  return getAvailableWorkspaceSurfaces(capabilities).some((surface) => surface.id === id);
}

export { WORKSPACE_SURFACE_CONTRIBUTIONS };
