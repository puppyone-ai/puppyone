import type { CloudWorkspaceSection } from "../../routes/cloudRouteIds";
import { normalizeCloudSection } from "../../routes/cloudRoutes";
import { cloudMessage, type CloudMessageDescriptor } from "../../cloudPresentation";
import type { RepositoryTarget } from "../../repositoryTarget";

/** Ephemeral UI context resolved from the open repository's canonical remote. */
export type ProjectCloudContext =
  | { status: "local-only"; projectId: null }
  | { status: "resolving"; projectId: null }
  | {
      status: "resolved";
      projectId: string;
      target: RepositoryTarget;
      scopePath?: string | null;
      capabilities?: string[];
      warning?: CloudMessageDescriptor;
    }
  | { status: "not-authorized"; projectId: string | null; message: CloudMessageDescriptor }
  | { status: "wrong-account"; projectId: string | null; message: CloudMessageDescriptor }
  | { status: "wrong-host"; projectId: string | null; message: CloudMessageDescriptor }
  | { status: "locator-conflict"; projectId: string | null; message: CloudMessageDescriptor }
  | { status: "not-found"; projectId: string | null; message: CloudMessageDescriptor }
  | { status: "temporarily-unavailable"; projectId: string | null; message: CloudMessageDescriptor }
  | { status: "unresolvable"; projectId: null; message: CloudMessageDescriptor }
  | { status: "error"; projectId: null; message: CloudMessageDescriptor };

export function getResolvedCloudProjectId(context: ProjectCloudContext): string | null {
  return context.status === "resolved" ? context.projectId : null;
}

export function cloudContextHasProject(context: ProjectCloudContext): boolean {
  return Boolean(getResolvedCloudProjectId(context));
}

export function isCloudContextRecovery(
  context: ProjectCloudContext,
): context is Extract<ProjectCloudContext, {
  status:
    | "not-authorized"
    | "wrong-account"
    | "wrong-host"
    | "locator-conflict"
    | "not-found"
    | "temporarily-unavailable"
    | "unresolvable"
    | "error";
}> {
  return context.status === "not-authorized"
    || context.status === "wrong-account"
    || context.status === "wrong-host"
    || context.status === "locator-conflict"
    || context.status === "not-found"
    || context.status === "temporarily-unavailable"
    || context.status === "unresolvable"
    || context.status === "error";
}

export function getCloudContextWarning(
  context: ProjectCloudContext,
): CloudMessageDescriptor | null {
  if (context.status === "resolved") return context.warning ?? null;
  return isCloudContextRecovery(context) ? context.message : null;
}

export function resolveProjectCloudContext({
  resolvedProjectId,
  remoteProjectId,
  contextError,
  contextReason = null,
  hasCanonicalRemote,
  resolving,
  target = null,
  scopePath = null,
  capabilities = [],
}: {
  resolvedProjectId: string | null;
  remoteProjectId: string | null;
  contextError: CloudMessageDescriptor | null;
  contextReason?:
    | "not-authorized"
    | "unresolvable"
    | "network"
    | "wrong-account"
    | "wrong-host"
    | "locator-conflict"
    | "not-found"
    | null;
  hasCanonicalRemote: boolean;
  resolving: boolean;
  target?: RepositoryTarget | null;
  scopePath?: string | null;
  capabilities?: string[];
}): ProjectCloudContext {
  const projectId = resolvedProjectId?.trim() || null;
  if (projectId && target?.project_id === projectId) {
    return {
      status: "resolved",
      projectId,
      target,
      ...(scopePath ? { scopePath } : {}),
      ...(capabilities.length > 0 ? { capabilities } : {}),
      ...(contextError ? { warning: contextError } : {}),
    };
  }

  if (contextError) {
    const candidate = remoteProjectId?.trim() || null;
    if (contextReason === "not-authorized") {
      return { status: "not-authorized", projectId: candidate, message: contextError };
    }
    if (contextReason === "wrong-account" || contextReason === "wrong-host"
      || contextReason === "locator-conflict" || contextReason === "not-found") {
      return { status: contextReason, projectId: candidate, message: contextError };
    }
    if (contextReason === "network") {
      return { status: "temporarily-unavailable", projectId: candidate, message: contextError };
    }
    if (contextReason === "unresolvable" || hasCanonicalRemote) {
      return { status: "unresolvable", projectId: null, message: contextError };
    }
    return { status: "error", projectId: null, message: contextError };
  }

  if (resolving) return { status: "resolving", projectId: null };
  if (hasCanonicalRemote) {
    return {
      status: "unresolvable",
      projectId: null,
      message: cloudMessage("remote-unresolvable"),
    };
  }
  return { status: "local-only", projectId: null };
}

export function resolveCloudHubSectionForContext(
  context: ProjectCloudContext,
): "initialize" | "contents" {
  return cloudContextHasProject(context) ? "contents" : "initialize";
}

export function resolveCloudHubSectionAfterContextChange({
  currentSection,
  hasProjectContext,
  workspaceChanged,
}: {
  currentSection: CloudWorkspaceSection;
  hasProjectContext: boolean;
  workspaceChanged: boolean;
}): CloudWorkspaceSection {
  if (workspaceChanged) return hasProjectContext ? "contents" : "initialize";
  if (!hasProjectContext) {
    return isCloudOrganizationSection(currentSection) || currentSection === "share"
      ? currentSection
      : "initialize";
  }
  // Initialization owns its transition to `contents` after the push succeeds.
  // A newly resolvable remote can be an interrupted, retryable attempt and must
  // not pull the user away from the Initialize screen prematurely.
  return currentSection;
}

function isCloudOrganizationSection(section: CloudWorkspaceSection): boolean {
  const normalized = normalizeCloudSection(section);
  return normalized === "cloud-team"
    || normalized === "cloud-billing";
}
