import type { DesktopCloudSession } from "../../../lib/cloudApi";
import type { ProjectCloudContext } from "../project/context/projectCloudContext";
import type { CloudEntry } from "./contracts";
import type { CloudWorkbench } from "./contracts";

/** A one-use read result, never a cached authorization grant. */
export type CloudWorkspaceHandoff = Readonly<{
  identity: string;
  workspace: CloudWorkbench;
  root: { entries: CloudEntry[] };
  expiresAt: number;
  isValid: () => boolean;
}>;
const consumed = new WeakSet<CloudWorkspaceHandoff>();

export function cloudWorkspaceIdentity(session: DesktopCloudSession,
  context: Extract<ProjectCloudContext, { status: "resolved" }>, apiBaseUrl: string) {
  return JSON.stringify([apiBaseUrl, session.user_id, session.session_generation,
    context.projectId, context.target, context.scopePath ?? "", [...(context.capabilities ?? [])].sort()]);
}

export function inspectCloudWorkspaceHandoff(value: CloudWorkspaceHandoff | undefined, identity: string) {
  if (!value || value.identity !== identity || consumed.has(value)
    || Date.now() >= value.expiresAt || !value.isValid()) return null;
  return value;
}

export function takeCloudWorkspaceHandoff(value: CloudWorkspaceHandoff | undefined, identity: string) {
  value = inspectCloudWorkspaceHandoff(value, identity) ?? undefined;
  if (!value) return null;
  consumed.add(value);
  return value;
}
