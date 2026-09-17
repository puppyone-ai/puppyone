import { describe, expect, it } from "vitest";
import {
  migratedRuntimeDescriptor,
  resolvePersistedRuntimeId,
} from "../../../../electron/main/agent/migrations/legacy-session-format.mjs";

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
});
