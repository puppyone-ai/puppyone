import type { GitStatusSnapshot, PuppyoneWorkspaceConfig } from "../../types/electron";
import { getPuppyoneRemote, parsePuppyoneRemote } from "./remotes";
import { bidiIsolate, type MessageFormatter } from "@puppyone/localization";
import type {
  GitHostingMode,
  GitSidebarPrimaryAction,
  GitSyncState,
  SourceControlDisplayMode,
  SourceControlSidebarModel,
} from "./types";

export function getGitSyncState(
  status: GitStatusSnapshot | null,
  currentBranch: GitStatusSnapshot["branches"][number] | null,
  puppyoneConfig: PuppyoneWorkspaceConfig | null,
  t: MessageFormatter,
): GitSyncState {
  if (!status?.isRepo) {
    return {
      branchLabel: t("source-control.sync.noBranch"),
      upstreamLabel: t("source-control.history.inactive"),
      remoteExists: false,
      setupRequired: true,
      setupTitle: t("source-control.sync.chooseTarget"),
      setupDetail: t("source-control.sync.initializeThenCloud"),
      behind: 0,
      ahead: 0,
      pullDetail: t("source-control.sync.noLocalRepository"),
      pullDisabled: true,
      pushDisabled: true,
      pullLabel: t("source-control.sync.pullRemote"),
      pullTitle: t("source-control.sync.initializeBeforePull"),
      pushTitle: t("source-control.sync.initializeBeforePush"),
      pushLabel: t("source-control.sync.push"),
      pushDetail: t("source-control.sync.noLocalRepository"),
    };
  }

  if (status.effectiveHosting.kind === "puppyone-cloud") {
    const branchLabel = displayGitBranch(status, t("source-control.branch.initial"));
    const target = status.syncTarget;
    const targetLabel = target?.ref ?? "Puppyone Cloud";
    const targetExists = target?.exists === true;
    const targetAhead = target?.ahead ?? 0;
    const targetBehind = target?.behind ?? 0;
    return {
      branchLabel,
      upstreamLabel: targetLabel,
      remoteExists: targetExists,
      setupRequired: !target?.remote,
      setupTitle: "Puppyone Cloud",
      setupDetail: target?.remote
        ? t("source-control.sync.syncingWith", { target: bidiIsolate(targetLabel) })
        : t("source-control.sync.configureCloudRemote"),
      behind: targetBehind,
      ahead: targetAhead,
      pullDetail: targetExists
        ? t("source-control.sync.cloudCommitsOn", { count: targetBehind, target: bidiIsolate(targetLabel) })
        : t("source-control.sync.noCloudBranch", { target: bidiIsolate(targetLabel) }),
      pullDisabled: !targetExists || targetBehind === 0,
      pushDisabled: targetExists
        ? targetAhead === 0 || targetBehind > 0
        : !status.headCommitId,
      pullLabel: targetBehind > 0
        ? t("source-control.sync.downloadCount", { count: targetBehind })
        : t("source-control.action.download"),
      pullTitle: targetExists
        ? targetBehind === 0
          ? t("source-control.cloud.upToDate")
          : t("source-control.sync.downloadFrom", { count: targetBehind, target: bidiIsolate(targetLabel) })
        : t("source-control.sync.cloudBranchMissing"),
      pushTitle: targetBehind > 0
        ? t("source-control.sync.downloadBeforeUpload")
        : targetAhead === 0
          ? t("source-control.sync.noCommittedToUpload")
          : t("source-control.sync.uploadTo", { count: targetAhead, target: bidiIsolate(targetLabel) }),
      pushLabel: t("source-control.sync.upload"),
      pushDetail: targetAhead > 0
        ? t("source-control.sync.committedWaiting", { count: targetAhead })
        : t("source-control.sync.noCommittedWaiting"),
    };
  }

  if (!currentBranch?.upstream) {
    const branchLabel = displayGitBranch(status, t("source-control.branch.initial"));
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
      const publishLabel = t(isPuppyonePublishRemote ? "source-control.sync.publish" : "source-control.sync.push");
      const publishTargetLabel = syncTarget?.ref ?? `${publishRemote.name}/${backupBranch}`;
      const targetExists = syncTarget?.exists === true;
      const targetAhead = targetExists ? syncTarget.ahead : 0;
      const targetBehind = targetExists ? syncTarget.behind : 0;
      return {
        branchLabel,
        upstreamLabel: publishTargetLabel,
        remoteExists: targetExists,
        setupRequired: false,
        setupTitle: t("source-control.sync.target"),
        setupDetail: t("source-control.sync.primaryRemote", { remote: bidiIsolate(publishRemote.name) }),
        behind: targetBehind,
        ahead: targetAhead,
        pullDetail: targetExists
          ? t("source-control.sync.remoteCommitsOn", { count: targetBehind, target: bidiIsolate(publishTargetLabel) })
          : t("source-control.sync.noRemoteBranch", { target: bidiIsolate(publishTargetLabel) }),
        pullDisabled: !targetExists || targetBehind === 0,
        pushDisabled: targetExists
          ? targetAhead === 0 || targetBehind > 0
          : !status.headCommitId,
        pullLabel: t("source-control.sync.pullRemote"),
        pullTitle: targetExists
          ? targetBehind === 0
            ? t("source-control.sync.upToDate")
            : t("source-control.sync.pullFrom", { count: targetBehind, target: bidiIsolate(publishTargetLabel) })
          : t("source-control.sync.remoteBranchMissing"),
        pushTitle: status.headCommitId
          ? targetExists && targetBehind > 0
            ? t("source-control.sync.sendDiverged", { action: publishLabel, count: targetAhead, target: bidiIsolate(publishTargetLabel) })
            : t("source-control.sync.sendBranch", { action: publishLabel, branch: bidiIsolate(branchLabel), target: bidiIsolate(publishTargetLabel) })
          : t(isPuppyonePublishRemote ? "source-control.sync.commitBeforePublish" : "source-control.sync.commitBeforePush"),
        pushLabel: publishLabel,
        pushDetail: targetExists
          ? targetAhead > 0
            ? t("source-control.sync.localWaiting", { count: targetAhead })
            : t("source-control.sync.noLocalWaiting", { target: bidiIsolate(publishTargetLabel) })
          : t("source-control.sync.createRemote", { action: publishLabel, branch: bidiIsolate(branchLabel), target: bidiIsolate(publishTargetLabel) }),
      };
    }

    if (configuredCloudBackup) {
      return {
        branchLabel,
        upstreamLabel: "Puppyone Cloud",
        remoteExists: false,
        setupRequired: false,
        setupTitle: t("source-control.sync.target"),
        setupDetail: t("source-control.sync.cloudBackupEnabled"),
        behind: 0,
        ahead: 0,
        pullDetail: t("source-control.sync.configureBeforePull"),
        pullDisabled: true,
        pushDisabled: true,
        pullLabel: t("source-control.sync.pullRemote"),
        pullTitle: t("source-control.sync.configureBeforePull"),
        pushTitle: t("source-control.sync.configureBeforePush"),
        pushLabel: t("source-control.sync.publish"),
        pushDetail: t("source-control.sync.noConfiguredRemote"),
      };
    }

    return {
      branchLabel,
      upstreamLabel: t("source-control.sync.localOnly"),
      remoteExists: false,
      setupRequired: true,
      setupTitle: t("source-control.sync.chooseTarget"),
      setupDetail: t("source-control.sync.backupLocalBranch", { branch: bidiIsolate(branchLabel) }),
      behind: 0,
      ahead: 0,
      pullDetail: t("source-control.sync.noTrackingBranch"),
      pullDisabled: true,
      pushDisabled: true,
      pullLabel: t("source-control.sync.pullRemote"),
      pullTitle: t("source-control.sync.chooseBeforePull"),
      pushTitle: t("source-control.sync.chooseBeforePush"),
      pushLabel: t("source-control.sync.push"),
      pushDetail: t("source-control.sync.chooseFirst"),
    };
  }

  const upstreamRemoteName = getUpstreamRemoteName(currentBranch.upstream);
  const upstreamRemote = status.remotes.find((remote) => remote.name === upstreamRemoteName) ?? null;
  const isPuppyoneRemote = Boolean(parsePuppyoneRemote(upstreamRemote?.pushUrl ?? upstreamRemote?.fetchUrl ?? null));
  const ahead = currentBranch.ahead || 0;
  const behind = currentBranch.behind || 0;
  const pushLabel = t(isPuppyoneRemote ? "source-control.sync.publish" : "source-control.sync.push");
  const branchLabel = displayGitBranch(status, t("source-control.branch.initial"));
  const pullDetail = behind > 0 && ahead > 0
    ? t("source-control.sync.pullBeforeSend", { count: behind, action: pushLabel })
    : t("source-control.sync.commitsOn", { count: behind, target: bidiIsolate(currentBranch.upstream) });

  return {
    branchLabel,
    upstreamLabel: currentBranch.upstream,
    remoteExists: true,
    setupRequired: false,
    setupTitle: t("source-control.sync.target"),
    setupDetail: t("source-control.sync.tracking", { target: bidiIsolate(currentBranch.upstream) }),
    behind,
    ahead,
    pullDetail,
    pullDisabled: behind === 0,
    pushDisabled: ahead === 0 || behind > 0,
    pullLabel: behind > 0 ? t("source-control.sync.pullCount", { count: behind }) : t("source-control.sync.pullRemote"),
    pullTitle: behind === 0
      ? t("source-control.sync.upToDate")
      : t("source-control.sync.pullFrom", { count: behind, target: bidiIsolate(currentBranch.upstream) }),
    pushTitle: ahead === 0
      ? t("source-control.sync.noLocalToPush")
      : behind > 0
        ? t("source-control.sync.sendDiverged", { action: pushLabel, count: ahead, target: bidiIsolate(currentBranch.upstream) })
        : t("source-control.sync.sendTo", { action: pushLabel, count: ahead, target: bidiIsolate(currentBranch.upstream) }),
    pushLabel,
    pushDetail: ahead > 0
      ? t("source-control.sync.committedWaiting", { count: ahead })
      : t("source-control.sync.noCommittedWaiting"),
  };
}

export function buildSourceControlSidebarModel({
  status,
  syncState,
  displayMode,
  canCommit,
  t,
}: {
  status: GitStatusSnapshot | null;
  syncState: GitSyncState;
  displayMode: SourceControlDisplayMode;
  canCommit: boolean;
  t: MessageFormatter;
}): SourceControlSidebarModel {
  const sourceControl = status?.sourceControl ?? null;
  const groupById = new Map((sourceControl?.groups ?? []).map((group) => [group.id, group.resources]));
  const mergeResources = groupById.get("merge") ?? [];
  const repositoryOperation = sourceControl?.operation ?? null;
  const hasConflicts = mergeResources.length > 0;
  const syncBlocked = hasConflicts || Boolean(repositoryOperation);
  const stagedResources = groupById.get("index") ?? [];
  const workingResources = [
    ...(groupById.get("workingTree") ?? []),
    ...(groupById.get("untracked") ?? []),
  ];
  const professionalMode = displayMode === "professional";
  const committedCount = sourceControl?.remote.ahead ?? 0;
  const committedResources = sourceControl?.remote.outgoingPreview ?? [];
  const committedPrimaryAction = getCommittedPrimaryAction(status, syncState, syncBlocked, t);
  const stagedPrimaryAction = repositoryOperation ? null : getStagedPrimaryAction(
    stagedResources.length,
    canCommit,
    hasConflicts,
    t,
  );
  const operationPrimaryAction = repositoryOperation?.canContinue ? {
    label: t("source-control.sync.continue"),
    title: t("source-control.sync.continueTitle"),
    disabled: false,
    kind: "continue" as const,
    loadingKey: "continue",
    loadingLabel: t("source-control.sync.continuing"),
    icon: "check" as const,
  } : null;
  const localChangeResources = workingResources;
  const showCommittedSection = committedCount > 0 || Boolean(committedPrimaryAction);
  const showStagedSection = stagedResources.length > 0;
  const showUnstagedSection = localChangeResources.length > 0;

  return {
    professionalMode,
    repositoryOperation,
    hasConflicts,
    mergeResources,
    stagedResources,
    workingResources,
    localChangeResources,
    committedCount,
    committedResources,
    committedPrimaryAction,
    operationPrimaryAction,
    showCommittedSection,
    showStagedSection,
    showUnstagedSection,
    showCleanSection: status?.isRepo === true
      && !hasConflicts
      && !repositoryOperation
      && !showCommittedSection
      && !showStagedSection
      && !showUnstagedSection,
    stagedPrimaryAction,
    showStageAndCommitAction: localChangeResources.length > 0 && !hasConflicts && !repositoryOperation,
    sectionContext: {
      merge: hasConflicts
        ? t("source-control.commit.conflicts", { count: mergeResources.length })
        : t("source-control.sync.readyToContinue"),
      committed: t("source-control.commit.commits", { count: committedCount }),
      staged: t("source-control.commit.files", { count: stagedResources.length }),
      unstaged: t("source-control.commit.files", { count: localChangeResources.length }),
    },
  };
}

export function getCommittedSummary(count: number, actionLabel: string, t: MessageFormatter) {
  return t("source-control.committed.ready", { count, action: actionLabel });
}

export type SourceControlPrimaryActionSlot = "operation" | "staged" | "sync" | "committed" | "stage-and-commit" | null;

export function getSourceControlPrimaryActionSlot({
  hasConflicts,
  hasOperationAction,
  hasStagedAction,
  hasSyncAction,
  hasCommittedAction,
  hasStageAndCommitAction,
}: {
  hasConflicts: boolean;
  hasOperationAction: boolean;
  hasStagedAction: boolean;
  hasSyncAction: boolean;
  hasCommittedAction: boolean;
  hasStageAndCommitAction: boolean;
}): SourceControlPrimaryActionSlot {
  if (hasConflicts) return null;
  if (hasOperationAction) return "operation";
  if (hasSyncAction) return "sync";
  if (hasStagedAction) return "staged";
  if (hasCommittedAction) return "committed";
  if (hasStageAndCommitAction) return "stage-and-commit";
  return null;
}

export function displayGitBranch(status: GitStatusSnapshot, initialBranchLabel = "initial branch") {
  return status.branch && status.branch !== "detached" ? status.branch : initialBranchLabel;
}

export function getGitHostingMode(
  status: GitStatusSnapshot | null,
  puppyoneConfig: PuppyoneWorkspaceConfig | null = null,
): GitHostingMode {
  if (status?.effectiveHosting) {
    return status.effectiveHosting.kind === "github" || status.effectiveHosting.kind === "puppyone-cloud"
      ? status.effectiveHosting.kind
      : "generic-git";
  }

  const sourceService = puppyoneConfig?.sync?.sourceOfTruth?.service?.toLowerCase();
  if (sourceService === "github") return "github";
  if (sourceService === "puppyone" && hasConfiguredPuppyoneCloudIntent(puppyoneConfig)) return "puppyone-cloud";

  return "generic-git";
}

function hasConfiguredPuppyoneCloudIntent(config: PuppyoneWorkspaceConfig | null) {
  const configuredRemoteName = config?.sync?.sourceOfTruth?.remote
    ?? config?.git?.primaryRemote
    ?? config?.backup?.remote
    ?? null;
  return configuredRemoteName?.toLowerCase() === "puppyone";
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

export function getCommittedPrimaryAction(
  status: GitStatusSnapshot | null,
  state: GitSyncState,
  syncBlocked: boolean,
  t: MessageFormatter,
): GitSidebarPrimaryAction | null {
  const remote = status?.sourceControl.remote;
  if (!remote) return null;

  if (remote.canPublish) {
    return {
      label: t("source-control.sync.publish"),
      disabled: syncBlocked,
      title: syncBlocked ? t("source-control.sync.resolveBeforeSync") : state.pushTitle,
      kind: "publish",
      loadingKey: "publish",
      loadingLabel: t("source-control.sync.publishing"),
      icon: "upload",
    };
  }

  if (remote.state === "diverged") {
    return {
      label: state.pushLabel,
      title: state.pushTitle,
      disabled: true,
      kind: "push",
      loadingKey: "push",
      loadingLabel: t("source-control.sync.pushing"),
      icon: "upload",
    };
  }

  if (remote.canPush) {
    return {
      label: state.pushLabel,
      title: syncBlocked ? t("source-control.sync.resolveBeforeSync") : state.pushTitle,
      disabled: syncBlocked || state.pushDisabled,
      kind: "push",
      loadingKey: "push",
      loadingLabel: t("source-control.sync.pushing"),
      icon: "upload",
    };
  }

  return null;
}

export function getStagedPrimaryAction(
  stagedCount: number,
  canCommit: boolean,
  hasConflicts: boolean,
  t: MessageFormatter,
): GitSidebarPrimaryAction | null {
  const commitOnly: GitSidebarPrimaryAction = {
    label: t("source-control.sync.commit"),
    title: t("source-control.sync.commitStaged"),
    disabled: false,
    kind: "commit",
    loadingKey: "commit",
    loadingLabel: t("source-control.action.committing"),
    icon: "plus",
  };

  if (stagedCount === 0) {
    return null;
  }

  if (!canCommit) {
    return {
      label: t("source-control.sync.commit"),
      title: t(hasConflicts ? "source-control.sync.resolveBeforeSync" : "source-control.sync.stageBeforeCommit"),
      disabled: true,
      kind: "commit",
      loadingKey: "commit",
      loadingLabel: t("source-control.action.committing"),
      icon: "plus",
    };
  }

  return commitOnly;
}
