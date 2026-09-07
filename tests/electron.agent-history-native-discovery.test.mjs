import { describe, expect, it, vi } from "vitest";
import { discoverClaudeHistory } from "../electron/main/agent/runtimes/claude/claude-history-discovery.mjs";
import { discoverCodexHistory } from "../electron/main/agent/runtimes/codex/codex-history-discovery.mjs";
import { discoverAcpHistory } from "../electron/main/agent/protocols/acp/acp-history-discovery.mjs";

const workspaceRoot = "/workspace";
describe("native history list protocols", () => {
  it("advances Claude's raw SDK page even when workspace filtering removes every row", async () => {
    const sdk = { listSessions: vi.fn()
      .mockResolvedValueOnce([{ sessionId: "other", cwd: "/other", lastModified: 0 }])
      .mockResolvedValueOnce([{ sessionId: "wanted", cwd: workspaceRoot, lastModified: 0 }]) };
    const first = await discoverClaudeHistory({ sdk, workspaceRoot }, { limit: 1 });
    expect(first).toMatchObject({ sessions: [], nextCursor: "1" });
    const next = await discoverClaudeHistory({ sdk, workspaceRoot }, { cursor: first.nextCursor, limit: 1 });
    expect(next.sessions[0].providerSessionId).toBe("wanted");
    expect(sdk.listSessions).toHaveBeenLastCalledWith({ dir: workspaceRoot, offset: 1, limit: 1 });
  });

  it.each([null, undefined, {}, "invalid"])("rejects Codex's malformed data (%j) instead of claiming an empty source", async (data) => {
    const request = vi.fn(async () => ({ data, nextCursor: null }));
    await expect(discoverCodexHistory({ request, workspaceRoot })).rejects.toThrow(/invalid session page/);
  });

  it("preserves opaque native cursors without trimming or shortening them", async () => {
    const cursor = " opaque cursor with spaces ";
    const request = vi.fn(async () => ({ data: [], nextCursor: cursor }));
    const page = await discoverCodexHistory({ request, workspaceRoot }, { cursor });
    expect(page.nextCursor).toBe(cursor);
    expect(request).toHaveBeenCalledWith("thread/list", expect.objectContaining({ cursor }));
  });

  it("accepts ACP's server-selected page size without inventing a native limit parameter or dropping rows", async () => {
    const sessions = Array.from({ length: 35 }, (_, i) => ({ sessionId: `native/${i}`, cwd: workspaceRoot }));
    const client = { agentCapabilities: { sessionCapabilities: { list: {} } },
      listSessions: vi.fn(async () => ({ sessions, nextCursor: " next " })) };
    const page = await discoverAcpHistory({ client, workspaceRoot, fallbackTitle: "Agent" }, { limit: 20, cursor: " previous " });
    expect(page.sessions).toHaveLength(35);
    expect(page.nextCursor).toBe(" next ");
    expect(client.listSessions).toHaveBeenCalledWith({ cwd: workspaceRoot, cursor: " previous " });
    expect(page.coverage.scopeComplete).toBe(false);
  });

  it("rejects malformed ACP lists and never treats them as deletion evidence", async () => {
    const client = { agentCapabilities: { listSessions: true }, listSessions: vi.fn(async () => ({ sessions: null })) };
    await expect(discoverAcpHistory({ client, workspaceRoot })).rejects.toThrow(/invalid session page/);
  });

  it("does not call the native SDK after query cancellation", async () => {
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    const sdk = { listSessions: vi.fn() };
    await expect(discoverClaudeHistory({ sdk, workspaceRoot }, { signal: controller.signal })).rejects.toThrow(/cancelled/);
    expect(sdk.listSessions).not.toHaveBeenCalled();
  });
});
