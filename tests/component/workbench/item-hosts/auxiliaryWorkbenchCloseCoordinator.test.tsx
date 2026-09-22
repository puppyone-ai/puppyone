import { ProjectWorkbenchStore } from "../../../../src/features/app-shell/auxiliary-workbench/ProjectWorkbenchStore";
/**
 * @vitest-environment happy-dom
 */
import type { AuxiliaryWorkbenchItem } from "@puppyone/shared-ui";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  it.each([true, false])("isolates pending closes across mixed items (first finishes early=%s)", async firstFinishesEarly => {
    let finish!: (value: boolean) => void;
    const pending = new Promise<boolean>(resolve => { finish = resolve; });
    const onClosed = vi.fn();
    renderCoordinator({ decide: () => ({ kind: "confirm", tone: "danger", dialog: { title: "Close?", detail: "Terminate execution", actionLabel: "Close" } }),
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
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const project = new ProjectWorkbenchStore({ projectId: "fixture", generation: "fixture-generation", rootPath: "/workspace" });
  projects.push(project);
  const target: AuxiliaryWorkbenchCloseTarget = Object.freeze({
    context: Object.freeze({ project, item: ITEM, snapshot: SNAPSHOT }),
    adapter,
  });
  act(() => root?.render(
    <Harness resolveTarget={(itemId) => itemId === ITEM.id ? target : multiple && itemId === "second-item"
      ? { ...target, context: { ...target.context, item: { ...ITEM, id: itemId, kind: "agent" } } } : null} onClosed={onClosed} />,
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
