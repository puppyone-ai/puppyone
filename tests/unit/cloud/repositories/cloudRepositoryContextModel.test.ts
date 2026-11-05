import { describe, expect, it } from "vitest";
import { resolveFeatureFlags } from "../../../../src/features/flags";
import { cloudContextHasProject, getResolvedCloudProjectId, resolveProjectCloudContext }
  from "../../../../src/features/cloud/project/context/projectCloudContext";
import { cloudMessage } from "../../../../src/features/cloud/cloudPresentation";

describe("current repository Cloud context", () => {
  it("has one Cloud feature flag and no Cloud-only workspace mode", () => {
    expect(resolveFeatureFlags({})).toEqual({ cloudWorkspace: true, cloudBilling: false });
    expect(resolveFeatureFlags({})).not.toHaveProperty("cloudOnlyWorkspace");
  });
  it("is local-only without a canonical PuppyOne Git remote", () => {
    expect(resolveProjectCloudContext({ resolvedProjectId: null, remoteProjectId: null,
      contextError: null, hasCanonicalRemote: false, resolving: false })).toEqual({ status: "local-only", projectId: null });
  });
  it("promotes only an exact repository-target match", () => {
    const input = { resolvedProjectId: "proj-1", remoteProjectId: null, contextError: null,
      hasCanonicalRemote: true, resolving: false };
    const resolved = resolveProjectCloudContext({ ...input, target: { kind: "project_root", project_id: "proj-1" } });
    expect(getResolvedCloudProjectId(resolved)).toBe("proj-1");
    expect(cloudContextHasProject(resolved)).toBe(true);
    expect(resolveProjectCloudContext({ ...input, target: { kind: "project_root", project_id: "other" } }))
      .toEqual({ status: "unresolvable", projectId: null, message: cloudMessage("remote-unresolvable") });
  });
  it("keeps authorization and retryable failures distinct", () => {
    expect(resolveProjectCloudContext({ resolvedProjectId: null, remoteProjectId: "proj-secret",
      contextError: cloudMessage("remote-not-authorized"), contextReason: "not-authorized",
      hasCanonicalRemote: true, resolving: false }).status).toBe("not-authorized");
    expect(resolveProjectCloudContext({ resolvedProjectId: null, remoteProjectId: "proj-temporary",
      contextError: cloudMessage("remote-network-failed"), contextReason: "network",
      hasCanonicalRemote: true, resolving: false }).status).toBe("temporarily-unavailable");
  });
});
