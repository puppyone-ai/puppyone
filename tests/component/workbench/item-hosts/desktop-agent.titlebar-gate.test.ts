/**
 * @vitest-environment happy-dom
 */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getHeaderElementDefinition,
  type HeaderElementRenderContext,
} from "../../../../src/features/app-shell/headerElements";
import {
  AGENT_PREFERRED_RUNTIME_STORAGE_KEY,
  RIGHT_SIDEBAR_SURFACE_STORAGE_KEY,
  readInitialAgentPreferredRuntime,
  readInitialRightSidebarSurface,
} from "../../../../src/features/app-shell/preferences";
import { testT, withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  window.localStorage.clear();
});

describe("unified Agent workbench titlebar entry", () => {
  it("defaults the right sidebar to Chat and restores Git surfaces independently", () => {
    expect(readInitialRightSidebarSurface()).toBe("chat");
    window.localStorage.setItem(RIGHT_SIDEBAR_SURFACE_STORAGE_KEY, "history");
    expect(readInitialRightSidebarSurface()).toBe("history");

    window.localStorage.setItem(RIGHT_SIDEBAR_SURFACE_STORAGE_KEY, "changes");
    expect(readInitialRightSidebarSurface()).toBe("changes");

    window.localStorage.setItem(RIGHT_SIDEBAR_SURFACE_STORAGE_KEY, "terminal");
    expect(readInitialRightSidebarSurface()).toBe("chat");
  });

  it("restores only a validated last-selected Agent id", () => {
    expect(readInitialAgentPreferredRuntime()).toBeNull();
    window.localStorage.setItem(AGENT_PREFERRED_RUNTIME_STORAGE_KEY, "codex");
    expect(readInitialAgentPreferredRuntime()).toBe("codex");

    window.localStorage.setItem(AGENT_PREFERRED_RUNTIME_STORAGE_KEY, "../../not-a-runtime");
    expect(readInitialAgentPreferredRuntime()).toBeNull();
  });

  it("presents the unified workbench as a stable Agent toggle without a dropdown menu", () => {
    const container = renderHeaderActions();
    const agentButton = container.querySelector('button[aria-label="Hide Agent"]');

    expect(agentButton).not.toBeNull();
    expect(agentButton?.querySelector(".lucide-agent-entry")).not.toBeNull();
    expect(agentButton?.textContent).toBe("");
    expect(container.querySelector('button[aria-label="Terminal actions"]')).toBeNull();
    expect(container.textContent).not.toContain("Clear Terminal");
    expect(container.textContent).not.toContain("Reset Terminal");
    expect(container.querySelector('button[aria-label="Show Agent Chat"]')).toBeNull();
  });

  it("does not expose a second Chat toggle beside the Workbench entry", () => {
    const container = renderHeaderActions();
    expect(container.querySelector('button[aria-label="Hide Agent"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Show Agent Chat"]')).toBeNull();
    expect(container.querySelectorAll("button.desktop-titlebar-action")).toHaveLength(1);
    expect(container.querySelector(".desktop-shell-toolbar-button-label")).toBeNull();
  });
});

function renderHeaderActions() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const definition = getHeaderElementDefinition("terminal");
  if (!definition) throw new Error("Terminal header action is missing.");
  const context: HeaderElementRenderContext = {
    t: testT,
    terminal: {
      enabled: true,
      onToggle: vi.fn(),
      sidebarOpen: true,
    },
    history: {
      enabled: true,
      onToggle: vi.fn(),
      sidebarOpen: false,
    },
    changes: {
      enabled: true,
      onToggle: vi.fn(),
      sidebarOpen: false,
      status: {
        conflicts: 0,
        incoming: 0,
        localChanges: 0,
        outgoing: 0,
      },
    },
  };

  act(() => root?.render(withTestLocalization(React.createElement(
    React.Fragment,
    null,
    definition.render(context),
  ))));
  return container;
}
