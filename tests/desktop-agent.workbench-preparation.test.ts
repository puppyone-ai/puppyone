/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const controller = vi.hoisted(() => ({
  beginInitializeForRuntime: vi.fn(),
  openSavedSession: vi.fn(),
}));
const get = vi.hoisted(() => vi.fn(() => controller));
const discard = vi.hoisted(() => vi.fn());

vi.mock("../src/features/desktop-agent/workbench/projectAgentControllers", () => ({
  projectAgentControllers: () => ({ get, discard }),
}));
import { ProjectWorkbenchStore } from "../src/features/app-shell/auxiliary-workbench/ProjectWorkbenchStore";
const project = new ProjectWorkbenchStore({ projectId: "project", generation: "open-1", rootPath: "/workspace/project" });

import {
  discardPreparedAgentChatWorkbenchItem,
  prepareAgentChatWorkbenchItem,
  restoreAgentChatWorkbenchItem,
} from "../src/features/desktop-agent/workbench/AgentChatWorkbenchItem";

describe("Agent Chat Workbench preparation", () => {
  beforeEach(() => {
    controller.beginInitializeForRuntime.mockClear();
    get.mockClear();
    controller.openSavedSession.mockReset();
    discard.mockReset();
  });

  it("binds the requested runtime without making topology wait for discovery", () => {
    const preparation = prepareAgentChatWorkbenchItem(
      project,
      "chat-item-1",
      "codex",
    );

    expect(preparation).toBeUndefined();
    expect(get).toHaveBeenCalledWith("chat-item-1");
    expect(controller.beginInitializeForRuntime).toHaveBeenCalledWith("codex");
  });

  it("requires native resume to succeed before a restored Workbench Item can commit", async () => {
    controller.openSavedSession.mockResolvedValueOnce(true);

    await expect(restoreAgentChatWorkbenchItem(
      project,
      "chat-item-2",
      "saved-session",
      "codex",
    )).resolves.toBeUndefined();
    expect(controller.openSavedSession).toHaveBeenCalledWith("saved-session", "codex");

    const unavailable = Object.assign(new Error("This saved Agent session is no longer available."), {
      code: "SESSION_NOT_FOUND",
      retryable: false,
    });
    controller.openSavedSession.mockRejectedValueOnce(unavailable);
    await expect(restoreAgentChatWorkbenchItem(
      project,
      "chat-item-3",
      "missing-session",
      "codex",
    )).rejects.toBe(unavailable);
  });

  it("awaits native rollback when a prepared Workbench Item is not committed", async () => {
    const rollback = deferred<void>();
    discard.mockReturnValueOnce(rollback.promise);

    let settled = false;
    const pending = discardPreparedAgentChatWorkbenchItem(project, "chat-item-4")
      .then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(discard).toHaveBeenCalledWith("chat-item-4");

    rollback.resolve();
    await pending;
    expect(settled).toBe(true);
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}
