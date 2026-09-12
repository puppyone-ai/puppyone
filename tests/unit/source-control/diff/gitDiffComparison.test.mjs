import { describe, expect, it } from "vitest";
import {
  parseGitComparisonFileSummary,
  parseGitNameStatusPreview,
} from "../../../../local-api/git/diff-comparison.mjs";

describe("Git comparison preview parser", () => {
  it("maps aggregate diff records, including rename tuples, into sidebar resources", () => {
    expect(parseGitNameStatusPreview(
      "A\0new.md\0M\0existing.ts\0R100\0old.txt\0renamed.txt\0",
      "committed",
      12,
    )).toEqual([
      expect.objectContaining({ path: "new.md", oldPath: null, status: "added", letter: "A" }),
      expect.objectContaining({ path: "existing.ts", oldPath: null, status: "modified", letter: "M" }),
      expect.objectContaining({ path: "renamed.txt", oldPath: "old.txt", status: "renamed", letter: "R" }),
    ]);
  });

  it("bounds resources and rejects an unknown presentation group", () => {
    expect(parseGitNameStatusPreview("A\0one\0A\0two\0", "remote", 1)).toHaveLength(1);
    expect(parseGitNameStatusPreview("R100\0old-only.txt\0", "remote", 12)).toEqual([]);
    expect(() => parseGitNameStatusPreview("", "history", 12)).toThrow(/unsupported/i);
  });

  it("summarizes aggregate file statuses without exposing file names", () => {
    expect(parseGitComparisonFileSummary(
      "A\0new.md\0M\0existing.ts\0D\0removed.txt\0R100\0old.txt\0renamed.txt\0C100\0source.txt\0copy.txt\0T\0type-changed\0",
    )).toEqual({
      total: 6,
      added: 1,
      modified: 1,
      deleted: 1,
      renamed: 1,
      copied: 1,
      changed: 1,
    });
    expect(parseGitComparisonFileSummary("")).toEqual({
      total: 0,
      added: 0,
      modified: 0,
      deleted: 0,
      renamed: 0,
      copied: 0,
      changed: 0,
    });
  });
});
