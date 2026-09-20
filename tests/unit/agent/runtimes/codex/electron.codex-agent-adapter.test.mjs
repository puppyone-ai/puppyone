import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CODEX_CAPABILITIES,
  CodexAppServerAdapter,
  buildCodexTurnInput,
  normalizeCodexNotification,
} from "../../../../../electron/main/agent/runtimes/codex/codex-app-server-adapter.mjs";
import { AgentProviderSessionUnavailableError } from "../../../../../electron/main/agent/runtime/agent-runtime-port.mjs";
import { JsonlRpcRequestTimeoutError } from "../../../../../electron/main/agent/transports/jsonl-rpc-connection.mjs";

describe("Codex app-server normalization", () => {
  it("discovers workspace threads from the native state index without scanning rollout transcripts", async () => {
    const connection = new FakeConnection();
    connection.results.set("thread/list", {
      data: [{
        id: "thread-native",
        cwd: "/workspace",
        name: "Fix history",
        preview: "Fix history",
        createdAt: 1_788_000_000,
        updatedAt: 1_788_000_100,
        modelProvider: "openai",
        ephemeral: false,
      }],
      nextCursor: "next-page",
    });
    const adapter = new CodexAppServerAdapter({
      executablePath: "/usr/local/bin/codex",
      environment: {},
      workspaceRoot: "/workspace",
      appVersion: "test",
      connectionFactory: () => connection,
    });

    await expect(adapter.discoverSessions({ cursor: "page-1", limit: 25 })).resolves.toEqual({
      supported: true,
      coverage: { scopeComplete: false, snapshotId: null },
      sessions: [expect.objectContaining({ providerSessionId: "thread-native", title: "Fix history" })],
      nextCursor: "next-page",
    });
    expect(connection.requests).toContainEqual({
      method: "thread/list",
      params: expect.objectContaining({
        cwd: "/workspace",
        cursor: "page-1",
        limit: 25,
        sortKey: "updated_at",
        sortDirection: "desc",
        useStateDbOnly: true,
      }),
    });
    adapter.dispose();
  });

  it("renders ordinary workspace references as text and sends only native images as media input", () => {
    const input = buildCodexTurnInput("Inspect", [
      { id: "workspace-a", kind: "workspace-entry", entryType: "file", path: "/workspace/a.md", displayName: "a.md" },
      { id: "workspace-image", kind: "workspace-entry", entryType: "file", path: "/workspace/diagram.png", displayName: "diagram.png", mime: "image/png" },
      { id: "image-b", kind: "staged-attachment", path: "/private/staging/b.snapshot", displayName: "b.png", mime: "image/png" },
      { id: "workspace-pdf", kind: "workspace-entry", entryType: "file", path: "/workspace/report.pdf", displayName: "report.pdf", mime: "application/pdf" },
      { id: "workspace-a-duplicate", kind: "workspace-entry", entryType: "file", path: "/workspace/a.md", displayName: "a.md" },
    ], "/workspace");
    expect(input).toEqual([
      {
        type: "text",
        text: [
          "Inspect",
          "",
          "Authorized context files for this turn:",
          "- /workspace/a.md",
          "- /workspace/report.pdf",
        ].join("\n"),
        text_elements: [],
      },
      { type: "localImage", path: "/workspace/diagram.png" },
      { type: "localImage", path: "/private/staging/b.snapshot" },
    ]);
    expect(JSON.stringify(input)).not.toContain('"type":"mention"');
    expect(buildCodexTurnInput("Review `/private/staging/report.pdf`", [{
      authorized: true,
      kind: "staged-attachment",
      path: "/private/staging/report.pdf",
      displayName: "report.pdf",
      mime: "application/pdf",
      inlineMentioned: true,
      mentionDelivery: "path",
    }], "/workspace")).toEqual([{
      type: "text",
      text: "Review `/private/staging/report.pdf`",
      text_elements: [],
    }]);
    expect(buildCodexTurnInput("Review `/workspace/a.md`", [{
      authorized: true,
      kind: "workspace-entry",
      entryType: "file",
      path: "/workspace/a.md",
      displayName: "a.md",
      mime: "text/markdown",
      inlineMentioned: true,
      mentionDelivery: "path",
    }], "/workspace")).toEqual([{
      type: "text",
      text: "Review `/workspace/a.md`",
      text_elements: [],
    }]);
    expect(() => buildCodexTurnInput("Inspect", [{
      kind: "staged-attachment",
      path: "/private/staging/report.pdf",
      mime: "application/pdf",
    }], "/workspace")).toThrow(/does not support/i);
    expect(() => buildCodexTurnInput("Inspect", [{
      kind: "workspace-entry",
      path: "/workspace/a.md",
    }])).toThrow(/workspace root/i);
    expect(() => buildCodexTurnInput("Inspect", [{
      kind: "workspace-entry",
      path: "/outside/a.md",
      mime: "image/png",
    }], "/workspace")).toThrow(/outside.*workspace root/i);
    expect(() => buildCodexTurnInput("Inspect", [{ kind: "workspace-entry" }]))
      .toThrow(/invalid reference/i);
  });

  it("delivers the minimal reference contract in the native turn/start request", async () => {
    const connection = new FakeConnection();
    connection.results.set("thread/start", {
      thread: { id: "thread-1", preview: "Session", createdAt: 1, updatedAt: 1 },
    });
    connection.results.set("turn/start", { turn: { id: "turn-1" } });
    const adapter = new CodexAppServerAdapter({
      executablePath: "/usr/local/bin/codex",
      environment: {},
      workspaceRoot: "/workspace",
      appVersion: "test",
      connectionFactory: () => connection,
    });

    await adapter.createSession();
    await adapter.startTurn({
      prompt: "Review these",
      references: [
        { kind: "workspace-entry", entryType: "file", path: "/workspace/notes.md", mime: "text/markdown" },
        { kind: "workspace-entry", entryType: "directory", path: "/workspace/src" },
        { kind: "staged-attachment", path: "/private/staging/screenshot.webp", mime: "image/webp" },
      ],
    });

    expect(connection.requests.find((request) => request.method === "turn/start")?.params.input).toEqual([
      {
        type: "text",
        text: [
          "Review these",
          "",
          "Authorized context files for this turn:",
          "- /workspace/notes.md",
          "- /workspace/src",
        ].join("\n"),
        text_elements: [],
      },
      { type: "localImage", path: "/private/staging/screenshot.webp" },
    ]);
    adapter.dispose();
  });

  it("keeps the tested Codex 0.144.1 generated-schema fixture compatible", () => {
    const fixture = JSON.parse(readFileSync(new URL(
      "../../../../fixtures/agent/runtimes/codex/v0.144.1-notifications.json",
      import.meta.url,
    ), "utf8"));
    expect(fixture.codexVersion).toBe("0.144.1");
    for (const notification of fixture.notifications) {
      expect(normalizeCodexNotification(notification).map((event) => event.type)).toContain(notification.expectedType);
    }
  });

  it("maps current generated-schema notifications to provider-neutral events", () => {
    expect(normalizeCodexNotification({
      method: "thread/started",
      params: { thread: { id: "thread-1", preview: "Fix tests", createdAt: 1, updatedAt: 2 } },
    })[0]).toMatchObject({ type: "session.started", providerSessionId: "thread-1", payload: { title: "Fix tests" } });

    expect(normalizeCodexNotification({
      method: "item/agentMessage/delta",
      params: { threadId: "thread-1", turnId: "turn-1", itemId: "item-1", delta: "hello" },
    })).toEqual([expect.objectContaining({
      type: "assistant.delta",
      providerSessionId: "thread-1",
      turnId: "turn-1",
      itemId: "item-1",
      payload: { delta: "hello" },
    })]);

    expect(normalizeCodexNotification({
      method: "item/completed",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        item: { id: "user-1", type: "userMessage", content: [{ type: "text", text: "follow up" }] },
      },
    })).toEqual([expect.objectContaining({
      type: "user.message",
      providerSessionId: "thread-1",
      turnId: "turn-1",
      itemId: "user-1",
      payload: { text: "follow up" },
    })]);

    expect(normalizeCodexNotification({
      method: "item/reasoning/summaryPartAdded",
      params: { threadId: "thread-1", turnId: "turn-1", itemId: "reasoning-1", summaryIndex: 1 },
    })).toEqual([expect.objectContaining({
      type: "reasoning.summary.delta",
      payload: { delta: "", summaryIndex: 1, boundary: true },
    })]);

    expect(normalizeCodexNotification({
      method: "turn/completed",
      params: { threadId: "thread-1", turn: { id: "turn-1", status: "interrupted" } },
    })[0]).toMatchObject({ type: "turn.interrupted", payload: { status: "interrupted" } });

    expect(normalizeCodexNotification({
      method: "thread/status/changed",
      params: { threadId: "thread-1", status: { type: "systemError" } },
    })).toEqual([]);

    expect(normalizeCodexNotification({
      method: "turn/completed",
      params: { threadId: "thread-1", turn: { id: "turn-1", status: "failed", error: { message: "Actionable failure" } } },
    })).toEqual([
      expect.objectContaining({ type: "turn.failed", payload: expect.objectContaining({ message: "Actionable failure" }) }),
      expect.objectContaining({ type: "provider.error", payload: { message: "Actionable failure", recoverable: true } }),
    ]);

    expect(normalizeCodexNotification({
      method: "item/fileChange/patchUpdated",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "file-1",
        changes: [{ path: "src/App.tsx", kind: "update", diff: "+one\n-two\n" }],
      },
    })[0]).toMatchObject({
      type: "file.change.updated",
      payload: { changes: [{ path: "src/App.tsx", kind: "update", additions: 1, deletions: 1 }] },
    });

    expect(normalizeCodexNotification({
      method: "item/started",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        item: { id: "command-1", type: "commandExecution", command: "rg -n needle src", cwd: "/workspace", status: "inProgress" },
      },
    })[0]).toMatchObject({
      type: "tool.started",
      payload: { kind: "command", tool: "bash", input: { command: "rg -n needle src", cwd: "/workspace" } },
    });

    expect(normalizeCodexNotification({
      method: "item/started",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        item: { id: "change-1", type: "fileChange", changes: [{ path: "src/App.tsx", kind: "update", diff: "+one\n-two" }], status: "inProgress" },
      },
    })[0]).toMatchObject({
      type: "tool.started",
      payload: { kind: "file-change", tool: "edit", path: "src/App.tsx" },
    });

    expect(normalizeCodexNotification({
      method: "configWarning",
      params: { summary: "Invalid config", details: "Unknown key", path: "/workspace/.codex/config.toml" },
    })[0]).toMatchObject({
      type: "provider.warning",
      payload: { message: "Invalid config Unknown key (/workspace/.codex/config.toml)" },
    });

    expect(normalizeCodexNotification({
      method: "error",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        error: { message: "Reconnecting… 2/5" },
        willRetry: true,
        attempt: 2,
        maxAttempts: 5,
      },
    })[0]).toMatchObject({
      type: "provider.connection.updated",
      payload: { state: "reconnecting", message: "Reconnecting… 2/5", attempt: 2, maxAttempts: 5 },
    });

    expect(normalizeCodexNotification({
      method: "warning",
      params: { threadId: "thread-1", turnId: "turn-1", message: "Falling back to HTTPS transport." },
    })[0]).toMatchObject({
      type: "provider.connection.updated",
      payload: { state: "fallback", message: "Falling back to HTTPS transport." },
    });

    expect(normalizeCodexNotification({
      method: "deprecationNotice",
      params: { message: "Full-history hydration is deprecated for paginated threads." },
    })).toEqual([]);

    expect(normalizeCodexNotification({
      method: "error",
      params: {
        error: {
          message: JSON.stringify({
            type: "error",
            error: { message: "Invalid value: 'max'. Use 'xhigh'.", param: "reasoning.effort" },
            status: 400,
          }),
        },
        willRetry: false,
      },
    })[0]).toMatchObject({
      type: "provider.error",
      payload: { message: "Invalid value: 'max'. Use 'xhigh'." },
    });
  });

  it("normalizes legacy reasoning effort and reuses one thread across follow-up turns", async () => {
    const connection = new FakeConnection();
    connection.results.set("account/read", { account: { type: "chatgpt" }, requiresOpenaiAuth: false });
    connection.results.set("model/list", {
      data: [{
        id: "gpt-5.5",
        model: "gpt-5.5",
        displayName: "GPT-5.5",
        defaultReasoningEffort: "max",
        supportedReasoningEfforts: ["low", "max", "unsupported", "xhigh"].map((reasoningEffort) => ({
          reasoningEffort,
          description: reasoningEffort,
        })),
      }],
    });
    connection.results.set("thread/start", { thread: { id: "thread-1", preview: "Session", createdAt: 1, updatedAt: 1 } });
    connection.results.set("turn/start", { turn: { id: "turn-1" } });
    const adapter = new CodexAppServerAdapter({
      executablePath: "/usr/local/bin/codex",
      environment: {},
      workspaceRoot: "/workspace",
      appVersion: "test",
      connectionFactory: () => connection,
    });

    const inspection = await adapter.inspect();
    expect(inspection.runtime).toMatchObject({
      id: "codex",
      displayName: "Codex",
      iconKey: "chatgpt",
    });
    expect(inspection.models[0]).toMatchObject({
      model: "gpt-5.5",
      variants: ["low", "xhigh"],
      defaultVariant: "xhigh",
    });
    await adapter.createSession({ model: "gpt-5.5" });
    await adapter.startTurn({ prompt: "hello", model: "gpt-5.5", effort: "low" });
    await adapter.startTurn({ prompt: "follow up", model: "gpt-5.5", effort: "xhigh" });
    expect(connection.requests.filter((request) => request.method === "turn/start")).toMatchObject([
      { params: { threadId: "thread-1", model: "gpt-5.5", effort: "low" } },
      { params: { threadId: "thread-1", model: "gpt-5.5", effort: "xhigh" } },
    ]);
    expect(connection.requests.filter((request) => request.method === "initialize")).toHaveLength(1);
    expect(connection.requests.filter((request) => request.method === "thread/start")).toHaveLength(1);
    expect(connection.requests.filter((request) => request.method === "thread/resume")).toHaveLength(0);
    expect(connection.requests.filter((request) => request.method === "turn/start")).toHaveLength(2);
    expect(JSON.stringify(connection.requests)).not.toContain('"effort":"max"');
    adapter.dispose();
  });

  it("preserves native user identity when turn delivery is ambiguous", async () => {
    const connection = new FakeConnection();
    connection.results.set("thread/start", { thread: { id: "thread-1" } });
    connection.failures.set("turn/start", new JsonlRpcRequestTimeoutError("turn/start"));
    const adapter = new CodexAppServerAdapter({
      executablePath: "/usr/local/bin/codex",
      environment: {},
      workspaceRoot: "/workspace",
      appVersion: "test",
      connectionFactory: () => connection,
    });
    await adapter.createSession({ model: "gpt-5" });

    const failure = await adapter.startTurn({ prompt: "hello", model: "gpt-5" }).catch((error) => error);
    expect(failure).toMatchObject({
      code: "JSONL_RPC_TIMEOUT",
      deliveryOutcome: "unknown",
      clientUserMessageId: expect.stringMatching(/^[A-Fa-f0-9-]{36}$/),
    });
    adapter.dispose();
  });

  it("classifies a missing native rollout as an unavailable saved session", async () => {
    const connection = new FakeConnection();
    connection.failures.set("thread/resume", new Error("thread/resume: no rollout found for thread id thread-stale"));
    const adapter = new CodexAppServerAdapter({
      executablePath: "/usr/local/bin/codex",
      environment: {},
      workspaceRoot: "/workspace",
      appVersion: "test",
      connectionFactory: () => connection,
    });

    await expect(adapter.resumeSession({ threadId: "thread-stale", model: "gpt-5" }))
      .rejects.toBeInstanceOf(AgentProviderSessionUnavailableError);
    adapter.dispose();
  });

  it("resumes metadata-only and restores paginated turns and items in transcript order", async () => {
    const connection = new FakeConnection();
    connection.results.set("thread/resume", {
      thread: { id: "thread-history", preview: "Saved session", createdAt: 1, updatedAt: 4 },
    });
    connection.results.set("thread/turns/list", (params) => params.cursor === null
      ? {
          data: [{
            id: "turn-new",
            items: [],
            itemsView: "summary",
            status: "completed",
          }],
          nextCursor: "older-turns",
        }
      : {
          data: [{
            id: "turn-old",
            itemsView: "full",
            status: "completed",
            items: [
              { id: "old-user", type: "userMessage", content: [{ type: "text", text: "old prompt" }] },
              { id: "old-answer", type: "agentMessage", text: "old answer" },
            ],
          }],
          nextCursor: null,
        });
    connection.results.set("thread/items/list", (params) => params.cursor === null
      ? {
          data: [{ turnId: "turn-new", item: { id: "new-answer", type: "agentMessage", text: "new answer" } }],
          nextCursor: "older-items",
        }
      : {
          data: [{
            turnId: "turn-new",
            item: { id: "new-user", type: "userMessage", content: [{ type: "text", text: "new prompt" }] },
          }],
          nextCursor: null,
        });
    const adapter = new CodexAppServerAdapter({
      executablePath: "/usr/local/bin/codex",
      environment: {},
      workspaceRoot: "/workspace",
      appVersion: "test",
      connectionFactory: () => connection,
    });

    await adapter.resumeSession({ threadId: "thread-history", model: "gpt-5" });
    const events = await adapter.readHistory();

    expect(connection.requests).toContainEqual({
      method: "thread/resume",
      params: expect.objectContaining({ threadId: "thread-history", excludeTurns: true }),
    });
    expect(connection.requests.filter((request) => request.method === "thread/turns/list"))
      .toHaveLength(2);
    expect(connection.requests.filter((request) => request.method === "thread/items/list"))
      .toHaveLength(2);
    expect(connection.requests.some((request) => request.method === "thread/read")).toBe(false);
    expect(events.filter((event) => event.type === "turn.started").map((event) => event.payload.prompt))
      .toEqual(["old prompt", "new prompt"]);
    expect(events.filter((event) => event.type === "user.message").map((event) => [event.itemId, event.payload.text]))
      .toEqual([["old-user", "old prompt"], ["new-user", "new prompt"]]);
    expect(events.filter((event) => event.type === "provider.warning")).toHaveLength(0);
    expect(events.filter((event) => event.type === "assistant.completed").map((event) => event.payload.text))
      .toEqual(["old answer", "new answer"]);
    adapter.dispose();
  });

  it("offers only explicit durable decisions and maps native structured questions", async () => {
    const connection = new FakeConnection();
    const events = [];
    const adapter = new CodexAppServerAdapter({
      executablePath: "/usr/local/bin/codex",
      environment: {},
      workspaceRoot: "/workspace",
      appVersion: "test",
      connectionFactory: () => connection,
      onEvent: (event) => events.push(event),
    });
    await adapter.connect();
    adapter.threadId = "thread-1";
    connection.emit("request", {
      method: "item/commandExecution/requestApproval",
      id: 7,
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "item-1",
        command: "npm test",
        startedAtMs: Date.now(),
      },
    });
    const approval = events.find((event) => event.type === "approval.requested");
    expect(approval.payload.availableDecisions).toEqual(["accept", "decline", "cancel"]);
    expect(approval.payload.availableDecisions).not.toContain("acceptForSession");
    adapter.resolveApproval({
      requestId: "codex:7",
      decision: "accept",
      threadId: "thread-1",
      turnId: "turn-1",
    });
    expect(connection.responses.at(-1)).toEqual({ id: 7, result: { decision: "accept" } });

    connection.emit("request", {
      method: "item/commandExecution/requestApproval",
      id: 8,
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "item-network",
        networkApprovalContext: { host: "registry.npmjs.org:443", protocol: "https" },
        reason: "Download package metadata",
        startedAtMs: Date.now(),
      },
    });
    expect(events.at(-1)).toMatchObject({
      type: "approval.requested",
      payload: {
        title: "Allow network access",
        networkApprovalContext: { host: "registry.npmjs.org:443", protocol: "https" },
      },
    });
    connection.emit("notification", {
      method: "serverRequest/resolved",
      params: { threadId: "thread-1", requestId: 8 },
    });
    expect(events.at(-1)).toMatchObject({
      type: "approval.resolved",
      payload: { requestId: "codex:8", decision: "cancel", reason: "provider-resolved" },
    });
    expect(() => adapter.resolveApproval({
      requestId: "codex:8",
      decision: "accept",
      threadId: "thread-1",
      turnId: "turn-1",
    })).toThrow(/no longer pending/i);

    connection.emit("request", {
      method: "item/fileChange/requestApproval",
      id: 9,
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "item-file",
        grantRoot: "/workspace/generated",
        startedAtMs: Date.now(),
      },
    });
    expect(events.at(-1)).toMatchObject({
      type: "approval.requested",
      payload: { grantRoot: "/workspace/generated" },
    });
    adapter.resolveApproval({
      requestId: "codex:9",
      decision: "decline",
      threadId: "thread-1",
      turnId: "turn-1",
    });

    connection.emit("request", {
      method: "item/tool/requestUserInput",
      id: 10,
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "item-2",
        questions: [{ id: "scope", header: "Scope", question: "Which scope?", options: [{ label: "Focused" }] }],
      },
    });
    const question = events.at(-1);
    expect(question).toMatchObject({
      type: "question.requested",
      payload: { questions: [{ header: "Scope", question: "Which scope?" }] },
    });
    adapter.resolveQuestion({
      requestId: question.payload.requestId,
      answers: [["Focused"]],
      rejected: false,
      turnId: "turn-1",
    });
    expect(connection.responses.at(-1)).toEqual({
      id: 10,
      result: { answers: { scope: { answers: ["Focused"] } } },
    });
    adapter.dispose();
  });

  it("implements the advertised current app-server fork, steer and compaction operations", async () => {
    const connection = new FakeConnection();
    connection.results.set("turn/steer", {});
    connection.results.set("thread/fork", { thread: { id: "thread-fork" } });
    connection.results.set("thread/compact/start", {});
    const adapter = new CodexAppServerAdapter({
      executablePath: "/usr/local/bin/codex",
      environment: {},
      workspaceRoot: "/workspace",
      appVersion: "test",
      connectionFactory: () => connection,
    });
    await adapter.connect();
    adapter.threadId = "thread-1";
    adapter.activeTurnId = "turn-1";
    await adapter.steerTurn({ turnId: "turn-1", message: "Focus on tests", references: [] });
    adapter.activeTurnId = null;
    await expect(adapter.forkSession({ messageId: "message-1" })).resolves.toEqual({ providerSessionId: "thread-fork" });
    await adapter.compactSession();
    expect(connection.requests).toEqual(expect.arrayContaining([
      expect.objectContaining({ method: "turn/steer", params: expect.objectContaining({ threadId: "thread-1", expectedTurnId: "turn-1" }) }),
      expect.objectContaining({ method: "thread/fork", params: { threadId: "thread-1", messageId: "message-1", excludeTurns: true } }),
      expect.objectContaining({ method: "thread/compact/start", params: { threadId: "thread-1" } }),
    ]));
    expect(CODEX_CAPABILITIES).toMatchObject({
      structuredQuestions: true,
      fork: true,
      steer: true,
      compaction: true,
      protocol: { name: "codex-app-server" },
    });
    adapter.dispose();
  });

  it("keeps the current turn steerable after an older terminal notification arrives late", async () => {
    const connection = new FakeConnection();
    connection.results.set("turn/steer", {});
    const adapter = new CodexAppServerAdapter({
      executablePath: "/usr/local/bin/codex",
      environment: {},
      workspaceRoot: "/workspace",
      appVersion: "test",
      connectionFactory: () => connection,
    });
    await adapter.connect();
    adapter.threadId = "thread-1";
    for (const [method, id, status] of [
      ["turn/started", "A", "inProgress"],
      ["turn/completed", "A", "interrupted"],
      ["turn/started", "B", "inProgress"],
      ["turn/completed", "A", "completed"],
    ]) {
      connection.emit("notification", { method, params: { threadId: "thread-1", turn: { id, status } } });
    }

    await expect(adapter.steerTurn({ turnId: "B", message: "continue", references: [] })).resolves.toBeUndefined();
    expect(connection.requests.findLast((entry) => entry.method === "turn/steer")).toMatchObject({
      method: "turn/steer",
      params: { expectedTurnId: "B" },
    });
    adapter.dispose();
  });

  it("cancels pending approvals only after Codex accepts an interrupt", async () => {
    const connection = new FakeConnection();
    connection.results.set("turn/interrupt", {});
    const adapter = new CodexAppServerAdapter({
      executablePath: "/usr/local/bin/codex",
      environment: {},
      workspaceRoot: "/workspace",
      appVersion: "test",
      connectionFactory: () => connection,
    });
    await adapter.connect();
    adapter.threadId = "thread-1";
    connection.emit("request", {
      method: "item/fileChange/requestApproval",
      id: 9,
      params: { threadId: "thread-1", turnId: "turn-1", itemId: "item-1", startedAtMs: Date.now() },
    });
    await adapter.interruptTurn({ turnId: "turn-1" });
    expect(connection.responses).toContainEqual({ id: 9, result: { decision: "cancel" } });

    connection.emit("request", {
      method: "item/fileChange/requestApproval",
      id: 10,
      params: { threadId: "thread-1", turnId: "turn-2", itemId: "item-2", startedAtMs: Date.now() },
    });
    connection.failures.set("turn/interrupt", new Error("interrupt transport failed"));
    await expect(adapter.interruptTurn({ turnId: "turn-2" })).rejects.toThrow(/transport failed/i);
    expect(() => adapter.resolveApproval({
      requestId: "codex:10",
      decision: "decline",
      threadId: "thread-1",
      turnId: "turn-2",
    })).not.toThrow();
    expect(connection.responses).toContainEqual({ id: 10, result: { decision: "decline" } });
    adapter.dispose();
  });

  it("distinguishes an account-read failure from an unauthenticated account", async () => {
    const connection = new FakeConnection();
    connection.failures.set("account/read", new Error("account service unavailable"));
    connection.results.set("model/list", { data: [{ id: "gpt-5", model: "gpt-5" }] });
    const adapter = new CodexAppServerAdapter({
      executablePath: "/usr/local/bin/codex",
      environment: {},
      workspaceRoot: "/workspace",
      appVersion: "test",
      connectionFactory: () => connection,
    });

    const inspection = await adapter.inspect();

    expect(inspection.account).toMatchObject({ account: null, requiresOpenaiAuth: false });
    expect(inspection.warnings[0]).toMatch(/account service unavailable/i);
    adapter.dispose();
  });
});

class FakeConnection extends EventEmitter {
  constructor() {
    super();
    this.closed = false;
    this.responses = [];
    this.errors = [];
    this.requests = [];
    this.results = new Map([["initialize", { userAgent: "codex" }]]);
    this.failures = new Map();
  }

  request(method, params) {
    this.requests.push({ method, params });
    if (this.failures.has(method)) return Promise.reject(this.failures.get(method));
    try {
      const result = this.results.get(method);
      return Promise.resolve(typeof result === "function" ? result(params) : result ?? {});
    } catch (error) {
      return Promise.reject(error);
    }
  }

  notify() {}

  respond(id, result) {
    this.responses.push({ id, result });
  }

  respondError(id, code, message) {
    this.errors.push({ id, code, message });
  }

  dispose() {
    this.closed = true;
    this.emit("exit", { expected: true });
  }
}
