import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Desktop Agent preload boundary", () => {
  it("exposes the versioned feed and routes user intent through one command channel", async () => {
    const source = await readFile(new URL("../electron/preload.cjs", import.meta.url), "utf8");
    for (const name of [
      "discoverAgentProviders",
      "discoverLocalAgentConnections",
      "listAgentModels",
      "readAgentAccount",
      "createAgentSession",
      "resumeAgentSession",
      "openAgentSession",
      "replayAgentSession",
      "attachAgentSession",
      "acknowledgeAgentSession",
      "readAgentSessionWatermark",
      "detachAgentSession",
      "listAgentSessions",
      "forkAgentSession",
      "archiveAgentSession",
      "deleteAgentSession",
      "closeAgentSession",
      "stageAgentAttachments",
      "revokeAgentAttachments",
      "resolveAgentWorkspaceReferences",
      "pickAgentWorkspaceReferences",
      "startAgentTurn",
      "steerAgentTurn",
      "interruptAgentTurn",
      "compactAgentSession",
      "resolveAgentApproval",
      "resolveAgentQuestion",
      "onAgentSessionFrame",
    ]) {
      expect(source).toContain(`${name}:`);
    }
    for (const channel of [
      "agent:providers-discover",
      "agent:local-connections-discover",
      "agent:models-list",
      "agent:account-read",
      "agent:session-create",
      "agent:session-resume",
      "agent:session-open",
      "agent:session-replay",
      "agent:session-attach",
      "agent:session-feed-ack",
      "agent:session-feed-watermark",
      "agent:session-detach",
      "agent:sessions-list",
      "agent:session-fork",
      "agent:session-archive",
      "agent:session-delete",
      "agent:session-close",
      "agent:reference-stage",
      "agent:reference-revoke",
      "agent:reference-resolve-workspace",
      "agent:reference-pick-workspace",
      "agent:command-dispatch",
      "agent:session-compact",
      "agent:session-frame",
    ]) {
      expect(source).toContain(channel);
    }
    // Old README-divergent channel/method names must not linger.
    expect(source).not.toContain("discoverAgentProvider:");
    expect(source).not.toContain("restoreAgentSession:");
    expect(source).not.toContain("agent:provider-discover");
    expect(source).not.toContain("agent:session-restore");
    expect(source).not.toContain('ipcRenderer.on("agent:event"');
    expect(source).not.toContain('ipcRenderer.on("agent:session-exit"');
    expect(source).not.toMatch(/spawnAgentProcess|writeAgentStdin|agentEnvironment/);
    expect(source).toMatch(/stageAgentAttachments:[\s\S]*webUtils\.getPathForFile\(file\)[\s\S]*sourcePaths/);
    expect(source).not.toMatch(/agent:reference-stage[^}]*files/);
  });
});
