import { describe, expect, it } from "vitest";
import type { GitStatusSnapshot } from "../src/types/electron";
import {
  getRemoteFetchTarget,
  shouldFetchRemote,
} from "../../../../src/features/source-control/remoteRefreshPolicy";

describe("remote refresh policy", () => {
  it.each(["github", "puppyone-cloud", "generic-git"] as const)(
    "targets the effective %s remote for the current workspace",
    (kind) => {
      const status = {
        isRepo: true,
        effectiveHosting: {
          kind,
          remoteName: kind === "puppyone-cloud" ? "puppyone" : "origin",
          branchName: "main",
          ready: true,
        },
      } as GitStatusSnapshot;

      const remoteName = kind === "puppyone-cloud" ? "puppyone" : "origin";
      expect(getRemoteFetchTarget(status)).toEqual({
        remoteName,
        branchName: "main",
        key: `${remoteName}:main`,
      });
    },
  );

  it("does not fetch a local-only or unresolved remote", () => {
    const status = {
      isRepo: true,
      effectiveHosting: {
        kind: "local-only",
        remoteName: null,
        branchName: "main",
        ready: false,
      },
    } as GitStatusSnapshot;

    expect(getRemoteFetchTarget(status)).toBeNull();
    expect(getRemoteFetchTarget({
      ...status,
      effectiveHosting: { ...status.effectiveHosting, kind: "generic-git", remoteName: "origin" },
    })).toBeNull();
  });

  it("fetches only while foreground and after the trigger-specific quiet period", () => {
    expect(shouldFetchRemote({
      focused: true,
      online: true,
      now: 100_000,
      lastAttemptAt: null,
      minimumGapMs: 15_000,
    })).toBe(true);
    expect(shouldFetchRemote({
      focused: true,
      online: true,
      now: 100_000,
      lastAttemptAt: 90_000,
      minimumGapMs: 15_000,
    })).toBe(false);
    expect(shouldFetchRemote({
      focused: false,
      online: true,
      now: 100_000,
      lastAttemptAt: null,
      minimumGapMs: 15_000,
    })).toBe(false);
    expect(shouldFetchRemote({
      focused: true,
      online: false,
      now: 100_000,
      lastAttemptAt: null,
      minimumGapMs: 15_000,
    })).toBe(false);
  });
});
