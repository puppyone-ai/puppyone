import { describe, expect, it, vi } from "vitest";
import {
  assertDesktopLatestVersionIsHistoryHead,
  assertDesktopReleaseVersionAdvances,
} from "../../../../scripts/release-support/desktop-release-version-policy.mjs";
import {
  parseDesktopReleaseVersionArguments,
  runDesktopReleaseVersionVerifier,
} from "../../../../scripts/verify-desktop-release-version.mjs";

describe("Desktop release version monotonicity policy", () => {
  it("allows recovery with a version above all history even when latest was rolled back", () => {
    const fixture = stableFixture({ latestVersion: "0.3.11" });
    expect(assertDesktopReleaseVersionAdvances({
      ...fixture,
      candidateVersion: "0.3.14",
    })).toMatchObject({
      candidateVersion: "0.3.14",
      highestPublishedVersion: "0.3.13",
      latestVersion: "0.3.11",
    });
  });

  it.each(["0.1.14", "0.3.12", "0.3.13"])(
    "rejects Stable candidate %s behind existing 0.3.13 history",
    (candidateVersion) => {
      expect(() => assertDesktopReleaseVersionAdvances({
        ...stableFixture({ latestVersion: "0.3.11" }),
        candidateVersion,
      })).toThrow(/must be newer.*0\.3\.13/i);
    },
  );

  it("counts withdrawn releases because installed clients can still run them", () => {
    const fixture = stableFixture({ latestVersion: "0.3.11", withdrawnHead: true });
    expect(() => assertDesktopReleaseVersionAdvances({
      ...fixture,
      candidateVersion: "0.3.12",
    })).toThrow(/highest published version is 0\.3\.13/);
  });

  it("detects a mutable latest pointer behind immutable release history", () => {
    expect(() => assertDesktopLatestVersionIsHistoryHead(
      stableFixture({ latestVersion: "0.3.11" }),
    )).toThrow(/latest version 0\.3\.11 is behind.*0\.3\.13/i);
    expect(assertDesktopLatestVersionIsHistoryHead(
      stableFixture({ latestVersion: "0.3.13" }),
    ).latestVersion).toBe("0.3.13");
  });

  it("enforces canonical Internal build versions", () => {
    const fixture = internalFixture();
    expect(assertDesktopReleaseVersionAdvances({
      ...fixture,
      candidateVersion: "0.3.13-internal.34",
    }).candidateVersion).toBe("0.3.13-internal.34");
    expect(() => assertDesktopReleaseVersionAdvances({
      ...fixture,
      candidateVersion: "0.3.14",
    })).toThrow(/internal\.<build>/i);
  });

  it("requires latest.json to be represented in the immutable catalog", () => {
    expect(() => assertDesktopLatestVersionIsHistoryHead({
      ...stableFixture({ latestVersion: "0.3.13" }),
      latestPointer: pointer("stable", "0.3.12"),
    })).toThrow(/absent from its release catalog/i);
  });
});

describe("Desktop release version verifier CLI", () => {
  it("parses candidate and monitor modes with trusted default coordinates", () => {
    expect(parseDesktopReleaseVersionArguments([
      "--channel", "stable",
      "--candidate-version", "0.3.14",
      "--require-latest-history-head",
    ])).toMatchObject({
      candidateVersion: "0.3.14",
      channel: "stable",
      requireLatestHistoryHead: true,
      catalogUrl: "https://downloads.puppyone.ai/desktop/catalog/releases.json",
    });
  });

  it("fetches both live contracts and rejects a rollback", async () => {
    const fixture = stableFixture({ latestVersion: "0.3.11" });
    const fetchImpl = vi.fn(async (url) => ({
      ok: true,
      json: async () => url.includes("catalog") ? fixture.catalog : fixture.latestPointer,
    }));

    await expect(runDesktopReleaseVersionVerifier([
      "--channel", "stable",
      "--require-latest-history-head",
    ], { fetchImpl })).rejects.toThrow(/behind published history head/i);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

function stableFixture({ latestVersion = "0.3.13", withdrawnHead = false } = {}) {
  return {
    channel: "stable",
    latestPointer: pointer("stable", latestVersion),
    catalog: {
      schemaVersion: 1,
      product: "puppyone-desktop",
      releases: [
        release("stable", "0.3.11"),
        release("stable", "0.3.13", { withdrawn: withdrawnHead }),
      ],
    },
  };
}

function internalFixture() {
  return {
    channel: "internal",
    latestPointer: pointer("internal", "0.3.13-internal.33"),
    catalog: {
      schemaVersion: 1,
      product: "puppyone-desktop",
      releases: [release("internal", "0.3.13-internal.33")],
    },
  };
}

function pointer(channel, version) {
  return {
    schemaVersion: 2,
    product: "puppyone-desktop",
    channel,
    tag: `v${version}`,
    version,
  };
}

function release(channel, version, extra = {}) {
  return {
    schemaVersion: 2,
    product: "puppyone-desktop",
    channel,
    tag: `v${version}`,
    version,
    ...extra,
  };
}
