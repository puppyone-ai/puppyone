import { ProjectWorkbenchStore } from "../../../../src/features/app-shell/auxiliary-workbench/ProjectWorkbenchStore";
/**
 * @vitest-environment happy-dom
 */
import type { AuxiliaryWorkbenchItem } from "@puppyone/shared-ui";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createItemLifecycleSupervisor } from "../../../../electron/main/item-hosts/item-lifecycle-supervisor.mjs";
import { registerItemLifecycleIpc } from "../../../../electron/main/ipc/item-lifecycle-ipc.mjs";
import { handOffItemExecution } from "../../../../src/features/session-transport/itemLifecycleClient";
import type { ItemExecutionRequest, ItemExecutionSummary } from "../../../../shared/item-host-contract/lifecycle";
import type {
  AuxiliaryWorkbenchCloseAdapter,
  AuxiliaryWorkbenchItemSnapshot,
} from "../../../../src/features/app-shell/auxiliary-workbench/types";
import {
  useAuxiliaryWorkbenchCloseCoordinator,
  type AuxiliaryWorkbenchCloseTarget,
} from "../../../../src/features/app-shell/auxiliary-workbench/useAuxiliaryWorkbenchCloseCoordinator";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const projects: ProjectWorkbenchStore[] = [];
let root: Root | null = null;
let coordinator: ReturnType<typeof useAuxiliaryWorkbenchCloseCoordinator> | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  coordinator = null;
  for (const project of projects.splice(0)) project.dispose();
  document.body.replaceChildren();
});

describe("Auxiliary Workbench close coordinator", () => {
  it.each([
    { kind: "agent-chat", executionKind: "agent" as const },
    { kind: "terminal", executionKind: "terminal" as const },
  ])("removes a $kind view after Main accepts its $executionKind execution, while cleanup is pending", async ({ kind, executionKind }) => {
    const item = { ...ITEM, kind };
    const projectContext = { projectId: "fixture", generation: "fixture-generation", rootPath: "/workspace" };
    const lifecycle = createItemLifecycleSupervisor();
    const identity = { ownerId: 1, root: "/workspace", projectContext, kind: executionKind, itemId: item.id, creationId: "creation" };
    const record = lifecycle.reserve(identity);
    const cleanup = Promise.withResolvers<void>();
    lifecycle.attach(record, { host: { close: () => cleanup.promise } });
    const handlers = new Map<string, (event: { sender: { id: number } }, request: ItemExecutionRequest) => Promise<ItemExecutionSummary>>();
    registerItemLifecycleIpc({ ipcMain: { handle: (channel: string, handler: (event: { sender: { id: number } }, request: ItemExecutionRequest) => Promise<ItemExecutionSummary>) => handlers.set(channel, handler) },
      lifecycle, projectSessions: { require: () => projectContext }, manage: () => {} });
    const terminateItemExecution = vi.fn((request: ItemExecutionRequest) => handlers.get("item-execution:terminate")!({ sender: { id: 1 } }, request));
    const onClosed = vi.fn();
    renderCoordinator({ executionKind, decide: () => ({ kind: "close" }),
      commit: () => handOffItemExecution({ terminateItemExecution }, { kind: executionKind, itemId: item.id,
        creationId: "creation", operationId: "terminate-creation", projectContext }) }, onClosed, false, item);
    try {
      await act(async () => current().requestClose(item.id));
      expect(onClosed).toHaveBeenCalledExactlyOnceWith(item.id);
      expect(current().failure).toBeNull();
      expect(lifecycle.summary(record)).toMatchObject({ desiredLifecycle: "terminated", cleanup: "running" });
      expect(() => lifecycle.assertActive(record)).toThrow(/terminated/);
      expect(terminateItemExecution).toHaveBeenCalledOnce();
    } finally { cleanup.resolve(); await lifecycle.close(record); }
  });

  it.each(["execution-kind", "item", "project", "generation", "root", "undeclared-kind"])("rejects a handoff for the wrong %s", async mismatch => {
    const item = { ...ITEM, kind: "agent-chat" };
    const receipt: ItemExecutionSummary = { kind: mismatch === "execution-kind" ? "terminal" : "agent",
      itemId: mismatch === "item" ? "another-item" : item.id, creationId: "creation", executionId: "execution", operationId: "terminate",
      projectContext: { projectId: mismatch === "project" ? "other" : "fixture",
        generation: mismatch === "generation" ? "other" : "fixture-generation", rootPath: mismatch === "root" ? "/other" : "/workspace" },
      desiredLifecycle: "terminated", observedLifecycle: "stopping", cleanup: "running", revision: 1, errorCode: null };
    const onClosed = vi.fn();
    renderCoordinator({ ...(mismatch === "undeclared-kind" ? {} : { executionKind: "agent" as const }),
      decide: () => ({ kind: "close" }), commit: () => ({ kind: "handed-off", receipt }) } as AuxiliaryWorkbenchCloseAdapter, onClosed, false, item);
    await act(async () => current().requestClose(item.id));
    expect(onClosed).not.toHaveBeenCalled();
    expect(current().failure?.detail).toMatch(/another item or project generation/);
  });

  it.each([true, false])("isolates pending closes across mixed items (first finishes early=%s)", async firstFinishesEarly => {
    let finish!: (value: boolean) => void;
    const pending = new Promise<boolean>(resolve => { finish = resolve; });
    const onClosed = vi.fn();
    renderCoordinator({ executionKind: "terminal", decide: () => ({ kind: "confirm", tone: "danger", dialog: { title: "Close?", detail: "Terminate execution", actionLabel: "Close" } }),
      commit: ({item}) => item.id === ITEM.id ? pending : { kind: "released" } }, onClosed, true);
    await act(async () => current().requestClose(ITEM.id));
    let closing!: Promise<void>;
    act(() => { closing = current().confirm(); });
    await act(async () => current().requestClose("second-item"));
    expect(current().committing).toBe(false);
    if (firstFinishesEarly) {
      await act(async () => { finish(true); await closing; });
      expect(current().pending?.itemId).toBe("second-item");
    }
    await act(async () => current().confirm());
    expect(onClosed).toHaveBeenCalledWith("second-item");
    if (!firstFinishesEarly) await act(async () => { finish(true); await closing; });
  });
  it("retains a failed close for retry without rejecting the UI event", async () => {
    const commit = vi.fn().mockRejectedValueOnce(new Error("still running")).mockResolvedValue(true);
    const onClosed = vi.fn();
    renderCoordinator({ decide: () => ({ kind: "close" }), commit }, onClosed);
    await act(async () => current().requestClose(ITEM.id));
    expect(onClosed).not.toHaveBeenCalled();
    expect(current().failure).toEqual({ itemId: ITEM.id, detail: "still running" });
    await act(async () => current().requestClose(ITEM.id));
    expect(onClosed).toHaveBeenCalledOnce();
    expect(current().failure).toBeNull();
  });
  it("commits immediate decisions before removing topology", async () => {
    const events: string[] = [];
    const adapter: AuxiliaryWorkbenchCloseAdapter = {
      decide: () => ({ kind: "close" }),
      commit: async () => {
        events.push("commit");
        return true;
      },
    };
    renderCoordinator(adapter, (itemId) => events.push(`remove:${itemId}`));

    await act(async () => current().requestClose(ITEM.id));

    expect(events).toEqual(["commit", `remove:${ITEM.id}`]);
    expect(current().pending).toBeNull();
  });

  it("waits for explicit confirmation before releasing an active resource", async () => {
    const commit = vi.fn(async () => true);
    renderCoordinator({
      decide: () => ({
        kind: "confirm",
        tone: "danger",
        dialog: { title: "Close Terminal?", detail: "Still active.", actionLabel: "Close" },
      }),
      commit,
    });

    await act(async () => current().requestClose(ITEM.id));
    expect(current().pending?.decision.kind).toBe("confirm");
    expect(commit).not.toHaveBeenCalled();

    await act(async () => current().confirm());
    expect(commit).toHaveBeenCalledOnce();
    expect(current().pending).toBeNull();
  });

  it("presents blocked decisions without invoking the destructive commit", async () => {
    const commit = vi.fn(async () => true);
    renderCoordinator({
      decide: () => ({
        kind: "blocked",
        dialog: { title: "Still working", detail: "Stop the task first.", actionLabel: "Keep open" },
      }),
      commit,
    });

    await act(async () => current().requestClose(ITEM.id));
    expect(current().pending?.decision.kind).toBe("blocked");
    expect(commit).not.toHaveBeenCalled();

    act(() => current().dismiss());
    expect(current().pending).toBeNull();
  });

  it("re-evaluates policy when a resource refuses an immediate close", async () => {
    const decide = vi.fn()
      .mockReturnValueOnce({ kind: "close" })
      .mockReturnValueOnce({
        kind: "blocked",
        dialog: { title: "Busy", detail: "State changed.", actionLabel: "Keep open" },
      });
    renderCoordinator({ decide, commit: async () => false });

    await act(async () => current().requestClose(ITEM.id));

    expect(decide).toHaveBeenCalledTimes(2);
    expect(current().pending?.decision.kind).toBe("blocked");
  });

  it("coalesces repeated close requests while policy evaluation is pending", async () => {
    let resolveDecision: (() => void) | null = null;
    const decide = vi.fn(() => new Promise<{ kind: "close" }>((resolve) => {
      resolveDecision = () => resolve({ kind: "close" });
    }));
    const commit = vi.fn(async () => true);
    renderCoordinator({ decide, commit });

    let firstRequest: Promise<void> | null = null;
    act(() => {
      firstRequest = current().requestClose(ITEM.id);
      void current().requestClose(ITEM.id);
    });
    expect(decide).toHaveBeenCalledOnce();

    await act(async () => {
      resolveDecision?.();
      await firstRequest;
    });
    expect(commit).toHaveBeenCalledOnce();
  });
});

function renderCoordinator(
  adapter: AuxiliaryWorkbenchCloseAdapter,
  onClosed: (itemId: string) => void = vi.fn(),
  multiple = false,
  item: AuxiliaryWorkbenchItem = ITEM,
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const project = new ProjectWorkbenchStore({ projectId: "fixture", generation: "fixture-generation", rootPath: "/workspace" });
  projects.push(project);
  const target: AuxiliaryWorkbenchCloseTarget = Object.freeze({
    context: Object.freeze({ project, item, snapshot: SNAPSHOT }),
    adapter,
  });
  act(() => root?.render(
    <Harness resolveTarget={(itemId) => itemId === item.id ? target : multiple && itemId === "second-item"
      ? { ...target, context: { ...target.context, item: { ...ITEM, id: itemId, kind: "agent-chat" } } } : null} onClosed={onClosed} />,
  ));
}

function Harness({
  resolveTarget,
  onClosed,
}: Readonly<{
  resolveTarget: (itemId: string) => AuxiliaryWorkbenchCloseTarget | null;
  onClosed: (itemId: string) => void;
}>) {
  coordinator = useAuxiliaryWorkbenchCloseCoordinator({ resolveTarget, onClosed });
  return null;
}

function current() {
  if (!coordinator) throw new Error("Close coordinator is not mounted.");
  return coordinator;
}

const ITEM: AuxiliaryWorkbenchItem = Object.freeze({
  id: "item-1",
  kind: "terminal",
  rootId: "/workspace",
  contextId: "workspace-1",
});

const SNAPSHOT: AuxiliaryWorkbenchItemSnapshot = Object.freeze({
  title: "Terminal",
  accessibleLabel: "Terminal",
  detail: null,
  iconKey: null,
  status: "running",
  running: true,
  resourceId: null,
});
