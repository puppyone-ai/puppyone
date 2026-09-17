import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_AGENT_RUNTIME_ID,
  createDefaultAgentRuntimeHost,
} from "../../../../electron/main/agent/bootstrap/create-agent-runtime-host.mjs";

describe("Agent production composition", () => {
  it("registers independent native backends and never silently replaces an explicit selection", async () => {
    const host = productionHost({
      codex: readiness("codex", "ready"),
      claude: readiness("claude", "ready"),
      "opencode-native": readiness("opencode-native", "not-installed"),
      pi: readiness("pi", "ready"),
      cursor: readiness("cursor", "protocol-unavailable"),
      workbuddy: readiness("workbuddy", "ready"),
      hermes: readiness("hermes", "ready"),
    });

    const catalog = await host.discover();
    expect(host.descriptors().map((runtime) => runtime.id)).toEqual([
      "codex",
      "claude",
      "opencode-native",
      "cursor",
      "hermes",
      "pi",
      "workbuddy",
    ]);
    expect(DEFAULT_AGENT_RUNTIME_ID).toBe("codex");
    expect(host.select(catalog)?.descriptor.id).toBe("codex");
    expect(host.select(catalog, "codex")?.descriptor.id).toBe("codex");
    expect(host.select(catalog, "missing")).toBeNull();
    expect(host.require("claude").descriptor.displayName).toBe("Claude Agent");
    expect(host.manifests().map((runtime) => [
      runtime.id,
      runtime.integration.kind,
      runtime.protocol.kind,
      runtime.trust.level,
    ])).toEqual([
      ["codex", "specialized-native", "app-server", "first-party"],
      ["claude", "specialized-native", "agent-sdk", "first-party"],
      ["opencode-native", "native-protocol", "acp", "first-party"],
      ["cursor", "native-protocol", "acp", "first-party"],
      ["hermes", "native-protocol", "acp", "first-party"],
      ["pi", "specialized-native", "rpc", "first-party"],
      ["workbuddy", "native-protocol", "acp", "first-party"],
    ]);
    expect(() => host.require("puppyone-agent")).toThrow("Unknown Agent runtime: puppyone-agent");
    await host.dispose();
  });

  it("isolates discovery failure to the backend that failed", async () => {
    const brokenDiscovery = { discover: vi.fn(async () => { throw new Error("cursor discovery failed"); }) };
    const host = productionHost({
      codex: readiness("codex", "ready"),
      claude: readiness("claude", "not-installed"),
      "opencode-native": readiness("opencode-native", "not-installed"),
      pi: readiness("pi", "not-installed"),
      cursor: brokenDiscovery,
      workbuddy: readiness("workbuddy", "not-installed"),
      hermes: readiness("hermes", "not-installed"),
    }, { rawDiscovery: true });

    const catalog = await host.discover();
    expect(catalog.find((entry) => entry.descriptor.id === "cursor")?.readiness).toMatchObject({ status: "error" });
    expect(catalog.find((entry) => entry.descriptor.id === "codex")?.readiness).toMatchObject({ status: "ready" });
    expect(host.select(catalog, "codex")?.descriptor.id).toBe("codex");
    await host.dispose();
  });
});

function productionHost(values, { rawDiscovery = false } = {}) {
  const discovery = (id) => rawDiscovery && values[id]?.discover
    ? values[id]
    : { discover: vi.fn(async () => values[id]) };
  return createDefaultAgentRuntimeHost({
    codex: { discovery: discovery("codex") },
    claude: { discovery: discovery("claude") },
    openCodeNative: { discovery: discovery("opencode-native") },
    pi: { discovery: discovery("pi") },
    cursor: { discovery: discovery("cursor") },
    workBuddy: { discovery: discovery("workbuddy") },
    hermes: { discovery: discovery("hermes") },
  });
}

function readiness(runtimeId, status) {
  const code = status === "ready"
    ? "READY"
    : status === "not-installed"
      ? "RUNTIME_NOT_INSTALLED"
      : status === "protocol-unavailable"
        ? "PROTOCOL_UNAVAILABLE"
        : "RUNTIME_DISCOVERY_FAILED";
  return {
    runtimeId,
    provider: runtimeId,
    status,
    code,
    version: status === "ready" ? "1.0.0" : null,
    minimumVersion: null,
    executablePath: status === "ready" ? `/${runtimeId}` : null,
    environment: {},
    message: status,
  };
}
