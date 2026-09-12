import { describe, expect, it } from "vitest";
import {
  compareCanonicalDesktopVersions,
  evaluateDesktopUpdateCandidate,
  isDesktopUpdateCandidateNewer,
  parseCanonicalDesktopVersion,
} from "../../../../shared/desktop/update-policy.mjs";

describe("Desktop updater monotonic version policy", () => {
  it.each([
    ["0.3.13", "0.3.14"],
    ["0.3.13-internal.33", "0.3.13-internal.34"],
    ["0.3.13-internal.33", "0.3.14-internal.1"],
  ])("accepts only a strictly newer candidate (%s -> %s)", (currentVersion, candidateVersion) => {
    expect(evaluateDesktopUpdateCandidate({ channel: currentVersion.includes("internal") ? "internal" : "stable", currentVersion, candidateVersion })).toMatchObject({
      allowed: true,
      relation: "newer",
    });
  });

  it("implements canonical SemVer prerelease ordering without deployment dependencies", () => {
    const ordered = [
      "1.0.0-alpha",
      "1.0.0-alpha.1",
      "1.0.0-alpha.beta",
      "1.0.0-beta",
      "1.0.0-beta.2",
      "1.0.0-beta.11",
      "1.0.0-rc.1",
      "1.0.0",
    ];
    for (let index = 1; index < ordered.length; index += 1) {
      expect(compareCanonicalDesktopVersions(ordered[index], ordered[index - 1])).toBe(1);
    }
    expect(compareCanonicalDesktopVersions("1.0.0+build.2", "1.0.0+build.1")).toBe(0);
  });

  it.each(["01.0.0", "1.01.0", "1.0.01", "1.0.0-alpha.01", "1.0"])(
    "rejects non-canonical SemVer %s",
    (version) => expect(parseCanonicalDesktopVersion(version)).toBeNull(),
  );

  it.each([
    ["0.3.13", "0.3.13", "same"],
    ["0.3.13", "0.3.11", "older"],
    ["0.3.13", "0.1.14", "older"],
    ["0.3.13-internal.33", "0.3.13-internal.32", "older"],
  ])("rejects a non-forward candidate (%s -> %s)", (currentVersion, candidateVersion, relation) => {
    const options = { channel: currentVersion.includes("internal") ? "internal" : "stable", currentVersion, candidateVersion };
    expect(evaluateDesktopUpdateCandidate(options)).toMatchObject({
      allowed: false,
      relation,
    });
    expect(isDesktopUpdateCandidateNewer(options)).toBe(false);
  });

  it.each([
    ["stable", "0.3.13", "0.3.14-internal.1"],
    ["internal", "0.3.13-internal.33", "0.3.14"],
  ])("rejects a newer version from the wrong %s channel", (channel, currentVersion, candidateVersion) => {
    expect(evaluateDesktopUpdateCandidate({ channel, currentVersion, candidateVersion })).toMatchObject({
      allowed: false,
      channelCompatible: false,
      relation: "newer",
    });
  });

  it.each([
    ["not-semver", "0.3.14"],
    ["0.3.13", "v0.3.14"],
    ["0.3.13", " 0.3.14"],
    ["0.3.13", null],
  ])("fails closed for malformed version input (%s -> %s)", (currentVersion, candidateVersion) => {
    expect(evaluateDesktopUpdateCandidate({ channel: "stable", currentVersion, candidateVersion })).toMatchObject({
      allowed: false,
      relation: "invalid",
    });
  });
});
