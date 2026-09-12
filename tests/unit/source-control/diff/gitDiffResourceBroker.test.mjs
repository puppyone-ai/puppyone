import { describe, expect, it } from "vitest";
import {
  createGitDiffResourceBroker,
  GitDiffResourceError,
} from "../../../../electron/main/git-diff-resource-broker.mjs";

describe("Git diff revision resource broker", () => {
  it("serves bounded chunks, validates audience and identity, and zeroes revoked bytes", () => {
    let sequence = 0;
    const sourceBytes = Buffer.from([1, 2, 3, 4]);
    const broker = createGitDiffResourceBroker({ createToken: () => `token-${++sequence}` });
    const detail = broker.issueDetail(resourceDetail({ beforeBytes: sourceBytes }), {
      ownerWebContentsId: 7,
      sessionId: "session:test-1",
    });
    const side = detail.files[0].revisionPair.before;

    expect(side).toMatchObject({ kind: "resource", size: 4 });
    expect(side).not.toHaveProperty("bytes");
    expect(broker.read({
      ...readRequest(side, 7, "session:test-1"),
      offset: 1,
      length: 2,
    })).toEqual(expect.objectContaining({
      bytes: Uint8Array.from([2, 3]),
      offset: 1,
      size: 4,
      done: false,
    }));
    expectBrokerCode(() => broker.read({
      ...readRequest(side, 8, "session:test-1"),
      offset: 0,
      length: 1,
    }), "audience-mismatch");
    expectBrokerCode(() => broker.read({
      ...readRequest(side, 7, "session:test-1"),
      revisionIdentity: "git:other",
      offset: 0,
      length: 1,
    }), "identity-mismatch");

    expect(broker.revokeSession("session:test-1", { ownerWebContentsId: 7 })).toBe(true);
    expect(sourceBytes).toEqual(Buffer.alloc(4));
    expectBrokerCode(() => broker.read({
      ...readRequest(side, 7, "session:test-1"),
      offset: 0,
      length: 1,
    }), "revoked");
  });

  it("enforces range, operation, byte, and per-resource budgets", () => {
    let sequence = 0;
    const broker = createGitDiffResourceBroker({
      limits: {
        maxResourceBytes: 4,
        maxReadChunkBytes: 2,
        maxReadOperationsPerHandle: 2,
        maxReadBytesPerHandle: 4,
      },
      createToken: () => `bounded-${++sequence}`,
    });
    const detail = broker.issueDetail(resourceDetail(), {
      ownerWebContentsId: 3,
      sessionId: "session:test-2",
    });
    const side = detail.files[0].revisionPair.before;
    const request = readRequest(side, 3, "session:test-2");

    expect(broker.read({ ...request, offset: 0, length: 2 }).done).toBe(false);
    expect(broker.read({ ...request, offset: 2, length: 2 }).done).toBe(true);
    expectBrokerCode(() => broker.read({ ...request, offset: 0, length: 1 }), "read-budget-exhausted");
    expectBrokerCode(() => broker.read({ ...request, offset: 0, length: 3 }), "invalid-range");

    const aborted = new AbortController();
    aborted.abort();
    expect(() => broker.read({ ...request, offset: 0, length: 1, signal: aborted.signal }))
      .toThrowError(expect.objectContaining({ name: "AbortError" }));

    expectBrokerCode(() => broker.issueDetail(resourceDetail({ beforeBytes: Buffer.alloc(5) }), {
      ownerWebContentsId: 3,
      sessionId: "session:test-3",
    }), "resource-too-large");
  });

  it("actively expires handles and releases their owned memory", () => {
    let now = 10;
    let scheduled = null;
    const sourceBytes = Buffer.from([1, 2, 3, 4]);
    const broker = createGitDiffResourceBroker({
      limits: { handleTtlMs: 5 },
      now: () => now,
      createToken: () => "expiry-token",
      schedule: (callback, delayMs) => {
        scheduled = { callback, delayMs, unref() {} };
        return scheduled;
      },
      cancelScheduled: (handle) => {
        if (scheduled === handle) scheduled = null;
      },
    });
    const detail = broker.issueDetail(resourceDetail({ beforeBytes: sourceBytes }), {
      ownerWebContentsId: 4,
      sessionId: "session:expiry",
    });
    const handle = detail.files[0].revisionPair.before.handle;
    expect(scheduled?.delayMs).toBe(5);

    now = 15;
    scheduled.callback();
    expect(broker.inspect(handle)).toBeNull();
    expect(sourceBytes).toEqual(Buffer.alloc(4));
  });

  it("enforces cumulative session, owner, session-count, and global quotas", () => {
    const twoResources = resourceDetail({ afterBytes: Buffer.from([5, 6, 7, 8]) });
    const sessionBroker = brokerWithSequence({ maxBytesPerSession: 6 });
    expectBrokerCode(() => sessionBroker.issueDetail(twoResources, {
      ownerWebContentsId: 1,
      sessionId: "session:quota-session",
    }), "session-byte-limit");

    const ownerBroker = brokerWithSequence({ maxBytesPerOwner: 6 });
    ownerBroker.issueDetail(resourceDetail(), { ownerWebContentsId: 1, sessionId: "session:owner-a" });
    expectBrokerCode(() => ownerBroker.issueDetail(resourceDetail(), {
      ownerWebContentsId: 1,
      sessionId: "session:owner-b",
    }), "owner-byte-limit");

    const sessionCountBroker = brokerWithSequence({ maxSessionsPerOwner: 1 });
    sessionCountBroker.issueDetail(resourceDetail(), { ownerWebContentsId: 1, sessionId: "session:count-a" });
    expectBrokerCode(() => sessionCountBroker.issueDetail(resourceDetail(), {
      ownerWebContentsId: 1,
      sessionId: "session:count-b",
    }), "too-many-sessions");

    const globalBroker = brokerWithSequence({ maxTotalBytes: 6 });
    globalBroker.issueDetail(resourceDetail(), { ownerWebContentsId: 1, sessionId: "session:global-a" });
    expectBrokerCode(() => globalBroker.issueDetail(resourceDetail(), {
      ownerWebContentsId: 2,
      sessionId: "session:global-b",
    }), "global-byte-limit");
  });
});

function brokerWithSequence(limits) {
  let sequence = 0;
  return createGitDiffResourceBroker({
    limits,
    createToken: () => `quota-${++sequence}`,
  });
}

function readRequest(side, ownerWebContentsId, sessionId) {
  return {
    handle: side.handle,
    ownerWebContentsId,
    sessionId,
    selectionIdentity: "selection:1",
    revisionIdentity: "git:before",
  };
}

function expectBrokerCode(operation, code) {
  let thrown = null;
  try {
    operation();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(GitDiffResourceError);
  expect(thrown).toMatchObject({ code });
}

function resourceDetail({
  beforeBytes = Buffer.from([1, 2, 3, 4]),
  afterBytes = null,
} = {}) {
  return {
    commit_id: "working-tree",
    files: [{
      path: "report.docx",
      oldPath: null,
      status: "modified",
      binary: true,
      additions: null,
      deletions: null,
      lines: [],
      revisionPair: {
        repositoryIdentity: "repo:1",
        selectionIdentity: "selection:1",
        scope: "unstaged",
        path: "report.docx",
        oldPath: null,
        status: "modified",
        before: {
          kind: "resource",
          identity: "git:before",
          size: beforeBytes.length,
          mimeType: "application/docx",
          bytes: beforeBytes,
        },
        after: afterBytes
          ? {
              kind: "resource",
              identity: "git:after",
              size: afterBytes.length,
              mimeType: "application/docx",
              bytes: afterBytes,
            }
          : {
              kind: "missing",
              identity: "missing:after",
              size: 0,
              mimeType: null,
              reason: "test",
            },
      },
    }],
  };
}
