/** @vitest-environment happy-dom */

import React from "react";

import { act } from "react";
import { describe, expect, it, vi } from "vitest";

import { AgentComposer } from "../../../../src/features/desktop-agent/ui/AgentComposer";

import { AgentPickerPopover } from "../../../../src/features/desktop-agent/ui/AgentPickerPopover";
import { AgentRuntimePicker } from "../../../../src/features/desktop-agent/ui/AgentRuntimePicker";
import { AgentSurfaceHeader } from "../../../../src/features/desktop-agent/ui/AgentSurfaceHeader";
import { agentPickerLimits } from "../../../../src/features/desktop-agent/ui/agent-picker-limits";

import { listAgentRuntimes, listEnabledAgentRuntimes, listVisibleAgentRuntimes } from "../../../../src/features/desktop-agent/domain/agent-backend-routing";

import { modelSessionControl, render, runtimeEntry } from "../../../support/agent/rendererHarness";
import { stripBidiIsolation } from "../../../support/react/localization";

describe("Desktop Agent renderer surfaces", () => {

  it("hides the configured Model in Minimal Mode without removing the composer", () => {
    const container = render(React.createElement(AgentComposer, {
      draft: "Continue",
      onDraftChange: vi.fn(),
      disabled: false,
      hideConfiguration: true,
      running: false,
      stopping: false,
      submitting: false,
      placeholder: "Ask anything",
      sessionControls: modelSessionControl([{ model: "gpt-5", displayName: "GPT-5" }], "gpt-5"),
      onSubmit: vi.fn(async () => true),
      onStop: vi.fn(),
    }));

    expect(container.querySelector('button[aria-label="Agent model"]')).toBeNull();
    expect(stripBidiIsolation(container.querySelector(".cm-content")?.getAttribute("aria-label"))).toBe("Message Agent");
    expect(container.querySelector('button[aria-label="Send message"]')).not.toBeNull();
  });

  it("keeps the session-level Agent in the header and only Model in the composer", () => {
    const runtimePicker = React.createElement(AgentRuntimePicker, {
      agentRuntimes: [runtimeEntry("codex", "Codex")],
      selectedRuntimeId: "codex",
      onSelectRuntime: vi.fn(),
    });
    const container = render(React.createElement("div", null,
      React.createElement(AgentSurfaceHeader, {
        title: "New chat",
        runtimeLabel: "Codex",
        statusCode: "ready",
        statusLabel: "ready",
        loading: false,
        newSessionDisabled: false,
        onNewSession: vi.fn(),
        agentSelector: runtimePicker,
      }),
      React.createElement(AgentComposer, {
        draft: "",
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
    ));

    expect(container.querySelector("select")).toBeNull();
    const runtimeTrigger = container.querySelector('button[aria-label="Coding Agent"]') as HTMLButtonElement;
    const composer = container.querySelector(".desktop-agent-composer") as HTMLElement;
    expect(container.querySelector('button[aria-label="Agent backend"]')).toBeNull();
    expect(runtimeTrigger.classList.contains("is-compact")).toBe(false);
    expect(runtimeTrigger.title).toContain("Switching Agent starts a new chat");
    expect(runtimeTrigger.querySelector(".desktop-agent-brand-mark")).not.toBeNull();
    expect(runtimeTrigger.textContent).toContain("Codex");
    expect(composer.querySelector('button[aria-label="Coding Agent"]')).toBeNull();
    expect(container.textContent).not.toContain("Google");
    expect(container.querySelector('button[aria-label="Agent model"]')?.textContent).toContain("GPT");
    expect(container.textContent).not.toContain("OpenCode runtime");
    expect(container.querySelector(".cm-content")?.getAttribute("aria-multiline")).toBe("true");
    expect(container.querySelectorAll(".cm-editor")).toHaveLength(1);
    expect(container.querySelector(".desktop-agent-composer-row")).not.toBeNull();
    expect(container.querySelector(".desktop-agent-composer-input-row button[aria-label='Send message']")).toBeNull();
    expect(container.querySelector(".desktop-agent-composer-trailing button[aria-label='Send message']")).not.toBeNull();
    expect(container.querySelector(".desktop-agent-composer-trailing button[aria-label='Agent model']")).not.toBeNull();
    expect(container.querySelector('button[aria-label="Add context or change Agent mode"]')).toBeNull();
  });

  it("preserves registry-provided Agent products without provider-specific UI filtering", () => {
    const providers = listAgentRuntimes({
      runtimes: [
        {
          descriptor: { id: "custom-agent", displayName: "Custom Agent", distribution: "bundled" },
          readiness: { runtimeId: "custom-agent", provider: "custom-agent", status: "ready", code: "READY", version: "1.0.0", minimumVersion: null, message: "Ready" },
        },
        runtimeEntry("codex", "Codex"),
        runtimeEntry("claude", "Claude Agent"),
        runtimeEntry("opencode-native", "OpenCode"),
        runtimeEntry("cursor", "Cursor Agent"),
      ],
      selectedRuntimeId: "custom-agent",
      runtime: { id: "custom-agent", displayName: "Custom Agent", distribution: "bundled" },
      readiness: { runtimeId: "custom-agent", provider: "custom-agent", status: "ready", code: "READY", version: "1.0.0", minimumVersion: null, message: "Ready" },
      account: null,
      models: [],
      capabilities: null,
      warnings: [],
    });

    expect(providers.map((entry) => entry.descriptor.displayName)).toEqual([
      "Custom Agent",
      "Codex",
      "Claude Agent",
      "OpenCode",
      "Cursor Agent",
    ]);
  });

  it("shows only locally selected and still-installed Coding Agents", () => {
    const inspection = {
      runtimes: [
        runtimeEntry("codex", "Codex"),
        runtimeEntry("claude", "Claude Agent"),
        runtimeEntry("opencode-native", "OpenCode"),
        {
          ...runtimeEntry("cursor", "Cursor Agent"),
          readiness: {
            ...runtimeEntry("cursor", "Cursor Agent").readiness,
            status: "not-installed" as const,
          },
        },
      ],
      readiness: runtimeEntry("codex", "Codex").readiness,
      account: null,
      models: [],
      capabilities: null,
      warnings: [],
    };

    expect(listEnabledAgentRuntimes(inspection, ["claude", "opencode-native", "cursor"])
      .map((entry) => entry.descriptor.id)).toEqual(["claude", "opencode-native"]);
    expect(listVisibleAgentRuntimes(inspection, ["claude"])
      .map((entry) => entry.descriptor.id)).toEqual(["codex", "opencode-native"]);
  });

  it("shows Agent in the header and withholds Model until a connected runtime is selected", () => {
    const container = render(React.createElement("div", null,
      React.createElement(AgentSurfaceHeader, {
        title: "New chat",
        statusCode: "checking",
        statusLabel: "checking",
        loading: false,
        newSessionDisabled: true,
        onNewSession: vi.fn(),
        agentSelector: React.createElement(AgentRuntimePicker, {
          agentRuntimes: [runtimeEntry("codex", "Codex"), runtimeEntry("claude", "Claude Agent")],
          selectedRuntimeId: null,
          onSelectRuntime: vi.fn(),
        }),
      }),
      React.createElement(AgentComposer, {
        draft: "Hello",
        onDraftChange: vi.fn(),
        disabled: true,
        running: false,
        stopping: false,
        submitting: false,
        placeholder: "Choose a provider to start",
        sessionControls: [],
        onSubmit: vi.fn(async () => false),
        onStop: vi.fn(),
      }),
    ));

    expect(container.querySelector("select")).toBeNull();
    expect(container.querySelector('button[aria-label="Coding Agent"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Agent model"]')).toBeNull();
    expect(container.textContent).not.toContain("Agent model");
    expect((container.querySelector('button[aria-label="Send message"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it("updates the visible Agent and Model labels after pointer selection", () => {
    const catalogs = {
      codex: [
        { id: "gpt-5", model: "gpt-5", displayName: "GPT-5", description: "Native Codex model", isDefault: true },
      ],
      claude: [
        { id: "claude-sonnet", model: "claude-sonnet", displayName: "Claude Sonnet", description: "Native Claude Agent model", isDefault: true },
        { id: "claude-opus", model: "claude-opus", displayName: "Claude Opus", description: "Native Claude Agent model", isDefault: false },
      ],
    };

    function StatefulSurface() {
      const [runtime, setRuntime] = React.useState<keyof typeof catalogs>("codex");
      const [model, setModel] = React.useState(catalogs.codex[0].model);
      const models = catalogs[runtime];
      const onSelectRuntime = (nextRuntime: string) => {
          const typedRuntime = nextRuntime as keyof typeof catalogs;
          setRuntime(typedRuntime);
          setModel(catalogs[typedRuntime][0].model);
      };
      return React.createElement("div", null,
        React.createElement(AgentSurfaceHeader, {
          title: "New chat",
          runtimeLabel: runtime,
          statusCode: "ready",
          statusLabel: "ready",
          loading: false,
          newSessionDisabled: false,
          onNewSession: vi.fn(),
          agentSelector: React.createElement(AgentRuntimePicker, {
            agentRuntimes: [runtimeEntry("codex", "Codex"), runtimeEntry("claude", "Claude Agent")],
            selectedRuntimeId: runtime,
            onSelectRuntime,
          }),
        }),
        React.createElement(AgentComposer, {
          draft: "",
          onDraftChange: vi.fn(),
          disabled: false,
          running: false,
          stopping: false,
          submitting: false,
          placeholder: "Ask anything",
          sessionControls: modelSessionControl(models, model),
          onSelectSessionControl: (id, value) => {
            if (id === "model") setModel(value);
          },
          onSubmit: vi.fn(async () => true),
          onStop: vi.fn(),
        }),
      );
    }

    const container = render(React.createElement(StatefulSurface));
    const runtimeTrigger = container.querySelector('button[aria-label="Coding Agent"]') as HTMLButtonElement;
    expect(runtimeTrigger.textContent).toContain("Codex");
    act(() => runtimeTrigger.click());
    const claude = Array.from(document.querySelectorAll('[role="option"]'))
      .find((option) => option.textContent?.includes("Claude Agent")) as HTMLButtonElement;
    act(() => claude.click());
    expect(runtimeTrigger.textContent).toContain("Claude Agent");

    const modelTrigger = container.querySelector('button[aria-label="Agent model"]') as HTMLButtonElement;
    expect(modelTrigger.textContent).toContain("Claude Sonnet");
    expect(modelTrigger.querySelector("svg")).toBeNull();
    act(() => modelTrigger.click());
    const opus = Array.from(document.querySelectorAll('[role="option"]'))
      .find((option) => option.textContent?.includes("Claude Opus")) as HTMLButtonElement;
    act(() => opus.click());
    expect(modelTrigger.textContent).toContain("Claude Opus");
  });

  it("keeps a large model catalog searchable while bounding mounted picker options", () => {
    const options = Array.from({ length: 500 }, (_, index) => ({
      id: `provider/model-${index}`,
      label: `Model ${index}`,
      description: `Connected model ${index}`,
      selectable: true,
      kind: "model" as const,
    }));
    const container = render(React.createElement(AgentPickerPopover, {
      ariaLabel: "Agent model",
      placeholder: "Choose model",
      groups: [{ id: "models", label: "Models", options }],
      onSelect: vi.fn(),
    }));
    act(() => (container.querySelector('[aria-label="Agent model"]') as HTMLButtonElement).click());
    const overlay = document.querySelector(".desktop-agent-picker-popover") as HTMLElement;
    expect(overlay.closest("#desktop-overlay-root")).not.toBeNull();
    expect(container.querySelector('[role="listbox"]')).toBeNull();
    expect(overlay.querySelectorAll('[role="option"]')).toHaveLength(agentPickerLimits.maxRenderedOptions);
    expect(overlay.textContent).toContain("Showing 120 of 500");

    const input = overlay.querySelector<HTMLInputElement>('.desktop-agent-picker-search input')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "Model 499");
      input.dispatchEvent(new InputEvent("input", { bubbles: true, data: "Model 499" }));
    });
    expect(overlay.querySelectorAll('[role="option"]')).toHaveLength(1);
    expect(overlay.textContent).toContain("Model 499");
  });

  it("renders one flat coding-Agent menu and keeps detected runtimes selectable with one warning", () => {
    const onSelectRuntime = vi.fn();
    const container = render(React.createElement(AgentRuntimePicker, {
      agentRuntimes: [
        {
          descriptor: { id: "codex", displayName: "Codex", iconKey: "codex", distribution: "user-installed" },
          readiness: { runtimeId: "codex", provider: "codex", status: "ready", code: "READY", version: "0.144.1", minimumVersion: null, message: "Native login ready", selectable: true },
        },
        {
          descriptor: { id: "cursor", displayName: "Cursor Agent", iconKey: "cursor", distribution: "user-installed" },
          readiness: { runtimeId: "cursor", provider: "cursor", status: "protocol-unavailable", code: "PROTOCOL_UNAVAILABLE", version: "1.0.0", minimumVersion: null, message: "Native protocol unavailable", selectable: false },
        },
      ],
      selectedRuntimeId: null,
      onSelectRuntime: onSelectRuntime,
    }));

    const trigger = container.querySelector('button[aria-label="Coding Agent"]') as HTMLButtonElement;
    act(() => trigger.click());
    const popup = document.querySelector(".desktop-agent-picker-list[role='listbox']") as HTMLElement;
    expect(popup).not.toBeNull();
    expect((popup.closest(".desktop-agent-picker-popover") as HTMLElement).dataset.positioned).toBe("true");
    expect(popup.textContent).not.toContain("Coding Agents");
    expect(popup.textContent).not.toContain("Detected");
    expect(popup.textContent).not.toContain("Refresh");
    expect(popup.querySelectorAll('[role="group"]')).toHaveLength(0);
    const cursor = Array.from(popup.querySelectorAll('[role="option"]')).find((option) => option.textContent?.includes("Cursor Agent")) as HTMLButtonElement;
    expect(cursor.getAttribute("aria-disabled")).toBeNull();
    expect(cursor.querySelector(".desktop-agent-picker-warning")).not.toBeNull();
    expect(cursor.querySelector(".desktop-agent-picker-warning")?.getAttribute("title")).toContain("Native protocol unavailable");
    expect(popup.textContent).not.toContain("Native protocol unavailable");
    act(() => cursor.click());
    expect(onSelectRuntime).toHaveBeenCalledWith("cursor");
    expect(document.querySelector('[role="listbox"][aria-label="Coding Agent options"]')).toBeNull();
  });

  it("supports Arrow, Enter and Escape with focus return in the custom Agent picker", async () => {
    const onSelectRuntime = vi.fn();
    const container = render(React.createElement(AgentRuntimePicker, {
      agentRuntimes: [
        runtimeEntry("codex", "Codex"),
        runtimeEntry("claude", "Claude Agent"),
      ],
      selectedRuntimeId: null,
      onSelectRuntime,
    }));
    const trigger = container.querySelector('button[aria-label="Coding Agent"]') as HTMLButtonElement;
    act(() => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect((document.activeElement as HTMLElement).textContent).toContain("Codex");
    act(() => document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    expect((document.activeElement as HTMLElement).textContent).toContain("Claude Agent");
    act(() => document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(onSelectRuntime).toHaveBeenCalledWith("claude");
    expect(document.activeElement).toBe(trigger);

    act(() => trigger.click());
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(document.querySelector('[role="listbox"][aria-label="Coding Agent options"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
