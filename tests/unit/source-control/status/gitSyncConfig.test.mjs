import { describe, expect, it, vi } from "vitest";
import { readGitBranchBinding, readGitPullPolicyArgs, readOptionalGitConfig } from "../../../../local-api/git/sync-config.mjs";

function gitConfig(values) {
  return vi.fn(async (_root, args) => {
    if (args[0] === "branch") return { stdout: "feature/work\n" };
    if (Object.hasOwn(values, args[2])) return { stdout: values[args[2]] };
    throw Object.assign(new Error("unset"), { code: 1 });
  });
}

describe("Git synchronization configuration", () => {
  it("keeps the old rebase/autostash default only without explicit policy", async () => {
    expect(await readGitPullPolicyArgs(gitConfig({}), "/fixture", "feature/work"))
      .toEqual(["--rebase", "--autostash"]);
  });
  it.each(["branch.feature/work.rebase", "pull.rebase", "pull.ff"])("does not override %s", async (key) => {
    expect(await readGitPullPolicyArgs(gitConfig({ [key]: key === "pull.ff" ? "only" : "false" }), "/fixture", "feature/work"))
      .toEqual(["--autostash"]);
  });
  it.each(["rebase.autoStash", "merge.autoStash", "pull.autoStash"])("does not override %s=false", async (key) => {
    expect(await readGitPullPolicyArgs(gitConfig({ [key]: "false" }), "/fixture", "feature/work"))
      .toEqual(["--rebase"]);
  });
  it("does not treat configuration I/O failure as absence", async () => {
    const failure = Object.assign(new Error("config unavailable"), { code: 128 });
    const run = vi.fn().mockRejectedValue(failure);
    await expect(readOptionalGitConfig(run, "/fixture", "pull.rebase")).rejects.toBe(failure);
    expect(run).toHaveBeenCalledTimes(1);
  });
  it("does not treat an explicitly empty push remote as absence", async () => {
    await expect(readGitBranchBinding(gitConfig({ "remote.pushDefault": "" }), "/fixture"))
      .rejects.toThrow(/push remote is empty/);
  });
  it.each([
    { "branch.feature/work.remote": "removed" },
    { "branch.feature/work.remote": "" },
    { "branch.feature/work.merge": "refs/heads/topic" },
    { "branch.feature/work.remote": "origin", "branch.feature/work.merge": "refs/tags/tag" },
    { "branch.feature/work.remote": "origin", "branch.feature/work.merge": "refs/heads/one\nrefs/heads/two" },
  ])("does not replace an incomplete or non-branch upstream with a default", async (values) => {
    await expect(readGitBranchBinding(gitConfig(values), "/fixture")).rejects.toThrow(/upstream/);
  });
});
