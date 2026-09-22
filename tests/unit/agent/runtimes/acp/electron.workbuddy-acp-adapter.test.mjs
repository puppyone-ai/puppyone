import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { WorkBuddyAcpAdapter } from "../../../../../electron/main/agent/runtimes/workbuddy/workbuddy-acp-adapter.mjs";
import {
  WORKBUDDY_CHINA_CHANNEL,
  WORKBUDDY_INTERNATIONAL_CHANNEL,
} from "../../../../../electron/main/agent/runtimes/workbuddy/workbuddy-channels.mjs";
import { discoverWorkBuddyExecutable, parseWorkBuddyVersion } from "../../../../../electron/main/agent/runtimes/workbuddy/workbuddy-discovery.mjs";
import {
  legacyWorkBuddyRuntimeIdForSourceScope,
  workBuddyHistorySource,
} from "../../../../../electron/main/agent/runtimes/workbuddy/workbuddy-history-source.mjs";
import {
  WORKBUDDY_CHINA_RUNTIME_DESCRIPTOR,
  WORKBUDDY_INTERNATIONAL_RUNTIME_DESCRIPTOR,
} from "../../../../../electron/main/agent/runtimes/workbuddy/workbuddy-identity.mjs";
import { workBuddyConfigDirectory } from "../../../../../electron/main/agent/runtimes/workbuddy/workbuddy-config-directory.mjs";

describe("WorkBuddy ACP runtime", () => {
  it("keeps China and International native history identities separate and migratable", () => {
    const international = workBuddyHistorySource({
      channel: WORKBUDDY_INTERNATIONAL_CHANNEL,
      environment: { HOME: "/Users/test" },
    });
    const china = workBuddyHistorySource({
      channel: WORKBUDDY_CHINA_CHANNEL,
      environment: { HOME: "/Users/test" },
    });
    expect(international).not.toBe(china);
    expect(workBuddyHistorySource({
      channel: WORKBUDDY_CHINA_CHANNEL,
      environment: { HOME: "/Users/test", WORKBUDDY_CHINA_CONFIG_DIR: "~/custom-codebuddy" },
    })).not.toBe(workBuddyHistorySource({
      channel: WORKBUDDY_CHINA_CHANNEL,
      environment: { HOME: "/Users/test" },
    }));
    const currentEnvironment = { HOME: "/Users/test" };
    expect(legacyWorkBuddyRuntimeIdForSourceScope(china, currentEnvironment)).toBe("workbuddy-china");
    expect(legacyWorkBuddyRuntimeIdForSourceScope(international, currentEnvironment)).toBe("workbuddy-international");
  });

  it("resolves separate default profiles and honors channel-specific overrides", () => {
    expect(workBuddyConfigDirectory({
      channel: WORKBUDDY_CHINA_CHANNEL,
      environment: { HOME: "/Users/test" },
    })).toBe("/Users/test/.workbuddy");
    expect(workBuddyConfigDirectory({
      channel: WORKBUDDY_INTERNATIONAL_CHANNEL,
      environment: { HOME: "/Users/test" },
    })).toBe("/Users/test/.workbuddy-ai");
    expect(workBuddyConfigDirectory({
      channel: WORKBUDDY_INTERNATIONAL_CHANNEL,
      environment: {
        HOME: "/Users/test",
        WORKBUDDY_CONFIG_DIR: "/profiles/shared",
        WORKBUDDY_INTERNATIONAL_CONFIG_DIR: "~/profiles/international",
      },
    })).toBe("/Users/test/profiles/international");
  });

  it.each([
    [WORKBUDDY_CHINA_CHANNEL, WORKBUDDY_CHINA_RUNTIME_DESCRIPTOR, "WorkBuddy.app", "internal", "internal"],
    [WORKBUDDY_INTERNATIONAL_CHANNEL, WORKBUDDY_INTERNATIONAL_RUNTIME_DESCRIPTOR, "WorkBuddy AI.app", "external", "public"],
  ])("authenticates %s and creates a session on its own ACP connection", async (
    channel,
    runtimeDescriptor,
    appName,
    authenticationMethodId,
    route,
  ) => {
    const connection = new FakeWorkBuddyConnection();
    const adapter = new WorkBuddyAcpAdapter({
      channel,
      runtimeDescriptor,
      readiness: {
        executablePath: `/Applications/${appName}/Contents/Resources/cli/bin/codebuddy`,
        environment: {
          HOME: "/Users/test",
          PATH: "/usr/bin",
          [channel.configDirectoryEnvironmentVariable]: `/profiles/${channel.id}`,
        },
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
      executablePath: expect.stringContaining(appName),
      args: ["--acp"],
      cwd: "/workspace",
      env: {
        WORKBUDDY_CONFIG_DIR: `/profiles/${channel.id}`,
        CODEBUDDY_CONFIG_DIR: `/profiles/${channel.id}`,
        CODEBUDDY_INTERNET_ENVIRONMENT: route,
        DISABLE_AUTOUPDATER: "1",
        DISABLE_ERROR_REPORTING: "1",
        DISABLE_TELEMETRY: "1",
      },
    });
    expect(connection.request.mock.calls.map(([method]) => method)).toEqual([
      "initialize",
      "_codebuddy.ai/getUserInfo",
      "authenticate",
      "session/new",
    ]);
    expect(connection.request).toHaveBeenCalledWith(
      "authenticate",
      { methodId: authenticationMethodId },
      expect.any(Object),
    );
    expect(result).toMatchObject({
      inspection: {
        runtime: { id: channel.id },
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

  it("reuses an existing native login without forcing browser authentication", async () => {
    const connection = new FakeWorkBuddyConnection({ authenticated: true });
    const adapter = new WorkBuddyAcpAdapter({
      channel: WORKBUDDY_CHINA_CHANNEL,
      runtimeDescriptor: WORKBUDDY_CHINA_RUNTIME_DESCRIPTOR,
      readiness: {
        executablePath: "/Applications/WorkBuddy.app/Contents/Resources/cli/bin/codebuddy",
        environment: { HOME: "/Users/test", PATH: "/usr/bin" },
        version: "2.115.0",
      },
      workspaceRoot: "/workspace",
      connectionFactory: (options) => {
        connection.options = options;
        return connection;
      },
      fileSystemFactory: () => ({ readTextFile: vi.fn(), writeTextFile: vi.fn() }),
      projectInstructionLoader: vi.fn(async () => ({ source: null, text: "", bytes: 0 })),
    });

    await adapter.bootstrapSession({ kind: "create" });

    expect(connection.options.env).toMatchObject({
      WORKBUDDY_CONFIG_DIR: "/Users/test/.workbuddy",
      CODEBUDDY_CONFIG_DIR: "/Users/test/.workbuddy",
    });
    expect(connection.request.mock.calls.map(([method]) => method)).toEqual([
      "initialize",
      "_codebuddy.ai/getUserInfo",
      "session/new",
    ]);
    expect(connection.request).not.toHaveBeenCalledWith(
      "authenticate",
      expect.anything(),
      expect.anything(),
    );
    await adapter.dispose();
  });

  it("uses a side-effect-limited version and ACP help probe", async () => {
    const discover = vi.fn(async (options) => {
      expect(options.installationId).toBe("workbuddy-international");
      expect(options.parseVersion("2.115.0\n")).toBe("2.115.0");
      expect(options.buildEnvironment({ PATH: "/tools" }, {}, { platform: "darwin" })).toMatchObject({
        PATH: "/tools",
        DISABLE_AUTOUPDATER: "1",
        DISABLE_ERROR_REPORTING: "1",
        DISABLE_TELEMETRY: "1",
        CODEBUDDY_INTERNET_ENVIRONMENT: "public",
        WORKBUDDY_CONFIG_DIR: expect.stringContaining(".workbuddy-ai"),
        CODEBUDDY_CONFIG_DIR: expect.stringContaining(".workbuddy-ai"),
        PUPPYONE_AGENT_BACKEND: "workbuddy-international",
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

    await expect(discoverWorkBuddyExecutable({
      channel: WORKBUDDY_INTERNATIONAL_CHANNEL,
      discover,
      probe,
    })).resolves.toMatchObject({
      runtimeId: "workbuddy-international",
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
      channel: WORKBUDDY_CHINA_CHANNEL,
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
  constructor({ authenticated = false } = {}) {
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
      if (method === "_codebuddy.ai/getUserInfo") {
        return authenticated ? { userInfo: { userId: "workbuddy-user", userName: "WorkBuddy User" } } : {};
      }
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
