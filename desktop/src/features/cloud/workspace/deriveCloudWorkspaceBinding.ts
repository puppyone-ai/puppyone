import type { getPuppyoneRemote } from "../../source-control/remotes";
import type { CloudWorkspaceBindingState } from "./cloudWorkspaceTypes";

export function deriveCloudWorkspaceBinding({
  cloudRemote,
  projectId,
  loading,
  error,
}: {
  cloudRemote: ReturnType<typeof getPuppyoneRemote>;
  projectId: string | null;
  loading: boolean;
  error: string | null;
}): CloudWorkspaceBindingState {
  if (projectId) {
    return { status: "mapped", projectId };
  }
  if (cloudRemote && loading) {
    return { status: "resolving", remoteUrl: cloudRemote.rawUrl };
  }
  if (cloudRemote) {
    return { status: "remote-only", remoteUrl: cloudRemote.rawUrl };
  }
  if (error) {
    return { status: "error", message: error };
  }
  return { status: "unmapped" };
}
