// @vitest-environment node
import { describe, expect, it } from "vitest";
import { getIncomingChangeReceipt } from "../../../../src/features/changes/incomingChangeReceipt";
import {
  INCOMING_REVIEW_STORAGE_KEY,
  isSetAside,
  readSetAsideReceipts,
  restoreReceipt,
  setAsideReceipt,
  type IncomingReviewStorage,
} from "../../../../src/features/changes/incomingReviewLedger";
import type { GitBranchSummary, GitStatusSnapshot } from "../../../../src/types/electron";
import { gitResource, gitStatus } from "../../../support/source-control/gitFixtures";

function remoteTip(overrides: Partial<GitBranchSummary> = {}): GitBranchSummary {
  return {
    name: "origin/main",
    current: false,
    remote: true,
    upstream: null,
    ahead: 0,
    behind: 0,
    lastCommitId: "9f1c2ab",
    lastCommitMessage: "Rewrite the onboarding copy",
    lastCommitDate: "2026-10-12T09:30:00.000Z",
    lastCommitAuthorName: "Dana Rivera",
    ...overrides,
  };
}

function incomingStatus(overrides: Partial<GitStatusSnapshot> = {}): GitStatusSnapshot {
  const base = gitStatus({
    branches: [remoteTip()],
    effectiveHosting: {
      kind: "generic-git", remoteName: "origin", branchName: "main",
      ref: "origin/main", ready: true, reason: "remote-detected", identity: null,
    },
    ...overrides,
  });
  return {
    ...base,
    sourceControl: {
      ...base.sourceControl,
      ...overrides.sourceControl,
      remote: {
        ...base.sourceControl.remote,
        target: {
          remote: "origin", branch: "main", ref: "origin/main", exists: true,
          ahead: 0, behind: 3, incomingPreview: [], outgoingPreview: [],
        },
        upstream: "origin/main",
        behind: 3,
        canPull: true,
        state: "incoming",
        incomingPreview: [gitResource("docs/intro.md"), gitResource("src/app.ts", "added")],
        incomingFileSummary: { total: 4, added: 1, modified: 3, deleted: 0, renamed: 0, copied: 0, changed: 0 },
        ...overrides.sourceControl?.remote,
      },
    },
  };
}

function memoryStorage(initial: string | null = null): IncomingReviewStorage & { value: string | null } {
  return {
    value: initial,
    getItem(key: string) {
      return key === INCOMING_REVIEW_STORAGE_KEY ? this.value : null;
    },
    setItem(key: string, value: string) {
      if (key === INCOMING_REVIEW_STORAGE_KEY) this.value = value;
    },
  };
}

describe("a receipt projects the local Git facts about changes made elsewhere", () => {
  it("names who made how many changes, when, and which files", () => {
    const receipt = getIncomingChangeReceipt(incomingStatus());

    expect(receipt).toMatchObject({
      id: "origin/main@9f1c2ab",
      source: "Dana Rivera",
      changedAt: "2026-10-12T09:30:00.000Z",
      changeCount: 4,
      additionalFiles: 2,
      localWorkWaiting: false,
      blocked: false,
      canApply: true,
    });
    expect(receipt?.files).toEqual([
      { path: "docs/intro.md", status: "modified", letter: "M", staged: false, origin: "remote" },
      { path: "src/app.ts", status: "added", letter: "A", staged: false, origin: "remote" },
    ]);
  });

  it("identifies the receipt by the commit the decision was about", () => {
    const moved = incomingStatus({ branches: [remoteTip({ lastCommitId: "ab77e01" })] });
    expect(getIncomingChangeReceipt(moved)?.id).toBe("origin/main@ab77e01");
  });

  it("still produces a receipt when the tracking tip is not in the snapshot", () => {
    const receipt = getIncomingChangeReceipt(incomingStatus({ branches: [] }));

    expect(receipt).toMatchObject({ id: "origin/main@behind-3", source: null, changedAt: null });
    expect(receipt?.changeCount).toBe(4);
  });

  it("stays silent when nothing was made elsewhere", () => {
    expect(getIncomingChangeReceipt(null)).toBeNull();
    expect(getIncomingChangeReceipt(gitStatus({ isRepo: false }))).toBeNull();
    expect(getIncomingChangeReceipt(gitStatus())).toBeNull();
    const settled = incomingStatus();
    settled.sourceControl.remote = { ...settled.sourceControl.remote, behind: 0, state: "synced" };
    expect(getIncomingChangeReceipt(settled)).toBeNull();
  });

  it("reports the user's own saved work without mixing it into the count", () => {
    const diverged = incomingStatus();
    diverged.sourceControl.remote = { ...diverged.sourceControl.remote, ahead: 2, state: "diverged" };
    const receipt = getIncomingChangeReceipt(diverged);

    expect(receipt?.localWorkWaiting).toBe(true);
    expect(receipt?.changeCount).toBe(4);
  });

  it("refuses to offer applying while files need a decision", () => {
    const conflicted = incomingStatus();
    conflicted.sourceControl.groups = [{
      id: "merge",
      label: "Merge Changes",
      resources: [{ ...gitResource("docs/intro.md"), group: "merge", conflict: true }],
    }];
    const operating = incomingStatus();
    operating.sourceControl.operation = { kind: "merge", canContinue: true, canAbort: true };

    expect(getIncomingChangeReceipt(conflicted)).toMatchObject({ blocked: true, canApply: false });
    expect(getIncomingChangeReceipt(operating)).toMatchObject({ blocked: true, canApply: false });
  });

  it("cannot offer applying when the repository itself cannot take the changes", () => {
    const unavailable = incomingStatus();
    unavailable.sourceControl.remote = { ...unavailable.sourceControl.remote, canPull: false };
    expect(getIncomingChangeReceipt(unavailable)).toMatchObject({ blocked: false, canApply: false });
  });
});

describe("the ledger records the decision, never the changes", () => {
  it("keeps a set-aside receipt across reads", () => {
    const storage = memoryStorage();
    const records = setAsideReceipt(storage, [], "origin/main@9f1c2ab", "2026-10-12T10:00:00.000Z");

    expect(records).toEqual([{ id: "origin/main@9f1c2ab", at: "2026-10-12T10:00:00.000Z" }]);
    expect(readSetAsideReceipts(storage)).toEqual(records);
    expect(isSetAside(readSetAsideReceipts(storage), "origin/main@9f1c2ab")).toBe(true);
    expect(isSetAside(readSetAsideReceipts(storage), "origin/main@ab77e01")).toBe(false);
  });

  it("restores a receipt by forgetting the decision only", () => {
    const storage = memoryStorage();
    const records = setAsideReceipt(storage, [], "origin/main@9f1c2ab", "2026-10-12T10:00:00.000Z");

    expect(restoreReceipt(storage, records, "origin/main@9f1c2ab")).toEqual([]);
    expect(readSetAsideReceipts(storage)).toEqual([]);
  });

  it("records one decision per receipt and keeps the newest first", () => {
    const storage = memoryStorage();
    const first = setAsideReceipt(storage, [], "a", "2026-10-12T10:00:00.000Z");
    const second = setAsideReceipt(storage, first, "b", "2026-10-12T11:00:00.000Z");
    const repeated = setAsideReceipt(storage, second, "a", "2026-10-12T12:00:00.000Z");

    expect(repeated.map((record) => record.id)).toEqual(["a", "b"]);
    expect(repeated[0].at).toBe("2026-10-12T12:00:00.000Z");
  });

  it("stays bounded so a long-lived workspace cannot grow it forever", () => {
    const storage = memoryStorage();
    let records = readSetAsideReceipts(storage);
    for (let index = 0; index < 60; index += 1) {
      records = setAsideReceipt(storage, records, `receipt-${index}`, "2026-10-12T10:00:00.000Z");
    }

    expect(records).toHaveLength(50);
    expect(records[0].id).toBe("receipt-59");
  });

  it("shows the pending review again rather than trusting a damaged ledger", () => {
    expect(readSetAsideReceipts(memoryStorage("not json"))).toEqual([]);
    expect(readSetAsideReceipts(memoryStorage('{"id":"a"}'))).toEqual([]);
    expect(readSetAsideReceipts(memoryStorage('[{"id":""},{"at":"x"},{"id":"a","at":"x"}]')))
      .toEqual([{ id: "a", at: "x" }]);
  });

  it("keeps the decision for the session when storage refuses to write", () => {
    const readOnly: IncomingReviewStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
    };

    expect(setAsideReceipt(readOnly, [], "a", "2026-10-12T10:00:00.000Z"))
      .toEqual([{ id: "a", at: "2026-10-12T10:00:00.000Z" }]);
  });
});
