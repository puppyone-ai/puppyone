import { describe, expect, it } from "vitest";
import { deriveLocalConnection } from "../../../../../electron/main/agent/connections/local-agent-connection-policy.mjs";

const ready = {
  id: "codex", displayName: "Codex", installation: "detected", authentication: "signed-in",
  version: "1.2.3", protocolCompatible: true, hasModels: true,
};
const cases = [
  ["ready", ready],
  ["missing probe", undefined],
  ...["not-found", "unsupported", "broken", "invalid"].map((installation) => [installation, { ...ready, installation }]),
  ...["signed-out", "expired", "error", "unknown", "invalid"].map((authentication) => [authentication, { ...ready, authentication }]),
  ["protocol unavailable", { ...ready, protocolCompatible: false }],
  ["protocol precedes authentication", { ...ready, protocolCompatible: false, authentication: "error", unavailableMessage: " Needs\nupgrade " }],
  ["missing models", { ...ready, hasModels: false }],
  ["strict protocol boolean", { ...ready, protocolCompatible: 1 }],
  ["strict models boolean", { ...ready, hasModels: 1 }],
  ["backend denied", ready, { backendRegistered: false }],
  ["workspace denied", ready, { workspaceAllowed: false }],
  ["only explicit false denies gates", ready, { backendRegistered: null, workspaceAllowed: 0 }],
  ["sanitized fields", { ...ready, id: " CODEX ", displayName: " Agent\nName\0 ", version: " v1.2+test ", source: "configured" }],
  ["invalid fields", { ...ready, id: "bad id", displayName: "\0", version: "bad version", source: "private-path" }],
  ["long fields", { ...ready, displayName: "x".repeat(90), version: "1".repeat(81) }],
  ...["user-installation", "system-installation", "path-installation", "application-bundle"].map((source) => [source, { ...ready, source }]),
];

describe("local connection characterization", () => {
  it.each(cases)("preserves %s", (_name, probe, gates) => {
    expect(deriveLocalConnection(probe, gates)).toMatchSnapshot();
  });
  it("does not read admission gates before the probe is ready", () => {
    expect(deriveLocalConnection({ ...ready, installation: "not-found" }, null).integration).toBe("inventory-only");
  });

  it("does not read the workspace gate after backend denial", () => {
    const gates = {
      backendRegistered: false,
      get workspaceAllowed() { throw new Error("The later gate must not be read"); },
    };
    expect(deriveLocalConnection(ready, gates).integration).toBe("setup-required");
  });

});
