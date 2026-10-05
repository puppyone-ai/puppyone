import { describe, expect, it } from "vitest";
import { createGitSyncTargetPolicy } from "../../../../local-api/git/sync-target.mjs";

const { chooseGitSyncTarget } = createGitSyncTargetPolicy({
  isPuppyoneRemote: (remote) => remote.name === "puppyone",
});
const remotes = [{ name: "origin" }, { name: "puppyone" }];
const configured = { sync: { sourceOfTruth: { service: "puppyone", remote: "puppyone", branch: "main" } } };
const branches = (upstream) => [
  { name: "feature/private", current: true, remote: false, upstream },
  { name: "puppyone/main", remote: true },
  { name: "origin/main", remote: true },
];

describe("current branch synchronization destination", () => {
  it.each(["puppyone/topic", "origin/release", "puppyone/main"])("preserves explicit upstream %s", (upstream) => {
    const [remote, ...tail] = upstream.split("/");
    expect(chooseGitSyncTarget(remotes, branches(upstream), "feature/private", configured))
      .toEqual({ remote, branch: tail.join("/") });
  });

  it("publishes a new branch under its own name, not the workspace's old default", () => {
    expect(chooseGitSyncTarget(remotes, branches(null), "feature/private", configured))
      .toEqual({ remote: "puppyone", branch: "feature/private" });
  });

  it("does not choose origin/main ahead of an unconfigured current branch", () => {
    expect(chooseGitSyncTarget(remotes, branches(null), "feature/private", null))
      .toEqual({ remote: "puppyone", branch: "feature/private" });
  });

  it("does not invent a destination in detached HEAD", () => {
    expect(chooseGitSyncTarget(remotes, branches(null), "detached", configured))
      .toEqual({ remote: null, branch: null });
  });

  it("does not redirect an unavailable upstream to a different remote", () => {
    expect(chooseGitSyncTarget(remotes, branches("removed/topic"), "feature/private", configured))
      .toEqual({ remote: null, branch: null });
  });

  it("resolves a remote name containing slashes without truncating the branch", () => {
    const remote = "team/cloud";
    expect(chooseGitSyncTarget([...remotes, { name: remote }], branches(`${remote}/release/one`), "feature/private", configured))
      .toEqual({ remote, branch: "release/one" });
  });
});
