import { describe, expect, it } from "vitest";
import {
  isExplorerDeleteShortcut,
  type ExplorerDeleteKeyEvent,
} from "../../../../src/shared-ui/data/explorer/explorerDeleteShortcut";

const base: ExplorerDeleteKeyEvent = {
  key: "Delete",
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  repeat: false,
  isComposing: false,
  defaultPrevented: false,
};

const event = (overrides: Partial<ExplorerDeleteKeyEvent> = {}) => ({ ...base, ...overrides });

describe("isExplorerDeleteShortcut", () => {
  it("accepts an unmodified Delete on every platform", () => {
    expect(isExplorerDeleteShortcut(event(), false)).toBe(true);
    expect(isExplorerDeleteShortcut(event(), true)).toBe(true);
  });

  it("accepts Meta+Backspace only when the host enables the macOS chord", () => {
    const chord = event({ key: "Backspace", metaKey: true });
    expect(isExplorerDeleteShortcut(chord, true)).toBe(true);
    expect(isExplorerDeleteShortcut(chord, false)).toBe(false);
  });

  it("never deletes on an unmodified Backspace", () => {
    expect(isExplorerDeleteShortcut(event({ key: "Backspace" }), true)).toBe(false);
  });

  it("rejects every other modifier combination", () => {
    for (const modifiers of [
      { metaKey: true },
      { ctrlKey: true },
      { altKey: true },
      { shiftKey: true },
      { ctrlKey: true, shiftKey: true },
    ]) {
      expect(isExplorerDeleteShortcut(event(modifiers), true)).toBe(false);
    }
  });

  it("ignores repeats, composition, and handled events", () => {
    expect(isExplorerDeleteShortcut(event({ repeat: true }), true)).toBe(false);
    expect(isExplorerDeleteShortcut(event({ isComposing: true }), true)).toBe(false);
    expect(isExplorerDeleteShortcut(event({ defaultPrevented: true }), true)).toBe(false);
  });

  it("does not treat other keys as delete", () => {
    expect(isExplorerDeleteShortcut(event({ key: "d", metaKey: true }), true)).toBe(false);
    expect(isExplorerDeleteShortcut(event({ key: "Escape" }), true)).toBe(false);
  });
});
