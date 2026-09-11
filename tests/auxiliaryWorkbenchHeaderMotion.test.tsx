/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AuxiliaryWorkbenchHeader } from "../src/features/app-shell/auxiliary-workbench/layout/AuxiliaryWorkbenchHeader";
import type { AuxiliaryWorkbenchHeaderItem } from "../src/features/app-shell/auxiliary-workbench/layout/AuxiliaryWorkbenchHeader.types";
import { withTestLocalization } from "./testLocalization";

let root: Root;
let container: HTMLDivElement;
let width = 800;
const originalAnimate = HTMLElement.prototype.animate;
const item = (id: string, headerKey = id): AuxiliaryWorkbenchHeaderItem => ({
  id, headerKey, kind: "agent-chat", snapshot: { title: id, accessibleLabel: id, detail: null,
    iconKey: "codex", status: "idle", running: false, resourceId: null },
});
beforeEach(() => {
  vi.useFakeTimers(); width = 800;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({
    x: 0, y: 0, left: 0, top: 0, width, height: 38, right: width, bottom: 38, toJSON: () => ({}),
  }));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount()); document.body.replaceChildren(); vi.restoreAllMocks(); vi.useRealTimers();
  Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, value: originalAnimate });
});
function render(items: AuxiliaryWorkbenchHeaderItem[], active = items.at(-1)!.id) {
  act(() => root.render(withTestLocalization(<AuxiliaryWorkbenchHeader groupId="group" items={items}
    activeItemId={active} onActivate={() => {}} onClose={() => {}} onCreate={() => {}} />)));
}
const rail = () => container.querySelector<HTMLElement>(".desktop-terminal-tab-rail")!;
const tab = (id: string) => container.querySelector<HTMLElement>(`[data-terminal-tab-session-id="${id}"]`)!;

it("coordinates new-tab entry, the tab strip, and the stable trailing control", () => {
  render([item("a")]);
  expect(rail().dataset.layoutMotion).toBeUndefined();
  act(() => vi.advanceTimersByTime(20));
  const a = tab("a"), plus = container.querySelector(".desktop-terminal-new-button");
  expect(rail().style.getPropertyValue("--desktop-terminal-new-inline-start")).toBe("147px");
  render([item("a"), item("b")]);
  expect(rail().dataset.layoutMotion).toBe("true");
  expect(tab("a")).toBe(a);
  expect(container.querySelector(".desktop-terminal-new-button")).toBe(plus);
  expect(rail().style.getPropertyValue("--desktop-terminal-tabs-resolved-width")).toBe("291px");
  expect(rail().style.getPropertyValue("--desktop-terminal-new-inline-start")).toBe("294px");
});

it("retains the visual tab and keyboard focus while replacing a launcher identity", () => {
  render([item("launcher")]); act(() => vi.advanceTimersByTime(20));
  const shell = tab("launcher"), button = shell.querySelector<HTMLButtonElement>("[role=tab]")!;
  const label = shell.querySelector(".desktop-terminal-tab-title");
  button.focus();
  render([item("runtime", "launcher")]);
  expect(tab("runtime")).toBe(shell);
  expect(document.activeElement).toBe(button);
  expect(button.id).toContain("runtime");
  expect(button.getAttribute("aria-controls")).toContain("runtime");
  expect(shell.querySelector(".desktop-terminal-tab-title")).not.toBe(label);
  expect(rail().style.getPropertyValue("--desktop-terminal-new-inline-start")).toBe("147px");
});

it("fits a resized container immediately and re-enables motion only after measurement", () => {
  render([item("a"), item("b"), item("c")]); act(() => vi.advanceTimersByTime(20));
  width = 300;
  act(() => window.dispatchEvent(new Event("resize")));
  expect(rail().dataset.layoutMotion).toBeUndefined();
  expect(rail().dataset.layout).toBe("compact");
  act(() => vi.advanceTimersByTime(20));
  expect(rail().dataset.layoutMotion).toBe("true");
  render([item("a"), item("b"), item("c")], "a");
  expect(tab("a").style.getPropertyValue("--desktop-terminal-tab-resolved-width")).toBe("144px");
  expect(tab("c").style.getPropertyValue("--desktop-terminal-tab-resolved-width")).toBe("28px");
});

it("keeps the overflow window and label slots stable across launcher promotion", () => {
  width = 281;
  const items = Array.from({ length: 7 }, (_, index) => item(`item-${index}`));
  render(items, "item-3"); act(() => vi.advanceTimersByTime(20));
  render(items, "item-4");
  const before = [...container.querySelectorAll(".desktop-terminal-tab")];
  const plusStart = rail().style.getPropertyValue("--desktop-terminal-new-inline-start");
  render(items.map((entry) => entry.id === "item-4" ? item("runtime", "item-4") : entry), "runtime");
  expect([...container.querySelectorAll(".desktop-terminal-tab")]).toEqual(before);
  expect(rail().style.getPropertyValue("--desktop-terminal-new-inline-start")).toBe(plusStart);
  expect(tab("runtime").classList.contains("is-active")).toBe(true);
});

it("retargets interrupted pixels together, ignores summary updates, and cancels on resize/unmount", () => {
  const calls: { element: HTMLElement; frames: Keyframe[]; animation: { playState: string; cancel: ReturnType<typeof vi.fn> } }[] = [];
  Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, value: function (this: HTMLElement, frames: Keyframe[]) {
    const animation = { playState: "running", cancel: vi.fn(() => { animation.playState = "idle"; }) };
    calls.push({ element: this, frames, animation });
    return animation;
  } });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const rail = this.closest(".desktop-terminal-tab-rail") as HTMLElement | null;
    let size = width, x = 0;
    if (this.classList.contains("desktop-terminal-tab")) {
      size = Number.parseFloat(this.style.getPropertyValue("--desktop-terminal-tab-resolved-width"));
      x = Number.parseFloat(this.style.getPropertyValue("--desktop-terminal-tab-inline-start"));
    } else if (this.classList.contains("desktop-terminal-tabs")) size = Number.parseFloat(rail!.style.getPropertyValue("--desktop-terminal-tabs-resolved-width"));
    else if (this.classList.contains("desktop-terminal-new-button")) {
      size = 28; x = Number.parseFloat(rail!.style.getPropertyValue("--desktop-terminal-new-inline-start"));
    }
    if (this.dataset.terminalTabSessionId === "b" && calls.findLast((call) => call.element === this)?.animation.playState === "running") {
      x = 147; size = 50;
    }
    return { x, y: 0, left: x, top: 0, width: size, height: 28, right: x + size, bottom: 28, toJSON: () => ({}) };
  });
  render([item("a")]); act(() => vi.advanceTimersByTime(20));
  render([item("a"), item("b")]);
  const b = tab("b");
  const first = calls.find((call) => call.element === b)!;
  expect(first.frames).toEqual([{ left: "147px", width: "0px" }, { left: "147px", width: "144px" }]);
  const count = calls.length;
  render([item("a"), { ...item("b"), snapshot: { ...item("b").snapshot, title: "Updated" } }]);
  expect(calls).toHaveLength(count);
  expect(first.animation.cancel).not.toHaveBeenCalled();
  render([item("a"), item("b"), item("c")]);
  expect(first.animation.cancel).toHaveBeenCalledOnce();
  expect(calls.findLast((call) => call.element === b)!.frames[0]).toEqual({ left: "147px", width: "50px" });
  expect(calls.findLast((call) => call.element === tab("c"))!.frames[0]).toEqual({ left: "200px", width: "0px" });
  width = 300; act(() => window.dispatchEvent(new Event("resize")));
  expect(calls.every((call) => call.animation.playState === "idle")).toBe(true);
  act(() => vi.advanceTimersByTime(20)); render([item("a"), item("b"), item("c")], "a");
  act(() => root.render(null));
  expect(calls.every((call) => call.animation.playState === "idle")).toBe(true);
});
