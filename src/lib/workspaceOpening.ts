import type {
  WorkspaceCloneRepositoryRequest,
  WorkspaceCreateProjectRequest,
  WorkspaceCreateProjectResult,
  WorkspaceOpenResult,
  WorkspaceProjectLocationGrant,
} from "../types/electron";
import {
  cloneRepository as cloneRepositoryBridge,
  createLocalProject as createLocalProjectBridge,
  getDefaultLocalProjectLocation as getDefaultLocalProjectLocationBridge,
  openDroppedWorkspaceInCurrentWindow as openDroppedWorkspaceInCurrentWindowBridge,
  openWorkspaceInCurrentWindow as openWorkspaceInCurrentWindowBridge,
  openWorkspaceInNewWindow as openWorkspaceInNewWindowBridge,
  selectLocalProjectLocation as selectLocalProjectLocationBridge,
  selectWorkspaceFolder as selectWorkspaceFolderBridge,
  selectWorkspaceFolderInNewWindow as selectWorkspaceFolderInNewWindowBridge,
} from "./localFiles";

export type WorkspaceOpenPlacement = "current-window" | "dedicated-window";

export type WorkspaceOpenTarget = {
  kind: "local";
  path: string;
  placement?: WorkspaceOpenPlacement;
};

export async function openWorkspaceTarget(target: WorkspaceOpenTarget): Promise<WorkspaceOpenResult> {
  if (target.placement === "current-window") {
    return openWorkspaceInCurrentWindowBridge(target.path);
  }

  return openWorkspaceInNewWindowBridge(target.path);
}

export async function openDroppedWorkspaceTarget(folder: File): Promise<WorkspaceOpenResult> {
  return openDroppedWorkspaceInCurrentWindowBridge(folder);
}

export async function createLocalProjectTarget(
  request: WorkspaceCreateProjectRequest,
): Promise<WorkspaceCreateProjectResult> {
  return createLocalProjectBridge(request);
}

export async function selectLocalProjectLocationTarget(): Promise<WorkspaceProjectLocationGrant | null> {
  return selectLocalProjectLocationBridge();
}

export async function defaultLocalProjectLocationTarget(): Promise<WorkspaceProjectLocationGrant | null> {
  return getDefaultLocalProjectLocationBridge();
}

export async function cloneRepositoryTarget(
  request: WorkspaceCloneRepositoryRequest,
): Promise<WorkspaceOpenResult | null> {
  return cloneRepositoryBridge(request);
}

export async function selectLocalWorkspaceFolder({
  placement = "current-window",
}: {
  placement?: WorkspaceOpenPlacement;
} = {}): Promise<WorkspaceOpenResult | null> {
  return placement === "dedicated-window"
    ? selectWorkspaceFolderInNewWindowBridge()
    : selectWorkspaceFolderBridge();
}
