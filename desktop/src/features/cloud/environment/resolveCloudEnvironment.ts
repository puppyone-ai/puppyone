import { desktopCloudApiBaseUrlFromRemote } from "../../../lib/cloudApi";
import type { GitStatusSnapshot, PuppyoneWorkspaceConfig } from "../../../types/electron";
import { getPuppyoneRemote } from "../../source-control/remotes";

export type CloudEnvironmentSource = "remote" | "config" | "default";

export type CloudEnvironment = {
  apiBaseUrl: string | null;
  source: CloudEnvironmentSource;
  cloudRemote: ReturnType<typeof getPuppyoneRemote>;
  configuredProjectId: string | null;
};

export function resolveCloudEnvironment({
  status,
  puppyoneConfig,
}: {
  status: GitStatusSnapshot | null;
  puppyoneConfig?: PuppyoneWorkspaceConfig | null;
}): CloudEnvironment {
  const cloudRemote = getPuppyoneRemote(status);
  const apiBaseUrl = desktopCloudApiBaseUrlFromRemote(cloudRemote?.rawUrl ?? null);
  const configuredProjectId = puppyoneConfig?.cloud?.projectId?.trim() || null;

  return {
    apiBaseUrl,
    source: cloudRemote ? "remote" : configuredProjectId ? "config" : "default",
    cloudRemote,
    configuredProjectId,
  };
}
