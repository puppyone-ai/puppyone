import { describe, expect, it } from "vitest";
import { FEATURE_FLAG_DEFAULTS } from "../../../../src/features/flags/registry";
import { resolveFeatureFlags } from "../../../../src/features/flags/resolveFlags";
import {
  cloudContextHasProject,
  getResolvedCloudProjectId,
  resolveCloudHubSectionAfterContextChange,
  resolveCloudHubSectionForContext,
  resolveProjectCloudContext,
} from "../../../../src/features/cloud/project/context/projectCloudContext";
import { cloudMessage } from "../../../../src/features/cloud/cloudPresentation";

describe("local repository application shell", () => {
  it("has one Cloud feature flag and no Cloud-only workspace mode", () => {
    expect(FEATURE_FLAG_DEFAULTS.cloudWorkspace).toBe(true);
    expect(FEATURE_FLAG_DEFAULTS).not.toHaveProperty("cloudOnlyWorkspace");
    expect(resolveFeatureFlags({})).not.toHaveProperty("cloudOnlyWorkspace");
  });
});

describe("current repository Cloud context", () => {
  it("is local-only when no canonical PuppyOne Git remote exists", () => {
    expect(resolveProjectCloudContext({
      resolvedProjectId: null,
      remoteProjectId: null,
      contextError: null,
      hasCanonicalRemote: false,
      resolving: false,
    })).toEqual({ status: "local-only", projectId: null });
  });

  it("promotes only an exact repository-target match", () => {
    const resolved = resolveProjectCloudContext({
      resolvedProjectId: "proj-1",
      remoteProjectId: null,
      contextError: null,
      hasCanonicalRemote: true,
      target: { kind: "project_root", project_id: "proj-1" },
      resolving: false,
    });
    expect(getResolvedCloudProjectId(resolved)).toBe("proj-1");
    expect(cloudContextHasProject(resolved)).toBe(true);
    expect(resolveCloudHubSectionForContext(resolved)).toBe("contents");

    expect(resolveProjectCloudContext({
      resolvedProjectId: "proj-1",
      remoteProjectId: null,
      contextError: null,
      hasCanonicalRemote: true,
      target: { kind: "project_root", project_id: "other" },
      resolving: false,
    })).toEqual({
      status: "unresolvable",
      projectId: null,
      message: cloudMessage("remote-unresolvable"),
    });
  });

  it("keeps authorization and retryable failures distinct", () => {
    expect(resolveProjectCloudContext({
      resolvedProjectId: null,
      remoteProjectId: "proj-secret",
      contextError: cloudMessage("remote-not-authorized"),
      contextReason: "not-authorized",
      hasCanonicalRemote: true,
      resolving: false,
    }).status).toBe("not-authorized");
    expect(resolveProjectCloudContext({
      resolvedProjectId: null,
      remoteProjectId: "proj-temporary",
      contextError: cloudMessage("remote-network-failed"),
      contextReason: "network",
      hasCanonicalRemote: true,
      resolving: false,
    }).status).toBe("temporarily-unavailable");
  });

  it("preserves Organization destinations without treating them as states", () => {
    expect(resolveCloudHubSectionAfterContextChange({
      currentSection: "cloud-team",
      hasProjectContext: false,
      workspaceChanged: false,
    })).toBe("cloud-team");
    expect(resolveCloudHubSectionAfterContextChange({
      currentSection: "history",
      hasProjectContext: false,
      workspaceChanged: false,
    })).toBe("initialize");
    expect(resolveCloudHubSectionAfterContextChange({
      currentSection: "history",
      hasProjectContext: true,
      workspaceChanged: false,
    })).toBe("history");
  });
});
