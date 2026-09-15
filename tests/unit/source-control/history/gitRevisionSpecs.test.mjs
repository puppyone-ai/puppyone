import { describe, expect, it } from "vitest";
import { deriveGitRevisionSpecs } from "../../../../local-api/git/revision-specs.mjs";

const mime = (name) => name.endsWith(".docx") ? "application/docx" : "text/plain";

describe("Git revision pair scope matrix", () => {
  it.each([
    {
      name: "unstaged modification",
      input: { scope: "unstaged", file: file("modified") },
      expected: { before: { kind: "index", path: "next.txt" }, after: { kind: "worktree", path: "next.txt" } },
    },
    {
      name: "staged addition",
      input: { scope: "staged", file: file("added") },
      expected: { before: { kind: "missing" }, after: { kind: "index", path: "next.txt" } },
    },
    {
      name: "staged deletion",
      input: { scope: "staged", file: file("deleted") },
      expected: { before: { kind: "tree", ref: "HEAD" }, after: { kind: "missing" } },
    },
    {
      name: "untracked file",
      input: { scope: "untracked", file: file("untracked") },
      expected: { before: { kind: "missing" }, after: { kind: "worktree" } },
    },
    {
      name: "remote rename",
      input: {
        scope: "remote",
        file: file("renamed", "old.docx", "next.docx", true),
        comparison: { beforeRef: "base", afterRef: "remote" },
      },
      expected: {
        before: { kind: "tree", ref: "base", path: "old.docx" },
        after: { kind: "tree", ref: "remote", path: "next.docx" },
      },
    },
    {
      name: "remote addition",
      input: {
        scope: "remote",
        file: file("added"),
        comparison: { beforeRef: "base", afterRef: "remote" },
      },
      expected: {
        before: { kind: "missing" },
        after: { kind: "tree", ref: "remote", path: "next.txt" },
      },
    },
    {
      name: "committed deletion",
      input: {
        scope: "committed",
        file: file("deleted"),
        comparison: { beforeRef: "base", afterRef: "HEAD" },
      },
      expected: {
        before: { kind: "tree", ref: "base", path: "next.txt" },
        after: { kind: "missing" },
      },
    },
    {
      name: "committed modification",
      input: {
        scope: "committed",
        file: file("modified"),
        comparison: { beforeRef: "merge-base", afterRef: "HEAD" },
      },
      expected: {
        before: { kind: "tree", ref: "merge-base" },
        after: { kind: "tree", ref: "HEAD" },
      },
    },
  ])("derives $name without renderer refs", ({ input, expected }) => {
    expect(deriveGitRevisionSpecs({ ...input, getMimeType: mime })).toMatchObject(expected);
  });

  it("models a repository without HEAD as a missing staged before side", () => {
    expect(deriveGitRevisionSpecs({
      scope: "staged",
      file: file("modified"),
      hasHead: false,
      getMimeType: mime,
    })).toMatchObject({
      before: { kind: "missing", reason: "head-missing" },
      after: { kind: "index" },
    });
  });
});

function file(status, oldPath = null, path = "next.txt", binary = false) {
  return { status, oldPath, path, binary };
}
