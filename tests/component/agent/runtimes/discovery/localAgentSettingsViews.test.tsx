/**
 * @vitest-environment happy-dom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalAgentsSettingsView } from "../../../../../src/features/local-agents";
import type { AgentActivityProviderStatus } from "../../../../../shared/agent-activity-contract/types";
import { withTestLocalization } from "../../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
  delete window.puppyoneDesktop;
  vi.restoreAllMocks();
});

describe("Local Agent settings views", () => {
  it("uses local product detection and persists only hidden launcher ids", async () => {
    window.puppyoneDesktop = bridge({
      terminalAgents: ["codex", "pi", "workbuddy-china", "workbuddy-international", "hermes"],
    });
    const onChange = vi.fn();
    render(<LocalAgentsSettingsView
      settings={{ hiddenTerminalAgentIds: [], chatHistoryDiscoveryEnabled: false }}
      onChange={onChange}
      onActivityIndicatorsEnabledChange={vi.fn()}
    />);

    await vi.waitFor(() => expect(document.body.textContent).toContain("Codex"));
    expect(document.body.textContent).toContain("Configure local Agents, chat history discovery, and Hooks.");
    expect(document.body.textContent).toContain("Pi Agent");
    expect(document.body.textContent).toContain("WorkBuddy (China)");
    expect(document.body.textContent).toContain("WorkBuddy (International)");
    expect(document.body.textContent).toContain("Hermes Agent");
    expect(document.body.textContent).not.toContain("Built-in Agent");
    expect(Array.from(document.querySelectorAll(".desktop-settings-section-header h2")).map((heading) => heading.textContent))
      .toEqual(["Local Agents"]);
    expect(Array.from(document.querySelectorAll(".desktop-local-agent-group-title")).map((heading) => heading.textContent))
      .toEqual(["Active Chat", "Chat History", "Hooks"]);
    expect(document.querySelectorAll(".desktop-local-agent-settings-group")).toHaveLength(3);
    expect(document.querySelectorAll(".desktop-local-agent-settings-table")).toHaveLength(3);
    expect(document.querySelectorAll(".desktop-local-agent-identity > .desktop-terminal-launcher-icon").length)
      .toBeGreaterThanOrEqual(5);
    expect(document.querySelectorAll(".desktop-local-agent-name")).toHaveLength(5);
    expect(document.querySelector(".desktop-local-agent-row-copy strong")).toBeNull();
    const codexSwitch = checkbox("Show Codex");
    expect(codexSwitch.checked).toBe(true);

    act(() => codexSwitch.click());
    expect(onChange).toHaveBeenCalledWith({
      hiddenTerminalAgentIds: ["codex"],
      chatHistoryDiscoveryEnabled: false,
    });

    const historySwitch = checkbox("Discover local Agent chat history");
    expect(historySwitch.checked).toBe(false);
    act(() => historySwitch.click());
    expect(onChange).toHaveBeenCalledWith({
      hiddenTerminalAgentIds: [],
      chatHistoryDiscoveryEnabled: true,
    });
  });

  it("shows Hook enrollment as the third settings group and installs one provider at a time", async () => {
    const initial = [
      provider("codex", "Codex", true, "not-configured"),
      provider("claude", "Claude Code", true, "enabled"),
      provider("opencode", "OpenCode", false, "basic-only"),
    ];
    const installed = initial.map((entry) => (
      entry.providerId === "codex" ? { ...entry, enrollment: "enabled" as const } : entry
    ));
    const getEnrollment = vi.fn()
      .mockResolvedValueOnce(enrollment(initial))
      .mockResolvedValue(enrollment(installed));
    const setEnrollment = vi.fn(async () => ({ enrollment: "enabled" }));
    window.puppyoneDesktop = bridge({
      terminalAgents: ["codex", "claude", "opencode"],
      getEnrollment,
      setEnrollment,
    });
    const onActivityIndicatorsEnabledChange = vi.fn();
    render(<LocalAgentsSettingsView
      settings={{ hiddenTerminalAgentIds: [], chatHistoryDiscoveryEnabled: false }}
      onChange={vi.fn()}
      onActivityIndicatorsEnabledChange={onActivityIndicatorsEnabledChange}
    />);

    await vi.waitFor(() => expect(document.querySelectorAll(".desktop-local-agent-hook-option")).toHaveLength(2));
    expect(document.body.textContent).not.toContain("PuppyOne Hook installed");
    expect(document.body.textContent).not.toContain("PuppyOne Hook not installed");
    expect(document.body.textContent).not.toContain("Manual Hook setup");
    expect(document.querySelectorAll(".desktop-utility-view")).toHaveLength(1);
    expect(document.querySelector(".desktop-local-agent-hooks-section")).not.toBeNull();
    expect(document.querySelector(".desktop-local-agent-hooks-disclosure")).toBeNull();
    expect(document.querySelector(".desktop-local-agent-hooks-chevron")).toBeNull();
    expect(document.querySelector(".desktop-local-agent-hooks-manage")).toBeNull();
    expect(document.querySelectorAll(".desktop-local-agent-hook-option")).toHaveLength(2);
    expect(document.querySelector(".desktop-local-agent-row-copy small")).toBeNull();

    await act(async () => {
      checkbox("Install the PuppyOne Hook for Codex").click();
      await nextTask();
    });

    expect(setEnrollment).toHaveBeenCalledWith({ providerId: "codex", enabled: true });
    expect(onActivityIndicatorsEnabledChange).toHaveBeenCalledWith(true);
  });
});

function render(element: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(withTestLocalization(element)));
}

function checkbox(label: string) {
  const input = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
    .find((candidate) => candidate.getAttribute("aria-label") === label);
  if (!input) throw new Error(`Missing checkbox: ${label}`);
  return input;
}

function bridge({
  terminalAgents,
  getEnrollment = vi.fn(async () => enrollment([])),
  setEnrollment = vi.fn(async () => ({ enrollment: "enabled" })),
}: {
  terminalAgents: string[];
  getEnrollment?: ReturnType<typeof vi.fn>;
  setEnrollment?: ReturnType<typeof vi.fn>;
}) {
  return {
    discoverLocalAgentInstallations: vi.fn(async () => ({
      schemaVersion: 1,
      generation: 1,
      scanId: "local-agent-scan:1",
      availableAgentIds: terminalAgents,
      requestedAt: new Date(0).toISOString(),
      completedAt: new Date(1).toISOString(),
      results: terminalAgents.map((agentId) => ({
        agentId,
        displayName: agentId,
        status: "found",
        source: "fixture",
      })),
      source: "scan",
    })),
    onLocalAgentInstallationProgress: vi.fn(() => () => {}),
    onLocalAgentInstallationsChanged: vi.fn(() => () => {}),
    getAgentActivityEnrollment: getEnrollment,
    setAgentActivityEnrollment: setEnrollment,
  } as unknown as typeof window.puppyoneDesktop;
}

function provider(
  providerId: string,
  displayName: string,
  configurable: boolean,
  enrollmentState: AgentActivityProviderStatus["enrollment"],
): AgentActivityProviderStatus {
  return {
    providerId,
    displayName,
    configurable,
    enrollment: enrollmentState,
  };
}

function enrollment(providers: readonly AgentActivityProviderStatus[]) {
  return { schemaVersion: 1 as const, providers };
}

function nextTask() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}
