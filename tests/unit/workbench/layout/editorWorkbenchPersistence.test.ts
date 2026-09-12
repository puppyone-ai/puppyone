/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EDITOR_WORKBENCH_PERSISTENCE_DELAY_MS,
  EditorWorkbenchPersistenceScheduler,
} from "../../../../src/features/editor-workbench/persistence/editorWorkbenchPersistence";
import {
  EMPTY_EDITOR_WORKBENCH,
  type DesktopEditorWorkbenchState,
} from "../../../../src/features/editor-workbench/persistence/editorWorkbenchStorage";

afterEach(() => vi.useRealTimers());

describe("EditorWorkbenchPersistenceScheduler", () => {
  it("coalesces rapid state changes into one delayed write", () => {
    vi.useFakeTimers();
    const setItem = vi.fn();
    const scheduler = new EditorWorkbenchPersistenceScheduler({ setItem }, window);
    const first = workbenchWithActivePane("pane-1");
    const second = workbenchWithActivePane("pane-2");

    scheduler.schedule("workspace", first);
    scheduler.schedule("workspace", second);
    vi.advanceTimersByTime(EDITOR_WORKBENCH_PERSISTENCE_DELAY_MS - 1);
    expect(setItem).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(setItem).toHaveBeenCalledTimes(1);
    expect(JSON.parse(setItem.mock.calls[0]![1]).layout.activePaneId).toBe("pane-2");
  });

  it("flushes the previous workspace before scheduling a different key", () => {
    vi.useFakeTimers();
    const setItem = vi.fn();
    const scheduler = new EditorWorkbenchPersistenceScheduler({ setItem }, window);

    scheduler.schedule("workspace-a", workbenchWithActivePane("pane-a"));
    scheduler.schedule("workspace-b", workbenchWithActivePane("pane-b"));
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(setItem.mock.calls[0]![0]).toBe("workspace-a");

    scheduler.flush();
    expect(setItem.mock.calls[1]![0]).toBe("workspace-b");
  });

  it("flushes synchronously at an explicit lifecycle boundary", () => {
    vi.useFakeTimers();
    const setItem = vi.fn();
    const scheduler = new EditorWorkbenchPersistenceScheduler({ setItem }, window);
    scheduler.schedule("workspace", workbenchWithActivePane("pane-final"));

    scheduler.flush();

    expect(setItem).toHaveBeenCalledTimes(1);
    vi.runAllTimers();
    expect(setItem).toHaveBeenCalledTimes(1);
  });
});

function workbenchWithActivePane(activePaneId: string): DesktopEditorWorkbenchState {
  return {
    ...EMPTY_EDITOR_WORKBENCH,
    layout: {
      ...EMPTY_EDITOR_WORKBENCH.layout,
      activePaneId,
    },
  };
}
