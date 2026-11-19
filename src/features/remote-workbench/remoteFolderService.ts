import type { DataPort, ResourceUri, Workspace, WorkspaceFolder } from "@puppyone/shared-ui";

/** Provider-relative paths that changed, or null when the provider cannot name the scope. */
export type RemoteFolderChange = readonly string[] | null;

/**
 * What any remote folder provider gives the shared workbench: Cloud project or
 * another computer. The provider owns transport, its path-scoped caches and
 * change events; the workbench owns presentation.
 */
export type RemoteFolderService = {
  workspace: Workspace;
  folder: WorkspaceFolder;
  dataPort: DataPort;
  writable: boolean;
  /** Drop every cached read; used only when the changed scope is unknown. */
  invalidateReads: () => void;
  resolveResource: (resource: string | null) => { folder: WorkspaceFolder; providerPath: string | null; resourceUri: ResourceUri } | null;
  getPathForCopy: (resource: string) => string;
  /** Change events invalidate the provider's own caches before `changed` runs. */
  watch?: (changed: (paths: RemoteFolderChange) => void, failed: (error: Error) => void) => () => void;
  resume?: () => Promise<unknown> | unknown;
};
