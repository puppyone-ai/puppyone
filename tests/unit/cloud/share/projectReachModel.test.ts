import { describe, expect, it } from "vitest";
import {
  defaultReachScope,
  inviteReachTarget,
  isReachRunning,
  reachIntentForTarget,
  reachIntentTargets,
  reachModeSelectable,
  reachScopeForTarget,
  resolveReachAccountStep,
  resolveReachStage,
} from "../../../../src/features/cloud/share/project-reach/projectReach";
import {
  SHARE_TARGETS,
  getShareTarget,
  shareTargetLabelKey,
} from "../../../../src/features/cloud/share/shareTargets";
import type { PublishPreparationStage } from "../../../../src/features/cloud/initialization/publishPreparation";
import type { CloudPublishProgressStage } from "../../../../src/types/electron";
import englishCatalog from "../../../../src/localization/catalog-loaders/en";

describe("the two things a folder can be made to reach", () => {
  it("treats a person as an invite and everything else as an agent to connect", () => {
    expect(reachIntentForTarget("person")).toBe("invite");
    expect(reachIntentForTarget("claude")).toBe("connect");
    expect(reachIntentForTarget("slack-bot")).toBe("connect");
    expect(reachIntentForTarget(null)).toBe("invite");
    expect(inviteReachTarget().id).toBe("person");
    expect(reachIntentTargets("invite").map((target) => target.id)).toEqual(["person"]);
    expect(reachIntentTargets("connect").map((target) => target.id))
      .toEqual(["viktor", "claude", "chatgpt", "slack-bot", "grok", "mcp"]);
  });

  // A destination is named and handed something; when it happens to be awake
  // is not a property the product states any more, so the model does not
  // carry it either.
  it("names every candidate and knows what each one is handed", () => {
    for (const target of SHARE_TARGETS) {
      const messageId = shareTargetLabelKey(target.id);
      expect(englishCatalog[messageId], messageId).toBeTruthy();
    }
    expect(getShareTarget("viktor").channel).toBe("mcp");
    expect(getShareTarget("slack-bot").channel).toBe("link");
    expect(getShareTarget("mcp").docsUrl).toBeTruthy();
  });
});

describe("what the form defaults to", () => {
  it("defaults to the folder it was opened from, read only", () => {
    expect(defaultReachScope("docs")).toEqual({ path: "docs", mode: "r" });
    expect(defaultReachScope("")).toEqual({ path: "", mode: "r" });
  });

  it("offers a permission choice only where the destination holds its own credential", () => {
    expect(reachModeSelectable(getShareTarget("claude"))).toBe(true);
    expect(reachModeSelectable(getShareTarget("person"))).toBe(false);
    expect(reachModeSelectable(null)).toBe(false);
  });

  it("never sends a writable link, whatever the form last held", () => {
    const requested = { path: "docs", mode: "rw" } as const;

    expect(reachScopeForTarget(requested, getShareTarget("claude"))).toEqual(requested);
    expect(reachScopeForTarget(requested, getShareTarget("person"))).toEqual({ path: "docs", mode: "r" });
  });
});

describe("the account as a step of the progress list", () => {
  it("waits behind the work that needs nobody, then becomes the current step", () => {
    expect(resolveReachAccountStep("preparing")).toBe("pending");
    expect(resolveReachAccountStep("account")).toBe("active");
    expect(resolveReachAccountStep("publishing")).toBe("done");
    expect(resolveReachAccountStep("ready")).toBe("done");
  });

  it("shows the local stage first, the publish stage next, and completion last", () => {
    const stage = (
      phase: Parameters<typeof resolveReachStage>[0]["phase"],
      local: PublishPreparationStage | null = null,
      publish: CloudPublishProgressStage | null = null,
    ) => resolveReachStage({ phase, localStage: local, publishStage: publish });

    expect(stage("preparing", "creating-snapshot")).toBe("creating-snapshot");
    expect(stage("preparing")).toBe("validating");
    expect(stage("account", "creating-branch")).toBe("creating-branch");
    expect(stage("publishing", null, "uploading")).toBe("uploading");
    expect(stage("publishing")).toBe("creating-project");
    expect(stage("issuing")).toBe("completed");
    expect(stage("ready")).toBe("completed");
  });

  it("knows when the screen is working rather than being filled in", () => {
    expect(isReachRunning("form")).toBe(false);
    expect(isReachRunning("preparing")).toBe(true);
    expect(isReachRunning("account")).toBe(true);
    expect(isReachRunning("issuing")).toBe(true);
    expect(isReachRunning("ready")).toBe(false);
    expect(isReachRunning("failed")).toBe(false);
  });
});
