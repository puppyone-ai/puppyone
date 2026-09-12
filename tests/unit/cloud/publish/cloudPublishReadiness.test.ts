import { describe, expect, it } from "vitest";
import { getCloudPublishReadiness } from "../../../../src/features/cloud/workspace/cloudPublishReadiness";

describe("Cloud publish readiness", () => {
  it("requires a real first commit even when an unborn branch has a name", () => {
    expect(getCloudPublishReadiness({
      isRepo: true,
      branch: "main",
      headCommitId: "(initial)",
      totalCommits: 0,
    })).toBe("commit-required");
  });

  it("does not trust a head id when the repository reports zero commits", () => {
    expect(getCloudPublishReadiness({
      isRepo: true,
      branch: "main",
      headCommitId: "0123456789012345678901234567890123456789",
      totalCommits: 0,
    })).toBe("commit-required");
  });

  it("allows a named branch with committed history", () => {
    expect(getCloudPublishReadiness({
      isRepo: true,
      branch: "main",
      headCommitId: "0123456789012345678901234567890123456789",
      totalCommits: 1,
    })).toBe("ready");
  });
});
