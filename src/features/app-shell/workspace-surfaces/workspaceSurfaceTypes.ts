import type { ReactNode } from "react";

export type WorkspaceSurfaceId =
  | "data"
  | "git"
  | "cloud"
  | "settings";

export type WorkspaceSurfaceLifecycle = "keep-alive" | "on-demand";

export type WorkspaceSurfaceNavigationGroup =
  | "workspace"
  | "cloud-hub"
  | "settings";

export type WorkspaceSurfaceNavigation = {
  labelId: string;
  group: WorkspaceSurfaceNavigationGroup;
  order: number;
};

export type WorkspaceSurfaceCapabilities = {
  cloudEnabled: boolean;
};

export type WorkspaceSurfaceContent = {
  sidebar: ReactNode | null;
  main: ReactNode | null;
};

export type WorkspaceSurfaceAdapters = Readonly<Record<
  WorkspaceSurfaceId,
  () => WorkspaceSurfaceContent
>>;

export type WorkspaceSurfaceContributionDefinition = {
  id: WorkspaceSurfaceId;
  navigation: WorkspaceSurfaceNavigation;
  lifecycle: {
    sidebar: WorkspaceSurfaceLifecycle;
    main: WorkspaceSurfaceLifecycle;
  };
  isAvailable: (capabilities: WorkspaceSurfaceCapabilities) => boolean;
};

export type WorkspaceSurfaceContribution = WorkspaceSurfaceContributionDefinition & {
  create: (adapters: WorkspaceSurfaceAdapters) => WorkspaceSurfaceContent;
};

export type ResolvedWorkspaceSurface = WorkspaceSurfaceContribution & {
  content: WorkspaceSurfaceContent;
};
