import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { execGit, execGitBuffer } from "../../../../local-api/git/runner.mjs";

describe("Git command runner", () => {
  it("writes supplied input to stdin and closes the stream", async () => {
    const input = "puppyone-credential-probe";
    const expected = crypto.createHash("sha1")
      .update(`blob ${Buffer.byteLength(input)}\0${input}`)
      .digest("hex");

    const result = await execGit(process.cwd(), ["hash-object", "--stdin"], {
      input,
      timeout: 1_000,
    });

    expect(result.stdout.trim()).toBe(expected);
  });

  it("preserves binary Buffer output for bounded Git reads", async () => {
    const result = await execGitBuffer(process.cwd(), ["rev-parse", "--verify", "HEAD"]);

    expect(Buffer.isBuffer(result.stdout)).toBe(true);
    expect(result.stdout.toString("utf8")).toMatch(/^[0-9a-f]{40}\n$/);
  });
});
