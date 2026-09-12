import { describe, expect, it } from "vitest";
import { parseGitPorcelainV2Status } from "../../../../local-api/git/porcelain-v2.mjs";

describe("Git porcelain v2 parser", () => {
  it("parses headers, ordinary changes, renames, and untracked files", () => {
    const hash = "0123456789012345678901234567890123456789";
    const output = [
      "# branch.oid abc123",
      "# branch.head main",
      `1 M. N... 100644 100644 100644 ${hash} ${hash} tracked.txt`,
      `2 R. N... 100644 100644 100644 ${hash} ${hash} R100 renamed.txt`,
      "old.txt",
      "? new file.txt",
      "",
    ].join("\0");

    const parsed = parseGitPorcelainV2Status(output);
    expect(parsed.headers).toMatchObject({
      "branch.oid": "abc123",
      "branch.head": "main",
    });
    expect(parsed.entries).toEqual([
      expect.objectContaining({ path: "tracked.txt", staged: "M", status: "modified" }),
      expect.objectContaining({ path: "renamed.txt", oldPath: "old.txt", staged: "R", status: "renamed" }),
      expect.objectContaining({ path: "new file.txt", status: "untracked" }),
    ]);
  });
});
