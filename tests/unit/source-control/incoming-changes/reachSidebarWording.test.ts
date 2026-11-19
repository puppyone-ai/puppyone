// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  getReachSidebarModelWording,
  getReachSyncWording,
} from "../../../../src/features/source-control/reach/reachSidebarWording";
import {
  buildSourceControlSidebarModel,
  getGitSyncState,
} from "../../../../src/features/source-control/viewModel";
import type { GitStatusSnapshot } from "../../../../src/types/electron";
import { testT } from "../../../support/react/localization";
import { gitResource, gitStatus } from "../../../support/source-control/gitFixtures";

/** A tracked branch that is both behind and ahead: the noisiest wording case. */
function divergedStatus(): GitStatusSnapshot {
  const target = {
    remote: "origin", branch: "main", ref: "origin/main", exists: true,
    ahead: 1, behind: 3, incomingPreview: [gitResource("docs/intro.md")],
    outgoingPreview: [gitResource("src/app.ts")],
  } satisfies NonNullable<GitStatusSnapshot["syncTarget"]>;
  const base = gitStatus({
    branch: "main",
    headCommitId: "local01",
    branches: [{
      name: "main", current: true, remote: false, upstream: "origin/main",
      ahead: 1, behind: 3, lastCommitId: "local01", lastCommitMessage: "Local commit",
      lastCommitDate: "2026-10-12T08:00:00.000Z", lastCommitAuthorName: "You",
    }],
    remotes: [{
      name: "origin", fetchUrl: "https://example.test/repo.git",
      pushUrl: "https://example.test/repo.git", branches: ["main"],
    }],
    syncTarget: target,
    effectiveHosting: {
      kind: "generic-git", remoteName: "origin", branchName: "main",
      ref: "origin/main", ready: true, reason: "remote-detected", identity: null,
    },
  });
  return {
    ...base,
    sourceControl: {
      ...base.sourceControl,
      remote: {
        ...base.sourceControl.remote,
        target, upstream: "origin/main", ahead: 1, behind: 3,
        canPull: true, canPush: true, state: "diverged",
        incomingPreview: target.incomingPreview, outgoingPreview: target.outgoingPreview,
      },
    },
  };
}

function establishedState(status = divergedStatus()) {
  const current = status.branches.find((branch) => branch.current) ?? null;
  return getGitSyncState(status, current, null, testT);
}

function model(status: GitStatusSnapshot, syncState = establishedState(status)) {
  return buildSourceControlSidebarModel({
    status, syncState, displayMode: "professional", canCommit: false, t: testT,
  });
}

const systemWording = /\bPull\b|\bPush\b|\bPublish\b|\bDiverged\b|commit waiting|commits waiting/;

describe("the established Source Control wording", () => {
  it("still describes the repository, so the wording gate has a baseline to compare against", () => {
    const state = establishedState();

    expect(state.pullLabel).toBe("Pull 3 commits");
    expect(state.pushLabel).toBe("Push");
    expect(state.pushDetail).toBe("1 committed change waiting.");
    expect(Object.values(state).join(" ")).toMatch(systemWording);
  });
});

describe("the Project Reach wording states the consequence", () => {
  it("removes every system-view string from the sidebar state", () => {
    const state = getReachSyncWording(establishedState(), testT);

    expect(state.pullLabel).toBe("Review and apply");
    expect(state.pullDetail).toBe("Changes made elsewhere are waiting for your review.");
    expect(state.pushLabel).toBe("Let others see it");
    expect(state.pushTitle).toBe("Review the changes made elsewhere first.");
    expect(state.pushDetail).toBe("1 saved change others cannot see yet.");
    expect(Object.values(state).join(" ")).not.toMatch(systemWording);
  });

  it("keeps the facts it was given and only replaces the words", () => {
    const established = establishedState();
    const reach = getReachSyncWording(established, testT);

    expect(reach.behind).toBe(established.behind);
    expect(reach.ahead).toBe(established.ahead);
    expect(reach.pullDisabled).toBe(established.pullDisabled);
    expect(reach.pushDisabled).toBe(established.pushDisabled);
    expect(reach.remoteExists).toBe(established.remoteExists);
    expect(reach.setupRequired).toBe(established.setupRequired);
  });

  it("says nothing is waiting once the review is done", () => {
    const settled = divergedStatus();
    settled.sourceControl.remote = { ...settled.sourceControl.remote, behind: 0, state: "outgoing" };
    settled.branches = settled.branches.map((branch) => ({ ...branch, behind: 0 }));
    const state = getReachSyncWording(establishedState(settled), testT);

    expect(state.pullDetail).toBe("Nothing is waiting for your review.");
    expect(state.pushTitle).toBe("Others see the version you saved here. Nothing on this Mac changes.");
  });

  it("renames the send primitive without removing or unblocking it", () => {
    const status = divergedStatus();
    const established = model(status);
    const reachState = getReachSyncWording(establishedState(status), testT);
    const reach = getReachSidebarModelWording(model(status, reachState), testT);

    expect(established.committedPrimaryAction?.label).toBe("Push");
    expect(reach.committedPrimaryAction).toMatchObject({
      kind: "push",
      label: "Let others see it",
      title: "Review the changes made elsewhere first.",
      loadingLabel: "Sending…",
      disabled: true,
    });
    expect(reach.committedCount).toBe(established.committedCount);
    expect(reach.committedResources).toEqual(established.committedResources);
  });

  it("renames the publish variant and drops its waiting counter", () => {
    const status = divergedStatus();
    status.sourceControl.remote = {
      ...status.sourceControl.remote, behind: 0, state: "publish", canPublish: true,
    };
    status.branches = status.branches.map((branch) => ({ ...branch, behind: 0, upstream: null }));
    const established = establishedState(status);
    const reachState = getReachSyncWording(established, testT);
    const reach = getReachSidebarModelWording(model(status, reachState), testT);

    expect(established.pushDetail).toBe("1 local commit waiting.");
    expect(reachState.pushDetail).toBe("1 saved change others cannot see yet.");
    expect(reach.committedPrimaryAction).toMatchObject({
      kind: "publish",
      label: "Let others see it",
      loadingLabel: "Sending…",
    });
  });

  it("leaves actions it does not own untouched", () => {
    const status = divergedStatus();
    status.sourceControl.operation = { kind: "merge", canContinue: true, canAbort: true };
    const established = model(status);
    const reach = getReachSidebarModelWording(established, testT);

    expect(reach.operationPrimaryAction).toEqual(established.operationPrimaryAction);
    expect(reach.stagedPrimaryAction).toEqual(established.stagedPrimaryAction);
  });
});
