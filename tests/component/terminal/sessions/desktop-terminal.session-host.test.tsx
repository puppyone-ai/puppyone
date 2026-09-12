/**
 * @vitest-environment happy-dom
 */
import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { DesktopTerminalSession } from "../../../../src/features/desktop-terminal/model/terminalSessions";
import type { TerminalRuntimeHandle } from "../../../../src/features/desktop-terminal/runtime/terminalRuntime";
import { TerminalSessionHost } from "../../../../src/features/desktop-terminal/ui/TerminalSessionHost";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe("Terminal session host lifecycle", () => {
  it("keeps one xterm attachment while startup transitions to running", () => {
    const runtime = createRuntime();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    const render = (status: DesktopTerminalSession["status"]) => act(() => root.render(
      withTestLocalization(
        <TerminalSessionHost
          agentMode="terminal"
          focused
          presented
          discoveryPhase="ready"
          availableAgentIds={["opencode"]}
          runtime={runtime}
          onFocus={vi.fn()}
          session={{
            id: "terminal-opencode",
            launcherId: "opencode",
            launchError: null,
            ordinal: 1,
            shell: status === "running" ? "OpenCode" : null,
            status,
          }}
          workspacePath="/workspace"
          onLaunch={vi.fn()}
          onRefresh={vi.fn()}
        />,
      ),
    ));

    render("starting");
    expect(container.textContent).toContain("Starting Agent");
    expect(runtime.mount).toHaveBeenCalledTimes(1);

    render("running");
    expect(container.textContent).not.toContain("Starting Agent");
    expect(runtime.mount).toHaveBeenCalledTimes(1);
    expect(runtime.unmount).not.toHaveBeenCalled();
    expect(runtime.setPresented).toHaveBeenLastCalledWith(true);
    expect(runtime.setFocused).toHaveBeenLastCalledWith(true);

    act(() => root.unmount());
    expect(runtime.unmount).toHaveBeenCalledTimes(1);
    container.remove();
  });
});

function createRuntime(): TerminalRuntimeHandle {
  return {
    activity: false,
    ready: true,
    scrollbarState: {
      visible: false,
      canDecrement: false,
      canIncrement: false,
      position: 0,
      viewportRatio: 1,
    },
    applyAppearance: vi.fn(),
    dispose: vi.fn(),
    focus: vi.fn(),
    getMinimumViewportSize: vi.fn(() => ({ width: 172, height: 128 })),
    mount: vi.fn(),
    scrollLines: vi.fn(),
    scrollToRatio: vi.fn(),
    unmount: vi.fn(),
    setFocused: vi.fn(),
    setPresented: vi.fn(),
    subscribeActivity: vi.fn((listener) => {
      listener(false);
      return () => undefined;
    }),
    subscribeReady: vi.fn((listener) => {
      listener(true);
      return () => undefined;
    }),
    subscribeScrollbar: vi.fn(() => () => undefined),
    write: vi.fn(),
  };
}
