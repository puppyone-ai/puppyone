import { describe, expect, it } from "vitest";
import {
  migratedRuntimeDescriptor,
  resolvePersistedRuntimeId,
} from "../../../../electron/main/agent/migrations/legacy-session-format.mjs";

describe("legacy Agent session identity", () => {
  it("preserves the stable runtime id while projecting the current public identity", () => {
    expect(resolvePersistedRuntimeId({ runtimeId: "puppyone-agent" })).toBe("puppyone-agent");
    expect(migratedRuntimeDescriptor({
      runtime: {
        id: "puppyone-agent",
        displayName: "PuppyOne Agent",
        kind: "managed-harness",
      },
    }, "puppyone-agent")).toMatchObject({
      id: "puppyone-agent",
      displayName: "Workspace Agent",
      kind: "managed-harness",
    });
  });
});
