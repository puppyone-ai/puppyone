import { describe, expect, it } from "vitest";
import {
  migratedRuntimeDescriptor,
  resolvePersistedRuntimeId,
} from "../../../../electron/main/agent/migrations/legacy-session-format.mjs";
import {
  WORKBUDDY_CHINA_CHANNEL,
  WORKBUDDY_INTERNATIONAL_CHANNEL,
} from "../../../../electron/main/agent/runtimes/workbuddy/workbuddy-channels.mjs";
import { workBuddyHistorySource } from "../../../../electron/main/agent/runtimes/workbuddy/workbuddy-history-source.mjs";

describe("legacy Agent session identity", () => {
  it.each(["PuppyOne Agent", "Workspace Agent"])(
    "projects the legacy %s label to the current public identity",
    (displayName) => {
      expect(resolvePersistedRuntimeId({ runtimeId: "puppyone-agent" })).toBe("puppyone-agent");
      expect(migratedRuntimeDescriptor({
        runtime: {
          id: "puppyone-agent",
          displayName,
          kind: "managed-harness",
        },
      }, "puppyone-agent")).toMatchObject({
        id: "puppyone-agent",
        displayName: "Built-in Agent",
        kind: "managed-harness",
      });
    },
  );

  it.each([
    [WORKBUDDY_CHINA_CHANNEL, "workbuddy-china"],
    [WORKBUDDY_INTERNATIONAL_CHANNEL, "workbuddy-international"],
  ])("migrates a legacy WorkBuddy locator to $id from its native source scope", (channel, runtimeId) => {
    const sourceScopeId = workBuddyHistorySource({ channel, environment: process.env });
    const record = {
      runtimeId: "workbuddy",
      sourceScopeId,
      runtime: { id: "workbuddy", displayName: "WorkBuddy", kind: "native-cli" },
    };

    expect(resolvePersistedRuntimeId(record)).toBe(runtimeId);
    expect(migratedRuntimeDescriptor(record, runtimeId)).toMatchObject({
      id: runtimeId,
      displayName: channel.displayName,
    });
  });
});
