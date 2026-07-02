import type { GitStatusSnapshot, PuppyoneWorkspaceConfig } from "../../types/electron";
import { getPuppyoneRemote, parsePuppyoneRemote } from "./remotes";
import type {
  GitScmSyncAction,
  GitScmSyncCopy,
  GitScmSyncSection,
  GitSidebarPrimaryAction,
  GitSyncState,
  SourceControlDisplayMode,
  SourceControlSidebarModel,
} from "./types";

export function getGitSyncState(
  status: GitStatusSnapshot | null,
  currentBranch: GitStatusSnapshot["branches"][number] | null,
  puppyoneConfig: PuppyoneWorkspaceConfig | null = null,
): GitSyncState {
  if (!status?.isRepo) {
    return {
      branchLabel: "No branch",
      upstreamLabel: "No repository",
      remoteExists: false,
      setupRequired: true,
      setupTitle: "Choose sync target",
      setupDetail: "Initialize a repository, then create a PuppyOne Cloud backup.",
      behind: 0,
      ahead: 0,
      pullDetail: "No local repository.",
      pullDisabled: true,
      pushDisabled: true,
      pullLabel: "Pull remote changes",
      pullTitle: "Initialize a repository before pulling.",
      pushTitle: "Initialize a repository before pushing.",
      pushLabel: "Push",
      pushDetail: "No local repository.",
    };
  }

  if (!currentBranch?.upstream) {
    const branchLabel = displayGitBranch(status);
    const preferredRemote = getPreferredGitRemote(status, puppyoneConfig);
    const puppyoneRemote = getPuppyoneRemote(status)?.remote
      ?? status.remotes.find((remote) => remote.name.toLowerCase() === "puppyone");
    const configuredCloudBackup = puppyoneConfig?.backup?.enabled === true;
    const publishRemote = preferredRemote ?? puppyoneRemote;
    const backupBranch = puppyoneConfig?.sync?.sourceOfTruth?.branch
      ?? puppyoneConfig?.backup?.branch
      ?? puppyoneConfig?.git?.watchedBranch
      ?? branchLabel;
    const syncTarget = status.syncTarget;

    if (publishRemote) {
      const isPuppyonePublishRemote = publishRemote.name.toLowerCase() === "puppyone" || publishRemote === puppyoneRemote;
      const publishLabel = isPuppyonePublishRemote ? "Publish" : "Push";
      const publishTargetLabel = syncTarget?.ref ?? `${publishRemote.name}/${backupBranch}`;
      const targetExists = syncTarget?.exists === true;
      const targetAhead = targetExists ? syncTarget.ahead : 0;
      const targetBehind = targetExists ? syncTarget.behind : 0;
      return {
        branchLabel,
        upstreamLabel: publishTargetLabel,
        remoteExists: targetExists,
        setupRequired: false,
        setupTitle: "Sync target",
        setupDetail: `${publishRemote.name} is configured as the primary remote.`,
        behind: targetBehind,
        ahead: targetAhead,
        pullDetail: targetExists
          ? `${targetBehind} remote commit${targetBehind === 1 ? "" : "s"} on ${publishTargetLabel}.`
          : `No remote branch at ${publishTargetLabel}.`,
        pullDisabled: !targetExists || targetBehind === 0,
        pushDisabled: targetExists
          ? targetAhead === 0
          : !status.headCommitId,
        pullLabel: "Pull remote changes",
        pullTitle: targetExists
          ? targetBehind === 0 ? "Already up to date." : `Pull ${targetBehind} commit${targetBehind === 1 ? "" : "s"} from ${publishTargetLabel}.`
          : "Remote branch does not exist yet.",
        pushTitle: status.headCommitId
          ? targetExists && targetBehind > 0
            ? `${publishLabel} ${targetAhead} local commit${targetAhead === 1 ? "" : "s"} to ${publishTargetLabel}. Remote also has incoming commits, so Git may reject this push until you pull or resolve divergence.`
            : `${publishLabel} ${branchLabel} to ${publishTargetLabel} and set tracking.`
          : `Create a local commit before ${publishLabel.toLowerCase()}ing.`,
        pushLabel: publishLabel,
        pushDetail: targetExists
          ? targetAhead > 0
            ? `${targetAhead} local commit${targetAhead === 1 ? "" : "s"} waiting.`
            : `No local commits waiting for ${publishTargetLabel}.`
          : `${publishLabel} ${branchLabel} to create ${publishTargetLabel}.`,
      };
    }

    if (configuredCloudBackup) {
      return {
        branchLabel,
        upstreamLabel: "PuppyOne Cloud",
        remoteExists: false,
        setupRequired: false,
        setupTitle: "Sync target",
        setupDetail: "PuppyOne Cloud backup is enabled in .puppyone/config.json.",
        behind: 0,
        ahead: 0,
        pullDetail: "Configure a Git remote before pulling.",
        pullDisabled: true,
        pushDisabled: true,
        pullLabel: "Pull remote changes",
        pullTitle: "Configure a Git remote before pulling.",
        pushTitle: "Configure a Git remote before pushing.",
        pushLabel: "Publish",
        pushDetail: "Cloud backup is enabled, but no Git remote is configured.",
      };
    }

    return {
      branchLabel,
      upstreamLabel: "Local only",
      remoteExists: false,
      setupRequired: true,
      setupTitle: "Choose sync target",
      setupDetail: `${branchLabel} is local only. Back it up with PuppyOne Cloud.`,
      behind: 0,
      ahead: 0,
      pullDetail: "No tracking branch.",
      pullDisabled: true,
      pushDisabled: true,
      pullLabel: "Pull remote changes",
      pullTitle: "Choose a sync target before pulling.",
      pushTitle: "Choose a sync target before pushing.",
      pushLabel: "Push",
      pushDetail: "Choose a sync target first.",
    };
  }

  const upstreamRemoteName = getUpstreamRemoteName(currentBranch.upstream);
  const upstreamRemote = status.remotes.find((remote) => remote.name === upstreamRemoteName) ?? null;
  const isPuppyoneRemote = Boolean(parsePuppyoneRemote(upstreamRemote?.pushUrl ?? upstreamRemote?.fetchUrl ?? null));
  const ahead = currentBranch.ahead || 0;
  const behind = currentBranch.behind || 0;
  const pushLabel = isPuppyoneRemote ? "Publish" : "Push";
  const branchLabel = displayGitBranch(status);
  const pullDetail = behind > 0 && ahead > 0
    ? `Pull ${behind} remote commit${behind === 1 ? "" : "s"} before ${pushLabel.toLowerCase()}ing.`
    : `${behind} commit${behind === 1 ? "" : "s"} on ${currentBranch.upstream}.`;

  return {
    branchLabel,
    upstreamLabel: currentBranch.upstream,
    remoteExists: true,
    setupRequired: false,
    setupTitle: "Sync target",
    setupDetail: `Tracking ${currentBranch.upstream}.`,
    behind,
    ahead,
    pullDetail,
    pullDisabled: behind === 0,
    pushDisabled: ahead === 0,
    pullLabel: behind > 0 ? `Pull ${behind} commit${behind === 1 ? "" : "s"}` : "Pull remote changes",
    pullTitle: behind === 0 ? "Already up to date." : `Pull ${behind} commit${behind === 1 ? "" : "s"} from ${currentBranch.upstream}.`,
    pushTitle: ahead === 0
      ? "No local commits to push."
      : behind > 0
        ? `${pushLabel} ${ahead} local commit${ahead === 1 ? "" : "s"} to ${currentBranch.upstream}. Remote also has incoming commits, so Git may reject this push until you pull or resolve divergence.`
        : `${pushLabel} ${ahead} commit${ahead === 1 ? "" : "s"} to ${currentBranch.upstream}.`,
    pushLabel,
    pushDetail: ahead > 0
      ? `${ahead} committed change${ahead === 1 ? "" : "s"} waiting.`
      : "No committed changes waiting.",
  };
}

export function buildSourceControlSidebarModel({
  status,
  syncState,
  displayMode,
  canCommit,
}: {
  status: GitStatusSnapshot | null;
  syncState: GitSyncState;
  displayMode: SourceControlDisplayMode;
  canCommit: boolean;
}): SourceControlSidebarModel {
  const sourceControl = status?.sourceControl ?? null;
  const groupById = new Map((sourceControl?.groups ?? []).map((group) => [group.id, group.resources]));
  const mergeResources = groupById.get("merge") ?? [];
  const stagedResources = groupById.get("index") ?? [];
  const workingResources = [
    ...(groupById.get("workingTree") ?? []),
    ...(groupById.get("untracked") ?? []),
  ];
  const professionalMode = displayMode === "professional";
  const committedCount = sourceControl?.remote.ahead ?? 0;
  const committedResources = sourceControl?.remote.outgoingPreview ?? [];
  const committedPrimaryAction = getCommittedPrimaryAction(status, syncState);
  const stagedPrimaryAction = getStagedPrimaryAction(status, syncState, stagedResources.length, canCommit, professionalMode);
  const localChangeResources = professionalMode ? workingResources : [...stagedResources, ...workingResources];

  return {
    professionalMode,
    mergeResources,
    stagedResources,
    workingResources,
    localChangeResources,
    committedCount,
    committedResources,
    committedPrimaryAction,
    showCommittedSection: professionalMode || committedCount > 0 || Boolean(committedPrimaryAction),
    stagedPrimaryAction,
    showSimpleChangeAction: !professionalMode && localChangeResources.length > 0,
  };
}

export function displayGitBranch(status: GitStatusSnapshot) {
  return status.branch && status.branch !== "detached" ? status.branch : "initial branch";
}

function getUpstreamRemoteName(upstream: string) {
  const slashIndex = upstream.indexOf("/");
  return slashIndex > 0 ? upstream.slice(0, slashIndex) : upstream;
}

function getPreferredGitRemote(status: GitStatusSnapshot | null, config: PuppyoneWorkspaceConfig | null) {
  const remotes = status?.remotes ?? [];
  const configuredRemoteName = config?.sync?.sourceOfTruth?.remote ?? config?.git?.primaryRemote ?? config?.backup?.remote;
  if (configuredRemoteName) {
    const configuredRemote = remotes.find((remote) => remote.name === configuredRemoteName);
    if (configuredRemote) return configuredRemote;
  }

  return remotes.find((remote) => remote.name === "origin")
    ?? remotes.find((remote) => remote.name.toLowerCase() === "puppyone")
    ?? remotes[0]
    ?? null;
}

export function getGitScmSyncCopy(
  status: GitStatusSnapshot | null,
  state: GitSyncState,
): GitScmSyncCopy {
  const remote = status?.sourceControl.remote;
  const target = remote?.target?.ref ?? state.upstreamLabel;
  if (!remote) {
    return { title: "Remote Changes", count: 0, detail: "Reading Git state.", tone: "muted" };
  }

  if (remote.state === "publish") {
    return {
      title: "Remote Branch",
      count: 0,
      detail: `Publish ${state.branchLabel} to ${target}.`,
      tone: "pending",
    };
  }

  if (remote.state === "diverged") {
    return {
      title: "Remote Changes",
      count: remote.behind,
      detail: `${remote.ahead} outgoing waiting locally`,
      tone: "warning",
    };
  }

  if (remote.state === "incoming") {
    return {
      title: "Remote Changes",
      count: remote.behind,
      detail: target,
      tone: "warning",
    };
  }

  if (remote.state === "outgoing") {
    return {
      title: "Outgoing Commits",
      count: remote.ahead,
      detail: target,
      tone: "pending",
    };
  }

  if (remote.state === "no-remote") {
    return {
      title: "Remote Changes",
      count: 0,
      detail: "Connect a remote to sync this workspace.",
      tone: "muted",
    };
  }

  return {
    title: "Remote Changes",
    count: 0,
    detail: target,
    tone: "ready",
  };
}

export function getGitScmSyncSection(
  status: GitStatusSnapshot | null,
  state: GitSyncState,
): GitScmSyncSection {
  const remote = status?.sourceControl.remote;
  const copy = getGitScmSyncCopy(status, state);
  const action = getGitScmSyncAction(remote, state);
  const previewResources = remote && remote.behind > 0 ? remote.incomingPreview : [];
  const fallbackSummary = getGitScmSyncFallbackSummary(remote, copy, state, previewResources.length);

  return {
    copy,
    action,
    previewResources,
    fallbackSummary,
  };
}

export function getGitScmSyncAction(
  remote: GitStatusSnapshot["sourceControl"]["remote"] | undefined,
  state: GitSyncState,
): GitScmSyncAction | null {
  if (!remote) return null;

  if (remote.canPublish) {
    return {
      kind: "publish",
      label: "Publish Branch",
      loadingLabel: "Publishing...",
      title: state.pushTitle,
      disabled: false,
      icon: "upload",
    };
  }

  if (remote.state === "diverged") {
    return {
      kind: "pull",
      label: "Pull",
      loadingLabel: "Pulling...",
      title: "Pull incoming commits first. Push outgoing commits after the pull succeeds.",
      disabled: !remote.canPull,
      icon: "download",
    };
  }

  if (remote.canPull) {
    return {
      kind: "pull",
      label: "Pull",
      loadingLabel: "Pulling...",
      title: state.pullTitle,
      disabled: false,
      icon: "download",
    };
  }

  if (remote.canPush) {
    return {
      kind: "push",
      label: state.pushLabel,
      loadingLabel: "Pushing...",
      title: state.pushTitle,
      disabled: false,
      icon: "upload",
    };
  }

  return null;
}

function getGitScmSyncFallbackSummary(
  remote: GitStatusSnapshot["sourceControl"]["remote"] | undefined,
  copy: GitScmSyncCopy,
  state: GitSyncState,
  previewCount: number,
) {
  if (!remote || copy.count === 0 || previewCount > 0) return null;

  if (remote.behind > 0) {
    return `${remote.behind} remote commit${remote.behind === 1 ? "" : "s"} ready to pull from ${remote.target?.ref ?? remote.upstream ?? state.upstreamLabel}.`;
  }

  if (remote.ahead > 0) {
    return `${remote.ahead} local commit${remote.ahead === 1 ? "" : "s"} ready to ${state.pushLabel.toLowerCase()}.`;
  }

  return null;
}

export function getCommittedPrimaryAction(
  status: GitStatusSnapshot | null,
  state: GitSyncState,
): GitSidebarPrimaryAction | null {
  const remote = status?.sourceControl.remote;
  if (!remote) return null;

  if (remote.canPublish) {
    return {
      label: "Publish",
      title: state.pushTitle,
      disabled: false,
      kind: "publish",
      loadingKey: "publish",
      loadingLabel: "Publishing...",
      icon: "upload",
    };
  }

  if (remote.canPush) {
    return {
      label: state.pushLabel,
      title: state.pushTitle,
      disabled: false,
      kind: "push",
      loadingKey: "push",
      loadingLabel: "Pushing...",
      icon: "upload",
    };
  }

  return null;
}

export function getStagedPrimaryAction(
  status: GitStatusSnapshot | null,
  state: GitSyncState,
  stagedCount: number,
  canCommit: boolean,
  professionalMode: boolean,
): GitSidebarPrimaryAction | null {
  const remote = status?.sourceControl.remote;
  const publish = remote?.state === "publish" || remote?.canPublish === true;
  const label = publish ? "Commit & Publish" : "Commit & Push";
  const commitOnly: GitSidebarPrimaryAction = {
    label: "Commit",
    title: "Commit staged changes locally.",
    disabled: false,
    kind: "commit",
    loadingKey: "commit",
    loadingLabel: "Committing...",
    icon: "plus",
  };

  if (stagedCount === 0) {
    return null;
  }

  if (!canCommit) {
    return {
      label: "Commit",
      title: "Stage changes before committing.",
      disabled: true,
      kind: "commit",
      loadingKey: "commit",
      loadingLabel: "Committing...",
      icon: "plus",
    };
  }

  if (professionalMode) {
    return commitOnly;
  }

  if (!remote?.target && !remote?.upstream) {
    return commitOnly;
  }

  if (remote.behind > 0) {
    return {
      ...commitOnly,
      title: "Commit locally first, then pull remote changes before pushing.",
    };
  }

  return {
    label,
    title: publish
      ? `Commit staged changes, then publish ${state.branchLabel}.`
      : `Commit staged changes, then push to ${remote.target?.ref ?? remote.upstream ?? state.upstreamLabel}.`,
    disabled: false,
    kind: "commit-push",
    loadingKey: "commit-push",
    loadingLabel: publish ? "Publishing..." : "Pushing...",
    icon: "upload",
  };
}
