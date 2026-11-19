import { useCallback, useMemo } from "react";
import type { DesktopCloudSession } from "../../../lib/cloudApi";
import type { FilesVisibilitySettings } from "../../../preferences";
import type { ProjectCloudContext } from "../project/context/projectCloudContext";
import { createCloudDataService, type NativeCloudDataService } from "../files/cloudDataPort";
import type { CloudWorkspaceHandoff } from "../files/cloudWorkspaceHandoff";
import { createPendingCloudDataService } from "./pendingCloudDataService";
import { useRemoteFolderWorkbench, type RemoteFolderWorkbench } from "../../remote-workbench";

/** A Cloud project in the shared remote workbench. */
export function useNativeCloudWorkbench({ context, session, apiBaseUrl, active, filesVisibilitySettings, prepared }: {
  context: ProjectCloudContext;
  session: DesktopCloudSession | null;
  apiBaseUrl: string | null;
  active: boolean;
  filesVisibilitySettings: FilesVisibilitySettings;
  prepared?: CloudWorkspaceHandoff;
}) {
  const resolved = context.status === "resolved" ? context : null;
  const serviceKey = resolved && session && apiBaseUrl
    ? JSON.stringify([apiBaseUrl, session.user_id, session.session_generation,
      resolved.projectId, resolved.target, resolved.scopePath, resolved.projectName, resolved.capabilities])
    : null;
  const pendingService = useMemo(() => createPendingCloudDataService(apiBaseUrl, "Puppyone Cloud"), [apiBaseUrl]);
  const createService = useCallback((isCurrent: () => boolean) => resolved && session && apiBaseUrl
    ? createCloudDataService({ context: resolved, session, apiBaseUrl, prepared, isCurrent }) : null,
  // Rebuilt only with the key; see useRemoteFolderWorkbench.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [serviceKey, prepared]);
  return useRemoteFolderWorkbench<NativeCloudDataService>({ serviceKey, dependency: prepared, createService,
    pendingService, active, filesVisibilitySettings });
}

export type NativeCloudWorkbench = RemoteFolderWorkbench<NativeCloudDataService>;
