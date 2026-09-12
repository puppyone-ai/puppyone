/** @vitest-environment happy-dom */

import React from "react";

import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { AgentComposer } from "../../../../src/features/desktop-agent/ui/AgentComposer";

import { AgentPanelLayout } from "../../../../src/features/desktop-agent/ui/AgentPanelLayout";

import { AgentRuntimePicker } from "../../../../src/features/desktop-agent/ui/AgentRuntimePicker";
import { AgentSurfaceHeader } from "../../../../src/features/desktop-agent/ui/AgentSurfaceHeader";

import { render, runtimeEntry, modelSessionControl } from "../../../support/agent/rendererHarness";

describe("Desktop Agent renderer surfaces", () => {

  it("renders the structural regions and applies the real layout CSS contract", () => {
    const style = document.createElement("style");
    style.dataset.agentLayoutTest = "true";
    style.textContent = [
      readFileSync(`${process.cwd()}/packages/shared-ui/src/styles/control-geometry.css`, "utf8"),
      readFileSync(`${process.cwd()}/src/styles/tokens.css`, "utf8"),
      ...["theme.css", "foundation.css", "composer.css", "agent-prompt-editor.css", "pickers.css"]
        .map((file) => readFileSync(`${process.cwd()}/src/features/desktop-agent/ui/styles/${file}`, "utf8")),
    ].join("\n");
    document.head.appendChild(style);

    const container = render(React.createElement(AgentPanelLayout, {
      ariaLabel: "Layout contract",
      header: React.createElement(AgentSurfaceHeader, {
        title: "New chat",
        runtimeLabel: "Codex",
        statusCode: "ready",
        statusLabel: "ready",
        loading: false,
        newSessionDisabled: false,
        onNewSession: vi.fn(),
        agentSelector: React.createElement(AgentRuntimePicker, {
          agentRuntimes: [runtimeEntry("codex", "Codex")],
          selectedRuntimeId: "codex",
          onSelectRuntime: vi.fn(),
        }),
      }),
      status: React.createElement("span", null, "Status"),
      conversation: React.createElement("span", null, "Conversation"),
      conversationOverlay: React.createElement("span", null, "Stable empty state"),
      dock: React.createElement(AgentComposer, {
        draft: "Ready",
        onDraftChange: vi.fn(),
        disabled: false,
        running: false,
        stopping: false,
        submitting: false,
        placeholder: "Ask anything",
        sessionControls: modelSessionControl([{ model: "gpt-5", displayName: "GPT-5" }], "gpt-5"),
        onSubmit: vi.fn(async () => true),
        onStop: vi.fn(),
      }),
    }));
    const boundary = container.querySelector(".desktop-agent-boundary") as HTMLElement;
    const panel = container.querySelector(".desktop-agent-panel") as HTMLElement;
    const conversationOverlay = container.querySelector(".desktop-agent-conversation-overlay") as HTMLElement;
    const dock = container.querySelector(".desktop-agent-dock-region") as HTMLElement;

    expect(style.sheet?.cssRules.length).toBeGreaterThan(0);
    expect(boundary.children).toHaveLength(1);
    expect(panel.children).toHaveLength(5);
    expect(window.getComputedStyle(panel).display).toBe("grid");
    expect(conversationOverlay.parentElement).toBe(panel);
    expect(conversationOverlay.classList.contains("has-dock")).toBe(true);
    expect(window.getComputedStyle(conversationOverlay).gridRow).toBe("3 / 5");
    expect(window.getComputedStyle(dock).paddingTop).toBe("12px");
    expect(window.getComputedStyle(dock).paddingRight).toBe("12px");
    expect(window.getComputedStyle(dock).paddingBottom).toBe("12px");
    expect(window.getComputedStyle(dock).paddingLeft).toBe("12px");
    const providerControl = container.querySelector('button[aria-label="Coding Agent"]') as HTMLElement;
    const modelControl = container.querySelector('button[aria-label="Agent model"]') as HTMLElement;
    const sendControl = container.querySelector('button[aria-label="Send message"]') as HTMLElement;
    const composerSurface = container.querySelector(".desktop-agent-composer") as HTMLElement;
    const promptEditor = container.querySelector(".cm-content") as HTMLElement;
    expect(window.getComputedStyle(providerControl).height).toBe("calc(32px - 6px)");
    expect(window.getComputedStyle(sendControl).width).toBe("32px");
    expect(window.getComputedStyle(sendControl).height).toBe("32px");
    expect(window.getComputedStyle(modelControl).height).toBe("32px");
    expect(window.getComputedStyle(composerSurface).cursor).not.toBe("text");
    expect(window.getComputedStyle(promptEditor).cursor).toBe("text");
  });

  it("removes the Agent header region when Minimal Mode supplies no header", () => {
    const container = render(React.createElement(AgentPanelLayout, {
      ariaLabel: "Minimal Agent layout",
      header: null,
      conversation: React.createElement("span", null, "Conversation"),
    }));

    expect(container.querySelector(".desktop-agent-header-region")).toBeNull();
    expect(container.querySelector(".desktop-agent-conversation-region")).not.toBeNull();
  });
});
