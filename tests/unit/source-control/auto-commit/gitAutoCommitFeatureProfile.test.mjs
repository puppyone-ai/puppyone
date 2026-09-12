import { describe, expect, it } from "vitest";
import packageMetadata from "../../../../package.json";
import {
  GIT_AUTO_COMMIT_DEV_ENV,
  GIT_AUTO_COMMIT_RENDERER_ARGUMENT,
  resolveGitAutoCommitFeatureProfile,
  resolvePackagedGitAutoCommitCapability,
} from "../../../../electron/main/git-auto-commit/feature-profile.mjs";

describe("Git Auto Commit release capability", () => {
  it("is unavailable by default", () => {
    expect(resolveGitAutoCommitFeatureProfile({
      packageMetadata,
      isPackaged: true,
    })).toEqual({ available: false, rendererArguments: [] });
  });

  it("allows only an unpackaged development override", () => {
    const environment = { [GIT_AUTO_COMMIT_DEV_ENV]: "1" };
    expect(resolveGitAutoCommitFeatureProfile({
      packageMetadata,
      environment,
      isPackaged: false,
    })).toEqual({ available: true, rendererArguments: [GIT_AUTO_COMMIT_RENDERER_ARGUMENT] });
    expect(resolveGitAutoCommitFeatureProfile({
      packageMetadata,
      environment,
      isPackaged: true,
    }).available).toBe(false);
  });

  it("allows an explicit packaged capability and rejects malformed metadata", () => {
    expect(resolveGitAutoCommitFeatureProfile({
      packageMetadata: { puppyoneCapabilities: { gitAutoCommit: true } },
      isPackaged: true,
    }).available).toBe(true);
    expect(() => resolvePackagedGitAutoCommitCapability({
      puppyoneCapabilities: { gitAutoCommit: "yes" },
    })).toThrow(/must be boolean/i);
    expect(() => resolvePackagedGitAutoCommitCapability({
      puppyoneCapabilities: { gitAutoCommit: false },
      build: { extraMetadata: { puppyoneCapabilities: { gitAutoCommit: "no" } } },
    })).toThrow(/must be boolean/i);
  });

  it("rejects a builder-only capability override", () => {
    expect(() => resolvePackagedGitAutoCommitCapability({
      puppyoneCapabilities: { gitAutoCommit: false },
      build: { extraMetadata: { puppyoneCapabilities: { gitAutoCommit: true } } },
    })).toThrow(/cannot override/i);
  });

});
