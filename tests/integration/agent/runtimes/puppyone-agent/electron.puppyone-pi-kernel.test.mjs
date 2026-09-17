import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PiRpcClient } from "../../../../../electron/main/agent/protocols/pi-rpc/pi-rpc-client.mjs";
import { PuppyOneAgentAdapter } from "../../../../../electron/main/agent/runtimes/puppyone-agent/puppyone-agent-adapter.mjs";
import { discoverPuppyOneAgentWorker } from "../../../../../electron/main/agent/runtimes/puppyone-agent/puppyone-agent-discovery.mjs";
import {
  buildPuppyOneAgentEnvironment,
  stripPuppyOneProviderCredentials,
} from "../../../../../electron/main/agent/runtimes/puppyone-agent/puppyone-agent-environment.mjs";
import { PUPPYONE_AGENT_APPROVAL_PROTOCOL } from "../../../../../electron/main/agent/runtimes/puppyone-agent/puppyone-agent-kernel.mjs";
import { createPuppyOnePolicyExtension } from "../../../../../electron/main/agent/runtimes/puppyone-agent/worker/policy.mjs";

const temporaryPaths = [];
afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((entry) => fs.promises.rm(entry, { recursive: true, force: true })));
});

describe("Built-in Agent Pi SDK kernel", () => {
  it("discovers only the bundled, exact-version SDK worker", async () => {
    const userDataPath = await fs.promises.mkdtemp(path.join(os.tmpdir(), "puppyone-pi-kernel-"));
    temporaryPaths.push(userDataPath);
    const readiness = await discoverPuppyOneAgentWorker({
      appPath: path.resolve(import.meta.dirname, "../../../../.."),
      userDataPath,
      executablePath: process.execPath,
    });
    expect(readiness).toMatchObject({
      runtimeId: "puppyone-agent",
      source: "bundled",
      status: "ready",
      version: "0.85.1",
      compatibility: "puppyone-pi-rpc-v1",
    });
    expect(readiness.argsPrefix).toEqual([expect.stringMatching(/puppyone-agent\/worker\/main\.mjs$/u)]);
    expect(readiness.profilePath).toBe(path.join(userDataPath, "agent-runtime", "puppyone-agent"));
  });

  it("keeps provider credentials but strips user Pi and PuppyOne launch overrides", () => {
    const environment = buildPuppyOneAgentEnvironment({
      PATH: "/usr/bin",
      HOME: "/Users/test",
      OPENAI_API_KEY: "provider-key",
      INTERNAL_API_KEY: "unrelated-key",
      RELEASE_AUTH_TOKEN: "unrelated-token",
      DATABASE_CREDENTIALS: "unrelated-credentials",
      PI_CODING_AGENT_DIR: "/untrusted/pi",
      PUPPYONE_OPENCODE_BIN: "/untrusted/opencode",
      DEBUG: "secret-debug",
    }, { profilePath: "/managed/puppyone" });
    expect(environment.OPENAI_API_KEY).toBe("provider-key");
    expect(environment.PI_CODING_AGENT_DIR).toBe("/managed/puppyone/pi");
    expect(environment.PI_CODING_AGENT_SESSION_DIR).toBe("/managed/puppyone/sessions");
    expect(environment.PUPPYONE_OPENCODE_BIN).toBeUndefined();
    expect(environment.INTERNAL_API_KEY).toBeUndefined();
    expect(environment.RELEASE_AUTH_TOKEN).toBeUndefined();
    expect(environment.DATABASE_CREDENTIALS).toBeUndefined();
    expect(environment.DEBUG).toBeUndefined();
    expect(environment.ELECTRON_RUN_AS_NODE).toBe("1");
  });

  it("removes provider credentials from model-callable shell subprocesses", () => {
    expect(stripPuppyOneProviderCredentials({
      PATH: "/usr/bin",
      OPENAI_API_KEY: "provider-key",
      AWS_SECRET_ACCESS_KEY: "aws-secret",
      PI_SESSION_ID: "session-1",
    })).toEqual({ PATH: "/usr/bin", PI_SESSION_ID: "session-1" });
  });

  it("starts a real SDK session runtime with the managed tool configuration", async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "puppyone-pi-runtime-"));
    temporaryPaths.push(root);
    const profilePath = path.join(root, "profile");
    const workerPath = path.resolve(import.meta.dirname, "../../../../../electron/main/agent/runtimes/puppyone-agent/worker/main.mjs");
    const client = new PiRpcClient({
      executablePath: process.execPath,
      argsPrefix: [workerPath],
      cwd: root,
      env: buildPuppyOneAgentEnvironment(process.env, { profilePath }),
    });
    try {
      await expect(client.request("get_state")).resolves.toMatchObject({
        sessionId: expect.any(String),
      });
    } finally {
      client.dispose("PuppyOne SDK integration test complete.");
      await client.waitForExit();
    }
  });

  it("blocks paths outside the project and emits an owned approval envelope for mutations", async () => {
    const workspaceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "puppyone-policy-"));
    temporaryPaths.push(workspaceRoot);
    let toolHandler;
    const extension = createPuppyOnePolicyExtension({ workspaceRoot });
    extension.factory({ on: (name, handler) => { if (name === "tool_call") toolHandler = handler; } });
    const confirm = vi.fn(async () => false);
    const context = { ui: { confirm }, signal: undefined };

    await expect(toolHandler({
      type: "tool_call", toolCallId: "read-1", toolName: "read", input: { path: "../outside.txt" },
    }, context)).resolves.toMatchObject({ block: true, terminate: true });
    expect(confirm).not.toHaveBeenCalled();

    await expect(toolHandler({
      type: "tool_call", toolCallId: "write-1", toolName: "write", input: { path: "inside.txt", content: "hello" },
    }, context)).resolves.toMatchObject({ block: true });
    const [title, encoded] = confirm.mock.calls[0];
    expect(title).toBe(PUPPYONE_AGENT_APPROVAL_PROTOCOL);
    expect(JSON.parse(encoded)).toMatchObject({
      schema: PUPPYONE_AGENT_APPROVAL_PROTOCOL,
      toolCallId: "write-1",
      toolName: "write",
      kind: "file-change",
    });
  });

  it("maps only the private worker confirm into a correlated shared approval", async () => {
    const clients = [];
    const events = [];
    const readiness = {
      executablePath: "/application/puppyone",
      argsPrefix: ["/application/worker.mjs"],
      profilePath: "/profile/puppyone-agent",
      environment: {},
      source: "bundled",
      version: "0.85.1",
      compatibility: "puppyone-pi-rpc-v1",
    };
    const adapter = new PuppyOneAgentAdapter({
      readiness,
      workspaceRoot: "/workspace",
      onEvent: (event) => events.push(event),
      projectInstructionLoader: async () => null,
      clientFactory: (options) => {
        const client = new FakePiClient(options);
        clients.push(client);
        return client;
      },
    });
    await adapter.createSession();
    const { turnId } = await adapter.startTurn({ prompt: "Change it" });
    clients[0].emit("event", {
      type: "extension_ui_request",
      id: "approval-rpc-1",
      method: "confirm",
      title: PUPPYONE_AGENT_APPROVAL_PROTOCOL,
      message: JSON.stringify({
        schema: PUPPYONE_AGENT_APPROVAL_PROTOCOL,
        toolCallId: "tool-1",
        toolName: "bash",
        kind: "command",
        title: "Run command",
        command: "npm test",
        arguments: { command: "npm test" },
        scopeKey: "bash:test",
      }),
    });
    const approval = events.find((event) => event.type === "approval.requested");
    expect(approval).toMatchObject({
      turnId,
      itemId: "tool-1",
      payload: { kind: "command", command: "npm test" },
    });
    adapter.resolveApproval({ requestId: approval.payload.requestId, decision: "acceptForSession", turnId });
    expect(clients[0].responses).toContainEqual({
      type: "extension_ui_response",
      id: "approval-rpc-1",
      confirmed: true,
    });
    expect(() => adapter.resolveApproval({ requestId: approval.payload.requestId, decision: "accept", turnId })).toThrow(/correlation/u);
    await adapter.dispose();
  });
});

class FakePiClient extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
    this.closed = false;
    this.responses = [];
  }

  async request(type) {
    if (type === "get_state") return { sessionId: "native-session-1", sessionName: "PuppyOne session", model: null, thinkingLevel: "off" };
    if (type === "prompt") return {};
    if (type === "get_available_models") return { models: [] };
    if (type === "get_commands") return { commands: [] };
    if (type === "get_available_thinking_levels") return { levels: [] };
    throw new Error(`Unexpected Pi RPC request: ${type}`);
  }

  respondExtensionUi(message) { this.responses.push(message); }
  dispose() { this.closed = true; }
  async waitForExit() {}
}
