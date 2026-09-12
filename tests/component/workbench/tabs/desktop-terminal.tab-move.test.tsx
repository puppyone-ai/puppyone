import { installDesktopBridge } from "../../../support/electron/desktopBridge";
/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveTerminalTabBarDropTarget } from "../../../../src/features/desktop-terminal/interactions/terminalTabBarDropTarget";
import {
  useTerminalTabMoveDrag,
} from "../../../../src/features/desktop-terminal/interactions/useTerminalTabMoveDrag";
import { isNativeSurfaceLayoutStable } from "../../../../src/features/native-surfaces/nativeSurfaceGeometry";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  vi.useRealTimers();
  act(() => root?.unmount());
  root = null;
  delete window.puppyoneDesktop;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("Terminal Session tab movement", () => {
  it("does not activate an inactive Session until an ordinary press completes", () => {
    const onActivate = vi.fn();
    const harness = renderHarness({ onActivate });
    const tab = harness.tab;
    installPointerCapture(tab);

    act(() => tab.dispatchEvent(pointer("pointerdown", 1, 10, 10)));
    expect(onActivate).not.toHaveBeenCalled();

    act(() => tab.dispatchEvent(pointer("pointerup", 1, 10, 10)));
    expect(onActivate).toHaveBeenCalledWith("source");
  });

  it("keeps ordinary Tab activation tolerant of four pixels of pointer jitter", () => {
    const onActivate = vi.fn();
    const harness = renderHarness({ onActivate });
    installPointerCapture(harness.tab);

    act(() => harness.tab.dispatchEvent(pointer("pointerdown", 2, 10, 10)));
    act(() => harness.tab.dispatchEvent(pointer("pointermove", 2, 14, 10)));
    expect(document.body.classList.contains("desktop-terminal-session-dragging")).toBe(false);

    act(() => harness.tab.dispatchEvent(pointer("pointerup", 2, 14, 10)));
    expect(onActivate).toHaveBeenCalledWith("source");
  });

  it("uses the Ghostty grip as a drag-first Group source after three pixels", async () => {
    const setOccluded = vi.fn();
    Object.defineProperty(window, "puppyoneDesktop", { configurable: true, writable: true, value: { setNativeSurfaceOccluded: setOccluded } });
    const harness = renderHarness({ source: "group-handle" });
    installPointerCapture(harness.tab);

    act(() => harness.tab.dispatchEvent(pointer("pointerdown", 6, 10, 10)));
    act(() => harness.tab.dispatchEvent(pointer("pointermove", 6, 12, 10)));
    expect(document.body.classList.contains("desktop-terminal-session-dragging")).toBe(false);

    act(() => harness.tab.dispatchEvent(pointer("pointermove", 6, 13, 10)));
    expect(document.body.classList.contains("desktop-terminal-session-dragging")).toBe(true);
    expect(harness.sourceTab.dataset.moveSource).toBe("true");
    expect(isNativeSurfaceLayoutStable()).toBe(false);
    expect(setOccluded).toHaveBeenLastCalledWith({ occluded: true });

    act(() => harness.tab.dispatchEvent(pointer("pointercancel", 6, 13, 10)));
    expect(document.body.classList.contains("desktop-terminal-session-dragging")).toBe(false);
    expect(harness.sourceTab.dataset.moveSource).toBeUndefined();
    expect(isNativeSurfaceLayoutStable()).toBe(true);
    await act(async () => {});
    expect(setOccluded).toHaveBeenLastCalledWith({ occluded: false });
    delete window.puppyoneDesktop;
  });

  it("moves a whole Group at a content edge without applying Tab split admission", () => {
    const onMoveGroup = vi.fn();
    const canMoveGroup = vi.fn(() => true);
    const canDrop = vi.fn(() => false);
    const harness = renderHarness({
      source: "group-handle",
      canDrop,
      canMoveGroup,
      onMoveGroup,
    });
    installPointerCapture(harness.tab);
    harness.target.getBoundingClientRect = () => new DOMRect(100, 40, 400, 260);
    vi.spyOn(document, "elementFromPoint").mockReturnValue(harness.target);

    act(() => harness.tab.dispatchEvent(pointer("pointerdown", 11, 500, 150)));
    act(() => harness.tab.dispatchEvent(pointer("pointermove", 11, 102, 150)));

    expect(harness.container.querySelector("[data-drop-kind]")?.getAttribute("data-drop-kind"))
      .toBe("move-group");
    expect(canMoveGroup).toHaveBeenCalledWith(
      "group-source",
      "group-target",
      "left",
      harness.target,
    );
    expect(canDrop).not.toHaveBeenCalled();

    act(() => harness.tab.dispatchEvent(pointer("pointerup", 11, 102, 150)));
    expect(onMoveGroup).toHaveBeenCalledWith("group-source", "group-target", "left");
  });

  it("merges a whole Group into another Tab Bar as one ordered block", () => {
    const onMergeGroup = vi.fn();
    const canMergeGroup = vi.fn(() => true);
    const onMoveGroup = vi.fn();
    const harness = renderHarness({
      source: "group-handle",
      canMergeGroup,
      onMergeGroup,
      onMoveGroup,
    });
    installPointerCapture(harness.tab);
    harness.targetTabs[0]!.getBoundingClientRect = () => new DOMRect(100, 4, 100, 28);
    harness.targetTabs[1]!.getBoundingClientRect = () => new DOMRect(203, 4, 100, 28);
    vi.spyOn(document, "elementFromPoint").mockReturnValue(harness.targetBar);

    act(() => harness.tab.dispatchEvent(pointer("pointerdown", 13, 20, 20)));
    act(() => harness.tab.dispatchEvent(pointer("pointermove", 13, 220, 14)));

    expect(harness.container.querySelector("[data-drop-kind]")?.getAttribute("data-drop-kind"))
      .toBe("merge-group");
    expect(canMergeGroup).toHaveBeenCalledWith(
      "group-source",
      "group-target",
      1,
      harness.targetBar,
    );

    act(() => harness.tab.dispatchEvent(pointer("pointerup", 13, 220, 14)));
    expect(onMergeGroup).toHaveBeenCalledWith("group-source", "group-target", 1);
    expect(onMoveGroup).not.toHaveBeenCalled();
  });

  it("moves one live Session to the nearest Terminal Group edge after the threshold", () => {
    const onActivate = vi.fn();
    const onMoveSession = vi.fn();
    const canDrop = vi.fn(() => true);
    const harness = renderHarness({ onActivate, onMoveSession, canDrop });
    installPointerCapture(harness.tab);
    harness.target.getBoundingClientRect = () => new DOMRect(100, 0, 400, 300);
    vi.spyOn(document, "elementFromPoint").mockReturnValue(harness.target);

    act(() => harness.tab.dispatchEvent(pointer("pointerdown", 7, 20, 20)));
    act(() => harness.tab.dispatchEvent(pointer("pointermove", 7, 498, 150)));

    expect(document.body.classList.contains("desktop-terminal-session-dragging")).toBe(true);
    expect(document.querySelector(".desktop-terminal-tab-move-preview")).not.toBeNull();
    expect(harness.sourceTab.dataset.moveSource).toBe("true");
    expect(harness.container.querySelector("[data-drop-edge]")?.getAttribute("data-drop-edge"))
      .toBe("right");
    expect(canDrop).toHaveBeenCalledWith("source", "group-target", "right", harness.target);

    act(() => harness.tab.dispatchEvent(pointer("pointerup", 7, 498, 150)));
    expect(onMoveSession).toHaveBeenCalledWith("source", "group-target", "right");
    expect(onActivate).not.toHaveBeenCalled();
    expect(document.querySelector(".desktop-terminal-tab-move-preview")).toBeNull();
    expect(document.body.classList.contains("desktop-terminal-session-dragging")).toBe(false);
    expect(harness.sourceTab.dataset.moveSource).toBeUndefined();
  });

  it("keeps dragging when Pointer Capture does not retarget events to the source", () => {
    const onMoveSession = vi.fn();
    const harness = renderHarness({ onMoveSession });
    installPointerCapture(harness.tab);
    harness.target.getBoundingClientRect = () => new DOMRect(100, 0, 400, 300);
    vi.spyOn(document, "elementFromPoint").mockReturnValue(harness.target);

    act(() => harness.tab.dispatchEvent(pointer("pointerdown", 17, 20, 20)));
    act(() => harness.target.dispatchEvent(pointer("pointermove", 17, 498, 150)));

    expect(document.body.classList.contains("desktop-terminal-session-dragging")).toBe(true);
    expect(harness.container.querySelector("[data-drop-edge]")?.getAttribute("data-drop-edge"))
      .toBe("right");

    act(() => harness.target.dispatchEvent(pointer("pointerup", 17, 498, 150)));
    expect(onMoveSession).toHaveBeenCalledWith("source", "group-target", "right");
    expect(document.body.classList.contains("desktop-terminal-session-dragging")).toBe(false);
  });

  it("hands an active pointer to the window fallback when capture is revoked", () => {
    const onMoveSession = vi.fn();
    const harness = renderHarness({ onMoveSession });
    installPointerCapture(harness.tab);
    harness.target.getBoundingClientRect = () => new DOMRect(100, 0, 400, 300);
    vi.spyOn(document, "elementFromPoint").mockReturnValue(harness.target);

    act(() => harness.tab.dispatchEvent(pointer("pointerdown", 19, 20, 20)));
    act(() => harness.tab.dispatchEvent(pointer(
      "lostpointercapture",
      19,
      20,
      20,
      1,
    )));
    act(() => harness.target.dispatchEvent(pointer("pointermove", 19, 498, 150, 1)));
    act(() => harness.target.dispatchEvent(pointer("pointerup", 19, 498, 150)));

    expect(onMoveSession).toHaveBeenCalledWith("source", "group-target", "right");
  });

  it("prioritizes a Tab Bar insertion slot over the surrounding Group edge", () => {
    const onInsertSession = vi.fn();
    const onMoveSession = vi.fn();
    const canInsert = vi.fn(() => true);
    const harness = renderHarness({ canInsert, onInsertSession, onMoveSession });
    installPointerCapture(harness.tab);
    harness.target.getBoundingClientRect = () => new DOMRect(100, 0, 400, 300);
    harness.targetTabs[0]!.getBoundingClientRect = () => new DOMRect(100, 0, 100, 28);
    harness.targetTabs[1]!.getBoundingClientRect = () => new DOMRect(203, 0, 100, 28);
    vi.spyOn(document, "elementFromPoint").mockReturnValue(harness.targetTabs[1]!);

    act(() => harness.tab.dispatchEvent(pointer("pointerdown", 10, 20, 20)));
    act(() => harness.tab.dispatchEvent(pointer("pointermove", 10, 220, 14)));

    expect(harness.container.querySelector("[data-drop-kind]")?.getAttribute("data-drop-kind"))
      .toBe("insert");
    expect(harness.container.querySelector("[data-drop-index]")?.getAttribute("data-drop-index"))
      .toBe("1");
    expect(canInsert).toHaveBeenCalledWith(
      "source",
      "group-target",
      1,
      harness.targetBar,
    );

    act(() => harness.tab.dispatchEvent(pointer("pointerup", 10, 220, 14)));
    expect(onInsertSession).toHaveBeenCalledWith("source", "group-target", 1);
    expect(onMoveSession).not.toHaveBeenCalled();
  });

  it("never resolves the surrounding Pane chrome as a content split target", () => {
    const canDrop = vi.fn(() => true);
    const onMoveSession = vi.fn();
    const harness = renderHarness({ canDrop, onMoveSession });
    installPointerCapture(harness.tab);
    vi.spyOn(document, "elementFromPoint").mockReturnValue(harness.targetGroup);

    act(() => harness.tab.dispatchEvent(pointer("pointerdown", 20, 20, 20)));
    act(() => harness.tab.dispatchEvent(pointer("pointermove", 20, 102, 80)));

    expect(harness.container.querySelector("[data-drop-kind]")).toBeNull();
    expect(canDrop).not.toHaveBeenCalled();
    act(() => harness.tab.dispatchEvent(pointer("pointerup", 20, 102, 80)));
    expect(onMoveSession).not.toHaveBeenCalled();
  });

  it("treats the empty remainder of the Header rail as an append insertion slot", () => {
    const onInsertSession = vi.fn();
    const onMoveSession = vi.fn();
    const harness = renderHarness({ onInsertSession, onMoveSession });
    installPointerCapture(harness.tab);
    harness.targetTabs[0]!.getBoundingClientRect = () => new DOMRect(100, 4, 100, 28);
    harness.targetTabs[1]!.getBoundingClientRect = () => new DOMRect(203, 4, 100, 28);
    vi.spyOn(document, "elementFromPoint").mockReturnValue(harness.targetBar);

    act(() => harness.tab.dispatchEvent(pointer("pointerdown", 12, 20, 20)));
    act(() => harness.tab.dispatchEvent(pointer("pointermove", 12, 420, 14)));
    act(() => harness.tab.dispatchEvent(pointer("pointerup", 12, 420, 14)));

    expect(onInsertSession).toHaveBeenCalledWith("source", "group-target", 2);
    expect(onMoveSession).not.toHaveBeenCalled();
  });

  it("resolves stable same-Bar slots after excluding the dragged Tab", () => {
    const bar = document.createElement("div");
    bar.dataset.terminalTabBarGroupId = "group-a";
    const tabs = ["a", "b", "c"].map((sessionId, index) => {
      const tab = document.createElement("div");
      tab.dataset.terminalTabSessionId = sessionId;
      tab.dataset.terminalTabGroupIndex = String(index);
      tab.getBoundingClientRect = () => new DOMRect(index * 100, 0, 90, 28);
      bar.append(tab);
      return tab;
    });
    document.body.append(bar);

    expect(resolveTerminalTabBarDropTarget(tabs[2]!, "b", 286)).toMatchObject({
      targetGroupId: "group-a",
      targetIndex: 2,
    });
    expect(resolveTerminalTabBarDropTarget(tabs[0]!, "b", 4)).toMatchObject({
      targetGroupId: "group-a",
      targetIndex: 0,
    });

    bar.style.direction = "rtl";
    tabs.forEach((tab, index) => {
      tab.getBoundingClientRect = () => new DOMRect((2 - index) * 100, 0, 90, 28);
    });
    expect(resolveTerminalTabBarDropTarget(tabs[0]!, "b", 286)).toMatchObject({
      targetGroupId: "group-a",
      targetIndex: 0,
    });
    expect(resolveTerminalTabBarDropTarget(tabs[2]!, "b", 4)).toMatchObject({
      targetGroupId: "group-a",
      targetIndex: 2,
    });
  });

  it("shows rejected intent but commits no move", () => {
    const onMoveSession = vi.fn();
    const harness = renderHarness({ onMoveSession, canDrop: () => false });
    installPointerCapture(harness.tab);
    harness.target.getBoundingClientRect = () => new DOMRect(100, 0, 400, 300);
    vi.spyOn(document, "elementFromPoint").mockReturnValue(harness.target);

    act(() => harness.tab.dispatchEvent(pointer("pointerdown", 8, 20, 20)));
    act(() => harness.tab.dispatchEvent(pointer("pointermove", 8, 102, 150)));
    expect(harness.container.querySelector("[data-drop-allowed]")?.getAttribute("data-drop-allowed"))
      .toBe("false");
    act(() => harness.tab.dispatchEvent(pointer("pointerup", 8, 102, 150)));
    expect(onMoveSession).not.toHaveBeenCalled();
  });

  it("clears preview, body state, and native lease after a sustained window blur", () => {
    vi.useFakeTimers();
    const setPassthrough = vi.fn();
    installDesktopBridge({
      setNativeSurfacePointerPassthrough: setPassthrough,
    });
    const harness = renderHarness();
    installPointerCapture(harness.tab);
    harness.target.getBoundingClientRect = () => new DOMRect(100, 0, 400, 300);
    vi.spyOn(document, "elementFromPoint").mockReturnValue(harness.target);

    act(() => harness.tab.dispatchEvent(pointer("pointerdown", 9, 20, 20)));
    act(() => harness.tab.dispatchEvent(pointer("pointermove", 9, 498, 150)));
    expect(setPassthrough).toHaveBeenLastCalledWith({ active: true });

    act(() => window.dispatchEvent(new Event("blur")));
    expect(document.body.classList.contains("desktop-terminal-session-dragging")).toBe(true);
    act(() => vi.advanceTimersByTime(48));
    expect(setPassthrough).toHaveBeenLastCalledWith({ active: false });
    expect(document.querySelector(".desktop-terminal-tab-move-preview")).toBeNull();
    expect(document.body.classList.contains("desktop-terminal-session-dragging")).toBe(false);
  });

  it("keeps a drag alive across a transient window blur-focus handoff", () => {
    vi.useFakeTimers();
    const onMoveSession = vi.fn();
    const harness = renderHarness({ onMoveSession });
    installPointerCapture(harness.tab);
    harness.target.getBoundingClientRect = () => new DOMRect(100, 0, 400, 300);
    vi.spyOn(document, "elementFromPoint").mockReturnValue(harness.target);

    act(() => harness.tab.dispatchEvent(pointer("pointerdown", 18, 20, 20)));
    act(() => window.dispatchEvent(new Event("blur")));
    act(() => window.dispatchEvent(new Event("focus")));
    act(() => vi.advanceTimersByTime(48));
    act(() => harness.target.dispatchEvent(pointer("pointermove", 18, 498, 150)));

    expect(document.body.classList.contains("desktop-terminal-session-dragging")).toBe(true);
    act(() => harness.target.dispatchEvent(pointer("pointerup", 18, 498, 150)));
    expect(onMoveSession).toHaveBeenCalledWith("source", "group-target", "right");
  });
});

function renderHarness({
  canDrop = () => true,
  canInsert = () => true,
  canMergeGroup = () => true,
  canMoveGroup = () => true,
  onActivate = vi.fn(),
  onInsertSession = vi.fn(),
  onMergeGroup = vi.fn(),
  onMoveGroup = vi.fn(),
  onMoveSession = vi.fn(),
  source = "tab",
}: {
  canDrop?: () => boolean;
  canInsert?: () => boolean;
  canMergeGroup?: () => boolean;
  canMoveGroup?: () => boolean;
  onActivate?: (sessionId: string) => void;
  onInsertSession?: (source: string, target: string, index: number) => void;
  onMergeGroup?: (source: string, target: string, index: number) => void;
  onMoveGroup?: (source: string, target: string, edge: string) => void;
  onMoveSession?: (source: string, target: string, edge: string) => void;
  source?: "group-handle" | "tab";
} = {}) {
  const container = document.createElement("div");
  const overlay = document.createElement("div");
  overlay.id = "desktop-overlay-root";
  document.body.append(container, overlay);
  root = createRoot(container);

  function Harness() {
    const move = useTerminalTabMoveDrag({
      canDrop,
      canInsert,
      canMergeGroup,
      canMoveGroup,
      onInsertSession,
      onMergeGroup,
      onMoveGroup,
      onMoveSession,
    });
    return (
      <>
        <div
          className="desktop-terminal-tab"
          data-terminal-group-pane-id={source === "group-handle" ? "group-source" : undefined}
        >
          <button
            data-source-tab
            onPointerDown={(event) => move.start(
              event,
              source === "group-handle"
                ? { kind: "group", groupId: "group-source", sessionIds: ["source"] }
                : { kind: "tab", sessionId: "source" },
              "Terminal source",
            )}
            onPointerMove={move.move}
            onPointerUp={(event) => {
              if (move.end(event) === "press") onActivate("source");
            }}
            onPointerCancel={move.cancel}
            onLostPointerCapture={move.lostCapture}
          >
            source
          </button>
        </div>
        <div data-terminal-group-pane-id="group-target">
          <div data-terminal-tab-bar-group-id="group-target">
            <span
              data-terminal-tab-session-id="target-a"
              data-terminal-tab-group-index="0"
            />
            <span
              data-terminal-tab-session-id="target-b"
              data-terminal-tab-group-index="1"
            />
          </div>
          <div data-terminal-content-drop-group-id="group-target" />
        </div>
        {move.dropIntent && (
          <output
            data-drop-kind={move.dropIntent.kind}
            data-drop-edge={move.dropIntent.kind === "split"
              || move.dropIntent.kind === "move-group"
              ? move.dropIntent.edge
              : undefined}
            data-drop-index={move.dropIntent.kind === "insert"
              || move.dropIntent.kind === "merge-group"
              ? move.dropIntent.targetIndex
              : undefined}
            data-drop-allowed={String(move.dropIntent.allowed)}
          />
        )}
      </>
    );
  }

  act(() => root?.render(<Harness />));
  return {
    container,
    sourceTab: container.querySelector<HTMLElement>(".desktop-terminal-tab")!,
    tab: container.querySelector<HTMLButtonElement>("[data-source-tab]")!,
    target: container.querySelector<HTMLElement>(
      '[data-terminal-content-drop-group-id="group-target"]',
    )!,
    targetGroup: container.querySelector<HTMLElement>(
      '[data-terminal-group-pane-id="group-target"]',
    )!,
    targetBar: container.querySelector<HTMLElement>(
      '[data-terminal-tab-bar-group-id="group-target"]',
    )!,
    targetTabs: Array.from(container.querySelectorAll<HTMLElement>(
      '[data-terminal-tab-bar-group-id="group-target"] [data-terminal-tab-session-id]',
    )),
  };
}

function pointer(
  type: string,
  pointerId: number,
  clientX: number,
  clientY: number,
  buttons = 0,
) {
  return new PointerEvent(type, {
    bubbles: true,
    button: 0,
    buttons,
    clientX,
    clientY,
    pointerId,
  });
}

function installPointerCapture(element: HTMLElement) {
  const captured = new Set<number>();
  element.setPointerCapture = (pointerId) => captured.add(pointerId);
  element.hasPointerCapture = (pointerId) => captured.has(pointerId);
  element.releasePointerCapture = (pointerId) => captured.delete(pointerId);
}
