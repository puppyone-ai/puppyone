import type { DesktopCloudSession } from "../../../lib/cloudApi";
import type { ProjectCloudContext } from "../project/context/projectCloudContext";
import type { CloudWorkspaceHandoff } from "./cloudWorkspaceHandoff";
import { createCloudWorkspaceFiles, type CloudWorkspaceFiles } from "./cloudWorkspaceFiles";
import { createCloudWorkspaceSession } from "./cloudWorkspaceSession";
import { watchCloudWorkspace, type CloudWorkspaceChange } from "./cloudWorkspaceWatch";

export type { CloudWorkbench } from "./contracts";
export type { WorkspaceEntry, WorkspaceVersion } from "./cloudWorkspaceProtocol";
export { decodeWorkspaceBytes, encodeWorkspaceBytes, parseWorkspaceVersion } from "./cloudWorkspaceProtocol";
export type { CloudWorkspaceChange } from "./cloudWorkspaceWatch";

/**
 * Live files only. No provider SDK, Git publication or published-content fallback.
 * Composes the pinned workbench session, path-scoped file I/O and change events.
 */
export function createCloudWorkspaceClient(session: DesktopCloudSession,
  context: Extract<ProjectCloudContext, { status: "resolved" }>, apiBaseUrl: string,
  assertCurrent: () => void = () => {}, prepared?: CloudWorkspaceHandoff) {
  let files: CloudWorkspaceFiles | undefined;
  const workspace = createCloudWorkspaceSession({ session, context, apiBaseUrl, assertCurrent, prepared,
    onRequestFailed: () => files?.invalidate() });
  files = createCloudWorkspaceFiles(workspace, assertCurrent);
  const live = files;
  return {
    ensure: workspace.ensure,
    list: live.list,
    stat: (path: string) => live.stat(path, context.projectName ?? context.projectId),
    read: live.read,
    readText: live.readText,
    write: live.write,
    change: live.change,
    invalidate: live.invalidate,
    peekDirectory: live.peekDirectory,
    handoff: live.handoff,
    watch: (onChange: (paths: CloudWorkspaceChange) => void, onError: (error: Error) => void) => watchCloudWorkspace({
      workspace, files: live, session, projectId: context.projectId, apiBaseUrl, assertCurrent }, onChange, onError),
    openingProgress: workspace.openingProgress,
    sandbox: workspace.sandbox,
    setSandboxSettings: workspace.setSandboxSettings,
    screenSession: workspace.screenSession,
    resume: async () => { const row = await workspace.resume(); live.invalidate(); return row; },
  };
}
