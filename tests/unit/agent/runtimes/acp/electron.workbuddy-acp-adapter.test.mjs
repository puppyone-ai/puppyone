import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { WorkBuddyAcpAdapter, workBuddyAuthenticationMethod } from "../../../../../electron/main/agent/runtimes/workbuddy/workbuddy-acp-adapter.mjs";
import { discoverWorkBuddyExecutable, parseWorkBuddyVersion } from "../../../../../electron/main/agent/runtimes/workbuddy/workbuddy-discovery.mjs";
import { workBuddyChannel, workBuddyHistorySource } from "../../../../../electron/main/agent/runtimes/workbuddy/workbuddy-history-source.mjs";

describe("WorkBuddy ACP runtime", () => {
  it("selects the native authentication method without crossing WorkBuddy product channels", () => {
    expect(workBuddyAuthenticationMethod({
      executablePath: "/Applications/WorkBuddy AI.app/Contents/Resources/cli/bin/codebuddy",
      environment: {},
    })).toBe("external");
    expect(workBuddyAuthenticationMethod({
      executablePath: "/Applications/WorkBuddy.app/Contents/Resources/cli/bin/codebuddy",
      environment: {},
    })).toBe("internal");
    expect(workBuddyAuthenticationMethod({
      executablePath: "/tools/codebuddy",
      environment: { CODEBUDDY_INTERNET_ENVIRONMENT: "ioa" },
    })).toBe("iOA");
    expect(workBuddyAuthenticationMethod({
      executablePath: "/tools/codebuddy",
      environment: { CODEBUDDY_INTERNET_ENVIRONMENT: "selfhosted" },
    })).toBe("selfhosted");
    expect(workBuddyChannel({
      executablePath: "C:\\Program Files\\WorkBuddy AI.app\\codebuddy.exe",
      environment: {},
    })).toBe("international-app");

    const international = workBuddyHistorySource({
      executablePath: "/Applications/WorkBuddy AI.app/Contents/Resources/cli/bin/codebuddy",
      environment: { HOME: "/Users/test" },
    });
    const china = workBuddyHistorySource({
      executablePath: "/Applications/WorkBuddy.app/Contents/Resources/cli/bin/codebuddy",
      environment: { HOME: "/Users/test" },
    });
    expect(international).not.toBe(china);
    expect(workBuddyHistorySource({
      executablePath: "/tools/codebuddy",
      environment: { HOME: "/Users/test", CODEBUDDY_CONFIG_DIR: "~/custom-codebuddy" },
    })).not.toBe(workBuddyHistorySource({
      executablePath: "/tools/codebuddy",
      environment: { HOME: "/Users/test" },
    }));
  });

  it("authenticates and creates a session on the same stdio ACP connection", async () => {
    const connection = new FakeWorkBuddyConnection();
    const adapter = new WorkBuddyAcpAdapter({
      readiness: {
        executablePath: "/Applications/WorkBuddy AI.app/Contents/Resources/cli/bin/codebuddy",
        environment: { HOME: "/Users/test", PATH: "/usr/bin" },
        version: "2.115.0",
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

    const result = await adapter.bootstrapSession({ kind: "create" });

    expect(connection.options).toMatchObject({
      executablePath: expect.stringContaining("WorkBuddy AI.app"),
      args: ["--acp"],
      cwd: "/workspace",
      env: {
        DISABLE_AUTOUPDATER: "1",
        DISABLE_ERROR_REPORTING: "1",
        DISABLE_TELEMETRY: "1",
      },
    });
    expect(connection.request.mock.calls.map(([method]) => method)).toEqual([
      "initialize",
      "authenticate",
      "session/new",
    ]);
    expect(connection.request).toHaveBeenCalledWith(
      "authenticate",
      { methodId: "external" },
      expect.any(Object),
    );
    expect(result).toMatchObject({
      inspection: {
        runtime: { id: "workbuddy" },
        capabilities: {
          resume: true,
          referenceInputs: {
            attachments: {
              image: { accepted: true },
              text: { accepted: true },
            },
          },
        },
      },
      providerSession: { providerSessionId: "workbuddy-session" },
    });
    await adapter.dispose();
  });

  it("uses a side-effect-limited version and ACP help probe", async () => {
    const discover = vi.fn(async (options) => {
      expect(options.installationId).toBe("workbuddy");
      expect(options.parseVersion("2.115.0\n")).toBe("2.115.0");
      expect(options.buildEnvironment({ PATH: "/tools" }, {}, { platform: "darwin" })).toMatchObject({
        PATH: "/tools",
        DISABLE_AUTOUPDATER: "1",
        DISABLE_ERROR_REPORTING: "1",
        DISABLE_TELEMETRY: "1",
        PUPPYONE_AGENT_BACKEND: "workbuddy",
      });
      return {
        status: "ready",
        code: "READY",
        version: "2.115.0",
        minimumVersion: null,
        executablePath: "/tools/codebuddy",
        environment: { PATH: "/tools", DISABLE_TELEMETRY: "1" },
        message: "WorkBuddy is ready.",
      };
    });
    const probe = vi.fn(async (_spawn, executablePath, args, options) => {
      expect(executablePath).toBe("/tools/codebuddy");
      expect(args).toEqual(["--help"]);
      expect(options.env.CODEBUDDY_DISABLE_COMPILE_CACHE).toBe("1");
      return { code: 0, stdout: "  --acp  Start in ACP mode\n", stderr: "" };
    });

    await expect(discoverWorkBuddyExecutable({ discover, probe })).resolves.toMatchObject({
      runtimeId: "workbuddy",
      status: "ready",
      code: "READY",
      version: "2.115.0",
      compatibility: "acp-v1",
      selectable: true,
    });
    expect(discover).toHaveBeenCalledOnce();
    expect(probe).toHaveBeenCalledOnce();
    expect(parseWorkBuddyVersion("CodeBuddy Code 2.115.0")).toBe("2.115.0");
  });

  it("does not advertise an installation whose help lacks the ACP entrypoint", async () => {
    const readiness = await discoverWorkBuddyExecutable({
      discover: async () => ({
        status: "ready",
        code: "READY",
        version: "2.1.0",
        minimumVersion: null,
        executablePath: "/tools/codebuddy",
        environment: {},
        message: "ready",
      }),
      probe: async () => ({ code: 0, stdout: "Usage: codebuddy\n", stderr: "" }),
    });
    expect(readiness).toMatchObject({
      status: "protocol-unavailable",
      code: "PROTOCOL_UNAVAILABLE",
      selectable: false,
    });
  });
});

class FakeWorkBuddyConnection extends EventEmitter {
  constructor() {
    super();
    this.closed = false;
    this.request = vi.fn(async (method) => {
      if (method === "initialize") return {
        protocolVersion: 1,
        agentInfo: { name: "CodeBuddy Code", version: "2.115.0" },
        agentCapabilities: {
          loadSession: true,
          promptCapabilities: { image: true, embeddedContext: true },
          mcpCapabilities: { http: true, sse: true },
        },
        authMethods: [
          { id: "external", name: "Login with Google/GitHub" },
          { id: "internal", name: "Login with WeChat" },
        ],
      };
      if (method === "authenticate") return {};
      if (method === "session/new") return { sessionId: "workbuddy-session" };
      throw new Error(`Unexpected WorkBuddy ACP request: ${method}`);
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
