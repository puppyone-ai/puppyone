import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopTerminalLauncherId } from "../../../../src/features/desktop-terminal/model/terminalLaunchers";
import {
  isTerminalTitleActive,
  TerminalActivityController,
  terminalActivityPolicy,
} from "../../../../src/features/desktop-terminal/runtime/terminalActivity";

afterEach(() => {
  vi.useRealTimers();
});

describe("Terminal Agent activity normalization", () => {
  it.each([
    ["⠋ Working", true],
    ["⠙ Working", true],
    ["Fix tests - ⏳ Working ···", true],
    ["Fix tests - ⌨️ Running shell command", true],
    ["Fix tests - 🧭 Planning", true],
    ["Fix tests - ✅ Ready", false],
    ["Fix tests - ❓ Waiting for you", false],
    ["✳ Fix tests", false],
    ["Fix tests", false],
  ])("maps the upstream terminal title %s to activity=%s", (title, expected) => {
    expect(isTerminalTitleActive(title)).toBe(expected);
  });

  it.each<DesktopTerminalLauncherId>([
    "codex",
    "claude",
    "cursor",
    "opencode",
    "pi",
    "hermes",
  ])("gives %s a generic output activity pulse without product UI branches", (launcherId) => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const controller = new TerminalActivityController({ launcherId, onChange });

    controller.noteOutput("Agent response repaint");
    controller.noteOutput("next frame");
    expect(controller.active).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(terminalActivityPolicy.outputIdleMs - 1);
    expect(controller.active).toBe(true);
    vi.advanceTimersByTime(1);
    expect(controller.active).toBe(false);
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it("keeps an explicit title protocol active across output silence", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const controller = new TerminalActivityController({ launcherId: "cursor", onChange });

    controller.noteTitle("Fix tests - ⏳ Working ...");
    controller.noteOutput("frame");
    vi.advanceTimersByTime(terminalActivityPolicy.outputIdleMs);
    expect(controller.active).toBe(true);

    controller.noteTitle("Fix tests - ✅ Ready");
    expect(controller.active).toBe(false);
  });

  it("does not report host-owned presentation repaint as Agent work", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const controller = new TerminalActivityController({ launcherId: "claude", onChange });

    controller.beginPresentationRefresh();
    controller.noteOutput("focus repaint");
    expect(controller.active).toBe(false);
    expect(onChange).not.toHaveBeenCalled();

    vi.advanceTimersByTime(terminalActivityPolicy.presentationRefreshMs);
    controller.noteOutput("real Agent output");
    expect(controller.active).toBe(true);
  });

  it("keeps explicit title activity authoritative during presentation refresh", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const controller = new TerminalActivityController({ launcherId: "cursor", onChange });

    controller.beginPresentationRefresh();
    controller.noteTitle("Fix tests - ⏳ Working ...");
    controller.noteOutput("focus repaint");
    expect(controller.active).toBe(true);
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("does not turn ordinary shell output into Agent activity", () => {
    const onChange = vi.fn();
    const controller = new TerminalActivityController({ launcherId: "shell", onChange });

    controller.noteTitle("⠋ build");
    controller.noteOutput("npm test");
    expect(controller.active).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
  });
});
