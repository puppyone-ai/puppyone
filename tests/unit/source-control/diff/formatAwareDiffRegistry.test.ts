import { describe, expect, it } from "vitest";
import { DIFF_VIEWERS, resolveDiffViewer } from "../../../../src/features/source-control/diff/core/registry";
import type { GitFileDiff, GitRevisionPair } from "../../../../src/types/electron";

describe("format-aware diff registry", () => {
  it("has deterministic specialized, text, and total fallback ordering", () => {
    expect(DIFF_VIEWERS.map((viewer) => [viewer.id, viewer.kind, viewer.source])).toEqual([
      ["docx-redline", "async", "resource-pair"],
      ["text-unified", "sync", "git-patch"],
      ["binary-summary", "sync", "metadata"],
    ]);
    expect(DIFF_VIEWERS.at(-1)?.match({
      file: fileDiff("unknown.bin", true),
      format: resolveDiffViewer(fileDiff("unknown.bin", true)).format,
    })).toBe(true);
  });

  it("routes DOCX by the canonical format registry when a revision pair exists", () => {
    const file = fileDiff("report.docx", true, revisionPair());
    const result = resolveDiffViewer(file);
    expect(result).toMatchObject({
      id: "docx-redline",
      source: "resource-pair",
      format: { id: "docx" },
    });
  });

  it("preserves unified text for known and Git-confirmed text files", () => {
    expect(resolveDiffViewer(fileDiff("main.ts", false)).id).toBe("text-unified");
    expect(resolveDiffViewer({
      ...fileDiff("README.unknown-extension", false),
      lines: [{ kind: "add", text: "hello", newLine: 1 }],
    }).id).toBe("text-unified");
  });

  it("falls back honestly for unknown binary and DOCX without a revision pair", () => {
    expect(resolveDiffViewer(fileDiff("archive.custom", true)).id).toBe("binary-summary");
    expect(resolveDiffViewer(fileDiff("report.docx", true)).id).toBe("binary-summary");
  });

  it("does not send legacy binary .doc files to the OOXML DOCX parser", () => {
    const pair = revisionPair();
    pair.path = "legacy.doc";
    pair.before.mimeType = "application/msword";
    pair.after.mimeType = "application/msword";
    expect(resolveDiffViewer({
      ...fileDiff("legacy.doc", true, pair),
      mimeType: "application/msword",
    }).id).toBe("binary-summary");
  });
});

function fileDiff(path: string, binary: boolean, pair?: GitRevisionPair): GitFileDiff {
  return {
    path,
    oldPath: null,
    status: "modified",
    additions: binary ? null : 1,
    deletions: binary ? null : 0,
    binary,
    lines: binary ? [] : [{ kind: "add", text: "next", newLine: 1 }],
    ...(pair ? { revisionPair: pair } : {}),
  };
}

function revisionPair(): GitRevisionPair {
  return {
    repositoryIdentity: "repo:1",
    selectionIdentity: "selection:1",
    sessionId: "git-diff-session:test",
    scope: "unstaged",
    path: "report.docx",
    oldPath: null,
    status: "modified",
    before: {
      kind: "resource",
      identity: "git:before",
      size: 10,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      handle: "before-handle",
    },
    after: {
      kind: "resource",
      identity: "worktree:after",
      size: 12,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      handle: "after-handle",
    },
  };
}
