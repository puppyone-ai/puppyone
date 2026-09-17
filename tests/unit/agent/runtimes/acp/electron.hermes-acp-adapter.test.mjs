import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  HermesAcpAdapter,
  hermesAuthenticationMethod,
} from "../../../../../electron/main/agent/runtimes/hermes/hermes-acp-adapter.mjs";
import {
  buildHermesEnvironment,
  discoverHermesExecutable,
  MINIMUM_HERMES_ACP_VERSION,
  parseHermesVersion,
} from "../../../../../electron/main/agent/runtimes/hermes/hermes-discovery.mjs";
import { hermesHistorySource } from "../../../../../electron/main/agent/runtimes/hermes/hermes-history-source.mjs";

describe("Hermes ACP runtime", () => {
  it("selects configured agent-managed credentials without invoking terminal setup", () => {
    expect(hermesAuthenticationMethod([
      { id: "openrouter", name: "OpenRouter runtime credentials" },
      { id: "hermes-setup", type: "terminal", args: ["--setup"] },
    ])).toBe("openrouter");
    expect(hermesAuthenticationMethod([
      { id: "hermes-setup", type: "terminal", args: ["--setup"] },
    ])).toBeNull();
  });

  it("scopes native history to HERMES_HOME without exposing its path", () => {
    const standard = hermesHistorySource({ HOME: "/Users/test" });
    const custom = hermesHistorySource({ HOME: "/Users/test", HERMES_HOME: "~/profiles/work" });
    expect(standard).toMatch(/^local:[a-f0-9]{64}$/u);
    expect(custom).toMatch(/^local:[a-f0-9]{64}$/u);
    expect(custom).not.toBe(standard);
    expect(custom).not.toContain("profiles/work");
  });

  it("uses the first-party ACP server and native model and mode selection", async () => {
    const connection = new FakeHermesConnection();
    const adapter = new HermesAcpAdapter({
      readiness: {
        executablePath: "/tools/hermes",
        argsPrefix: ["launcher"],
        environment: { HOME: "/Users/test", PATH: "/usr/bin" },
        version: "0.16.0",
        source: "user-installed",
      },
      workspaceRoot: "/workspace",
      appVersion: "0.3.22",
      connectionFactory: (options) => {
        connection.options = options;
        return connection;
      },
      fileSystemFactory: () => ({ readTextFile: vi.fn(), writeTextFile: vi.fn() }),
      projectInstructionLoader: vi.fn(async () => ({ source: null, text: "", bytes: 0 })),
    });

    const result = await adapter.bootstrapSession({
      kind: "create",
      model: "custom:lab:qwen-2.5",
      mode: "accept_edits",
    });

    expect(connection.options).toMatchObject({
      executablePath: "/tools/hermes",
      args: ["launcher", "acp"],
      cwd: "/workspace",
      env: { PUPPYONE_AGENT_BACKEND: "hermes" },
    });
    expect(connection.request.mock.calls.map(([method]) => method)).toEqual([
      "initialize",
      "authenticate",
      "session/new",
      "session/set_model",
      "session/set_mode",
    ]);
    expect(connection.request).toHaveBeenCalledWith(
      "authenticate",
      { methodId: "openrouter" },
      expect.any(Object),
    );
    expect(connection.request).toHaveBeenCalledWith(
      "session/set_model",
      { sessionId: "hermes-session", modelId: "custom:lab:qwen-2.5" },
      expect.any(Object),
    );
    expect(result).toMatchObject({
      inspection: {
        runtime: { id: "hermes", version: "0.16.0", compatibility: "acp-v1" },
        account: { account: { type: "hermes" }, requiresRuntimeSetup: false },
        providers: [
          { id: "openrouter", defaultModel: "openrouter:z-ai/glm-5.1", modelCount: 1 },
          { id: "custom:lab", modelCount: 1 },
        ],
        models: [
          { id: "openrouter:z-ai/glm-5.1", providerId: "openrouter", modelId: "z-ai/glm-5.1" },
          { id: "custom:lab:qwen-2.5", providerId: "custom:lab", modelId: "qwen-2.5" },
        ],
        capabilities: {
          resume: true,
          fork: true,
          sessionHistory: true,
          attachments: true,
          referenceInputs: { attachments: { image: { accepted: true }, text: { accepted: true } } },
        },
      },
      providerSession: {
        providerSessionId: "hermes-session",
        model: "custom:lab:qwen-2.5",
        mode: "accept_edits",
      },
    });
    await adapter.dispose();
  });

  it("requires the tested official ACP baseline and verifies the ACP endpoint", async () => {
    const discover = vi.fn(async (options) => {
      expect(options.installationId).toBe("hermes");
      expect(options.minimumVersion).toBe("0.16.0");
      expect(options.parseVersion("Hermes Agent v0.16.0 (2026.6.5)")).toBe("0.16.0");
      expect(options.buildEnvironment({ PATH: "/tools" }, {}, { platform: "darwin" })).toMatchObject({
        PATH: "/tools",
        PUPPYONE_AGENT: "1",
        PUPPYONE_AGENT_BACKEND: "hermes",
      });
      return {
        status: "ready",
        code: "READY",
        version: "0.16.0",
        minimumVersion: MINIMUM_HERMES_ACP_VERSION,
        executablePath: "/tools/python",
        argsPrefix: ["/tools/hermes.py"],
        environment: { PATH: "/tools" },
        message: "Hermes Agent is ready.",
      };
    });
    const probe = vi.fn(async (_spawn, executablePath, args, options) => {
      expect(executablePath).toBe("/tools/python");
      expect(args).toEqual(["/tools/hermes.py", "acp", "--check"]);
      expect(options).toMatchObject({ timeoutMs: 8_000, maxBytes: 64 * 1024 });
      return { code: 0, stdout: "Hermes ACP check OK\n", stderr: "" };
    });

    await expect(discoverHermesExecutable({ discover, probe })).resolves.toMatchObject({
      runtimeId: "hermes",
      status: "ready",
      compatibility: "acp-v1",
      selectable: true,
      argsPrefix: ["/tools/hermes.py"],
    });
    expect(parseHermesVersion("Hermes Agent v0.16.0 (2026.6.5) · upstream bd740f20")).toBe("0.16.0");
    expect(buildHermesEnvironment({ PATH: "/tools" }, {}, { platform: "darwin" }))
      .not.toHaveProperty("HERMES_ACP_SKIP_CONFIGURED_MCP");
  });

  it("fails closed when the official ACP dependency check fails", async () => {
    const readiness = await discoverHermesExecutable({
      discover: async () => ({
        status: "ready",
        code: "READY",
        version: "0.16.0",
        minimumVersion: MINIMUM_HERMES_ACP_VERSION,
        executablePath: "/tools/hermes",
        argsPrefix: [],
        environment: {},
        message: "ready",
      }),
      probe: async () => ({ code: 1, stdout: "", stderr: "Install hermes-agent[acp]" }),
    });
    expect(readiness).toMatchObject({
      status: "protocol-unavailable",
      code: "PROTOCOL_UNAVAILABLE",
      compatibility: "unavailable",
      selectable: false,
    });
  });
});

class FakeHermesConnection extends EventEmitter {
  constructor() {
    super();
    this.closed = false;
    this.request = vi.fn(async (method) => {
      if (method === "initialize") return {
        protocolVersion: 1,
        agentInfo: { name: "Hermes Agent", version: "0.16.0" },
        agentCapabilities: {
          loadSession: true,
          sessionCapabilities: { list: {}, resume: {}, fork: {} },
          promptCapabilities: { image: true },
        },
        authMethods: [
          { id: "openrouter", name: "OpenRouter runtime credentials" },
          { id: "hermes-setup", name: "Configure Hermes provider", type: "terminal", args: ["--setup"] },
        ],
      };
      if (method === "authenticate") return {};
      if (method === "session/new") return {
        sessionId: "hermes-session",
        models: {
          currentModelId: "openrouter:z-ai/glm-5.1",
          availableModels: [
            { id: "openrouter:z-ai/glm-5.1", name: "GLM 5.1" },
            { id: "custom:lab:qwen-2.5", name: "Lab Qwen" },
          ],
        },
        modes: {
          currentModeId: "default",
          availableModes: [
            { id: "default", name: "Default" },
            { id: "accept_edits", name: "Accept Edits" },
            { id: "dont_ask", name: "Don't Ask" },
          ],
        },
      };
      if (method === "session/set_model" || method === "session/set_mode") return {};
      throw new Error(`Unexpected Hermes ACP request: ${method}`);
    });
    this.notify = vi.fn();
    this.respond = vi.fn();
    this.respondError = vi.fn();
  }

  dispose(reason, { expected = true } = {}) {
    this.closed = true;
    this.emit("exit", { expected, reason });
  }
}
