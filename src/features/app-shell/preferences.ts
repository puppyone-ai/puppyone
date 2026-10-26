import type { PuppyoneWorkspaceConfig } from "../../types/electron";

export function mergePuppyoneWorkspaceConfig(
  current: PuppyoneWorkspaceConfig | null,
  patch: Partial<{
    sync: {
      sourceOfTruth: Partial<PuppyoneWorkspaceConfig["sync"]["sourceOfTruth"]>;
    };
    backup: Partial<PuppyoneWorkspaceConfig["backup"]>;
    git: Partial<PuppyoneWorkspaceConfig["git"]>;
  }>,
): PuppyoneWorkspaceConfig {
  const currentSourceOfTruth = current?.sync?.sourceOfTruth;
  const sourceOfTruth = {
    service: currentSourceOfTruth?.service ?? current?.backup?.service ?? "github",
    remote: currentSourceOfTruth?.remote ?? current?.git?.primaryRemote ?? current?.backup?.remote ?? null,
    branch: currentSourceOfTruth?.branch ?? current?.git?.watchedBranch ?? current?.backup?.branch ?? null,
    ...patch.sync?.sourceOfTruth,
  };
  if (sourceOfTruth.service === "puppyone") {
    sourceOfTruth.branch = null;
  }

  const git = {
    primaryRemote: current?.git?.primaryRemote ?? sourceOfTruth.remote,
    watchedBranch: current?.git?.watchedBranch ?? sourceOfTruth.branch,
    ...patch.git,
  };
  if (sourceOfTruth.service === "puppyone") {
    git.watchedBranch = null;
  }

  const backup = {
    enabled: current?.backup?.enabled ?? false,
    service: current?.backup?.service ?? sourceOfTruth.service,
    remote: current?.backup?.remote ?? sourceOfTruth.remote,
    branch: current?.backup?.branch ?? sourceOfTruth.branch,
    ...patch.backup,
  };
  if (backup.service === "puppyone") {
    backup.branch = null;
  }

  return {
    version: 3,
    sync: {
      sourceOfTruth,
    },
    git,
    backup,
    ...(current?.updatedAt ? { updatedAt: current.updatedAt } : {}),
  };
}
