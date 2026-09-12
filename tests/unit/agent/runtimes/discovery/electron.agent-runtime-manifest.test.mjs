import { describe, expect, it } from "vitest";
import {
  defineAgentRuntimeManifest,
  runtimeDescriptorFromManifest,
} from "../../../../../electron/main/agent/runtime/agent-runtime-manifest.mjs";

describe("Agent runtime manifest", () => {
  it("represents a first-party ACP harness without exposing launch details", () => {
    const grok = defineAgentRuntimeManifest({
      id: "grok-build",
      displayName: "Grok Build",
      execution: { kind: "local-process", distribution: "user-installed", controller: "bundled-adapter" },
      protocol: { kind: "acp", transport: "stdio-json-rpc" },
      integration: { kind: "native-protocol", adapter: "generic-acp" },
      trust: { level: "first-party", publisher: "xAI" },
      ownership: {
        harness: "runtime",
        credentials: ["runtime"],
        models: "runtime",
        billing: ["runtime"],
        session: "runtime",
      },
    });

    const descriptor = runtimeDescriptorFromManifest(grok);
    expect(descriptor).toMatchObject({
      id: "grok-build",
      kind: "native-protocol",
      distribution: "user-installed",
      protocol: { kind: "acp", transport: "stdio-json-rpc" },
      integration: { kind: "native-protocol", adapter: "generic-acp" },
      trust: { level: "first-party", publisher: "xAI" },
    });
    expect(descriptor).not.toHaveProperty("launch");
    expect(Object.isFrozen(grok.ownership.credentials)).toBe(true);
  });

  it("represents Pi as a specialized official RPC runtime rather than an ACP bridge", () => {
    const pi = defineAgentRuntimeManifest({
      id: "pi",
      displayName: "Pi",
      execution: { kind: "local-process", distribution: "user-installed", controller: "bundled-adapter" },
      protocol: { kind: "rpc", transport: "stdio-jsonl" },
      integration: { kind: "specialized-native", adapter: "specialized" },
      trust: { level: "first-party", publisher: "Pi" },
      ownership: {
        harness: "runtime",
        credentials: ["user-provider"],
        models: "runtime",
        billing: ["user-provider"],
        session: "runtime",
      },
    });

    expect(runtimeDescriptorFromManifest(pi)).toMatchObject({
      protocol: { kind: "rpc", transport: "stdio-jsonl" },
      integration: { kind: "specialized-native", adapter: "specialized" },
      ownership: { credentials: ["user-provider"], models: "runtime" },
    });
  });

  it("rejects combinations that blur protocol and trust boundaries", () => {
    expect(() => defineAgentRuntimeManifest(baseManifest({
      protocol: { kind: "rpc", transport: "stdio-json-rpc" },
      integration: { kind: "native-protocol", adapter: "generic-acp" },
    }))).toThrow(/generic-acp requires protocol\.kind acp/i);

    expect(() => defineAgentRuntimeManifest(baseManifest({
      integration: { kind: "compatibility-bridge", adapter: "generic-acp" },
    }))).toThrow(/compatibility-bridge requires reviewed-bridge trust/i);

    expect(() => defineAgentRuntimeManifest({
      ...baseManifest(),
      launch: { command: "agent" },
    })).toThrow(/unsupported field launch/i);
  });
});

function baseManifest(overrides = {}) {
  return {
    id: "fixture-runtime",
    displayName: "Fixture Runtime",
    execution: { kind: "local-process", distribution: "user-installed", controller: "bundled-adapter" },
    protocol: { kind: "acp", transport: "stdio-json-rpc" },
    integration: { kind: "native-protocol", adapter: "generic-acp" },
    trust: { level: "first-party", publisher: "Fixture" },
    ownership: {
      harness: "runtime",
      credentials: ["runtime"],
      models: "runtime",
      billing: ["runtime"],
      session: "runtime",
    },
    ...overrides,
  };
}
