/**
 * @vitest-environment happy-dom
 */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AGENT_CHAT_CREATION_RECIPES,
  BUILT_IN_AGENT_CREATION_RECIPE,
  filterAgentChatCreationRecipesByLocalAgentIds,
  localAgentIdForAgentChatRuntime,
} from "../../../../src/features/app-shell/auxiliary-workbench/agentChatCreationRecipes";
import {
  DESKTOP_TERMINAL_LAUNCHERS,
  getDesktopTerminalLauncher,
} from "../../../../src/features/desktop-terminal/model/terminalLaunchers";
import { TerminalLauncher } from "../../../../src/features/desktop-terminal/ui/TerminalLauncher";
import { WorkbenchLauncherIcon } from "../../../../src/features/app-shell/auxiliary-workbench/layout/WorkbenchLauncherIcon";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe("Unified Workbench launcher", () => {
  it.each([false, true])("returns setup focus to the launcher with installed=%s", (installed) => {
    const container = renderLauncher(<TerminalLauncher agentMode="terminal" discoveryPhase="ready"
      availableAgentIds={installed ? ["codex"] : []} onLaunch={vi.fn()} onRefresh={vi.fn()}
      agentSetup={(onReturn) => <button onClick={onReturn}>Close setup</button>} />);
    act(() => findButton(container, "Close setup")?.click());
    expect(document.activeElement).toBe(installed
      ? container.querySelector(".desktop-terminal-launcher-tool") : container.querySelector("h2"));
    expect(container.querySelector(".desktop-terminal-launcher-tools")?.contains(findButton(container, "Close setup")!)).toBe(false);
  });

  it("resolves Pi Workbench chrome through the same brand registry as Local Agents settings", () => {
    const container = renderLauncher(<WorkbenchLauncherIcon iconKey="pi" />);
    const icon = container.querySelector(".desktop-terminal-launcher-icon.is-pi");

    expect(icon).not.toBeNull();
    expect(icon?.classList).not.toContain("is-chat-fallback");
    expect(Array.from(icon?.querySelectorAll("img") ?? [], (image) => image.getAttribute("src")))
      .toEqual([
        "/assets/icons/agents/pi.svg",
        "/assets/icons/agents/pi-dark.svg",
      ]);
  });

  it("uses detected Terminal Agent commands and keeps Terminal in the same launch group", () => {
    const onLaunch = vi.fn();
    const container = renderLauncher(
      <TerminalLauncher
        agentMode="terminal"
        discoveryPhase="ready"
        availableAgentIds={["codex", "claude", "cursor", "opencode", "hermes"]}
        onLaunch={onLaunch}
        onRefresh={vi.fn()}
      />,
    );

    const groups = container.querySelectorAll(".desktop-terminal-launcher-group");
    expect(groups).toHaveLength(1);
    expect(groups[0].classList).toContain("is-agents");
    expect(groups[0].getAttribute("data-agent-mode")).toBe("terminal");
    expect(groups[0].querySelector("h2")?.textContent).toBe("start with an agent");

    const agentButtons = groups[0].querySelectorAll<HTMLButtonElement>(
      ".desktop-terminal-launcher-tool",
    );
    expect(Array.from(agentButtons, (button) => button.textContent)).toEqual([
      "Codex",
      "Claude Code",
      "Cursor Agent",
      "OpenCode",
      "Hermes Agent",
    ]);
    expect(agentButtons[0].getAttribute("aria-label"))
      .toBe("start with an agent: Codex. Run the Codex CLI");
    expect(Array.from(agentButtons, (button) => button.disabled)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);

    const shellButtons = groups[0].querySelectorAll<HTMLButtonElement>(
      ".desktop-terminal-launcher-shell",
    );
    expect(shellButtons).toHaveLength(1);
    expect(shellButtons[0].textContent).toBe("Terminal");
    expect(groups[0].querySelector(".desktop-terminal-launcher-divider")).not.toBeNull();
    expect(container.querySelector(".desktop-terminal-launcher-rail")).toBeNull();
    expect(container.querySelector(".desktop-terminal-launcher-group.is-terminal")).toBeNull();

    act(() => agentButtons[0].click());
    expect(onLaunch).toHaveBeenCalledWith("codex");
    act(() => shellButtons[0].click());
    expect(onLaunch).toHaveBeenCalledWith("shell");
  });

  it("switches the same frame to Chat recipes only in Chat mode", () => {
    const onCreateChat = vi.fn();
    const onLaunch = vi.fn();
    const container = renderLauncher(
      <TerminalLauncher
        agentMode="chat"
        discoveryPhase="ready"
        availableAgentIds={["codex", "claude", "cursor", "opencode", "pi", "workbuddy-china", "workbuddy-international", "hermes"]}
        chatRecipes={AGENT_CHAT_CREATION_RECIPES}
        onCreateChat={onCreateChat}
        onLaunch={onLaunch}
        onRefresh={vi.fn()}
      />,
    );

    const agentGroup = container.querySelector<HTMLElement>(
      ".desktop-terminal-launcher-group.is-agents",
    );
    expect(agentGroup?.getAttribute("data-agent-mode")).toBe("chat");
    const agentButtons = agentGroup?.querySelectorAll<HTMLButtonElement>(
      ".desktop-terminal-launcher-tool",
    ) ?? [];
    expect(Array.from(agentButtons, (button) => button.textContent)).toEqual([
      "Claude Code",
      "Codex",
      "Cursor",
      "Hermes Agent",
      "OpenCode",
      "Pi",
      "WorkBuddy (China)",
      "WorkBuddy (International)",
      "Built-in Agent",
    ]);
    expect(container.textContent).toContain("Built-in Agent");
    expect(Array.from(
      findButton(container, "Built-in Agent")?.querySelectorAll("img") ?? [],
      (image) => image.getAttribute("src"),
    )).toEqual([
      "/assets/icons/agents/built-in-agent.svg",
      "/assets/icons/agents/built-in-agent-dark.svg",
    ]);
    expect(Array.from(
      findButton(container, "WorkBuddy (China)")?.querySelectorAll("img") ?? [],
      (image) => image.getAttribute("src"),
    )).toEqual([
      "/assets/icons/agents/workbuddy.png",
    ]);
    act(() => agentButtons[0]?.click());
    expect(onCreateChat).toHaveBeenCalledWith(AGENT_CHAT_CREATION_RECIPES[0]);
    expect(onLaunch).not.toHaveBeenCalled();

    expect(container.querySelectorAll(".desktop-terminal-launcher-shell")).toHaveLength(1);
    expect(container.textContent).not.toContain("Pi Agent");
    expect(container.textContent).toContain("Hermes Agent");
  });

  it("keeps the full Terminal Agent catalog command-free and renders only detected ids", () => {
    const container = renderLauncher(
      <TerminalLauncher
        agentMode="terminal"
        discoveryPhase="ready"
        availableAgentIds={["hermes", "codex"]}
        onLaunch={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    expect(Array.from(
      container.querySelectorAll<HTMLButtonElement>(".desktop-terminal-launcher-tool"),
      (button) => button.textContent,
    )).toEqual(["Codex", "Hermes Agent"]);
    expect(DESKTOP_TERMINAL_LAUNCHERS.map(({ id }) => id)).toEqual([
      "codex",
      "claude",
      "cursor",
      "opencode",
      "pi",
      "hermes",
      "shell",
    ]);
    expect(DESKTOP_TERMINAL_LAUNCHERS.every((launcher) => !("command" in launcher))).toBe(true);
  });

  it("delays compact feedback outside the Agent list, adds results immediately, and preserves keyed focus", () => {
    vi.useFakeTimers();
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const render = (phase: "loading" | "ready", ids: ("codex" | "claude")[] = []) => withTestLocalization(
      <TerminalLauncher
        agentMode="chat"
        discoveryPhase={phase}
        availableAgentIds={ids}
        chatRecipes={filterAgentChatCreationRecipesByLocalAgentIds(AGENT_CHAT_CREATION_RECIPES, ids)}
        onCreateChat={vi.fn()}
        onLaunch={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    act(() => root?.render(render("loading")));
    const tools = container.querySelector(".desktop-terminal-launcher-tools");
    const builtIn = findButton(container, "Built-in Agent");
    expect(builtIn?.disabled).toBe(false);
    expect(container.querySelector(".desktop-terminal-launcher-discovery")).toBeNull();
    act(() => vi.advanceTimersByTime(199));
    expect(container.querySelector(".desktop-terminal-launcher-discovery")).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(container.querySelectorAll(".desktop-terminal-launcher-discovery")).toHaveLength(1);
    const entries = container.querySelector(".desktop-terminal-launcher-entries");
    const feedback = container.querySelector(".desktop-terminal-launcher-discovery");
    expect(entries?.hasAttribute("aria-busy")).toBe(false);
    expect(tools?.parentElement).toBe(entries);
    expect(feedback?.parentElement).toBe(entries);
    expect(container.querySelector(".desktop-terminal-launcher-bundled")?.parentElement).toBe(entries);
    expect(feedback?.querySelector(".desktop-terminal-launcher-discovery-icon")?.getAttribute("aria-hidden")).toBe("true");
    expect(feedback?.querySelector("button, [tabindex]")).toBeNull();
    expect(tools?.getAttribute("aria-busy")).toBe("true");
    expect(container.querySelector("[role=status]")?.closest("[aria-busy=true]")).toBeNull();
    expect(container.querySelector(".desktop-terminal-launcher-availability")?.textContent)
      .toContain("Checking local agents");
    expect(container.querySelector(".desktop-terminal-launcher-discovery")?.closest("[role=list]")).toBeNull();
    expect(container.querySelector(".desktop-terminal-launcher-discovery")!.compareDocumentPosition(builtIn!))
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(builtIn?.closest("[aria-busy]")).toBeNull();
    expect(container.querySelector(".desktop-terminal-launcher-discovery-count")).toBeNull();
    expect(container.querySelector(".desktop-terminal-launcher-discovery .terminal-activity-grid")).toBeNull();
    const announcement = container.querySelector("[role=status]")?.textContent;
    act(() => root?.render(render("loading", ["codex"])));
    const codexButton = findButton(container, "Codex");
    expect(codexButton?.disabled).toBe(false);
    expect(codexButton?.parentElement?.className).toContain("launcher-discovered");
    codexButton?.focus();
    act(() => root?.render(render("loading", ["codex", "claude"])));
    expect(document.activeElement).toBe(codexButton);
    expect(container.querySelector("[role=status]")?.textContent).toBe(announcement);
    expect(Array.from(tools?.children ?? [], row => row.textContent)).toEqual([
      "Claude Code", "Codex",
    ]);
    expect(findButton(container, "Built-in Agent")).toBe(builtIn);
    act(() => root?.render(render("ready", ["codex", "claude"])));
    expect(container.querySelector(".desktop-terminal-launcher-tools")).toBe(tools);
    expect(findButton(container, "Codex")).toBe(codexButton);
    expect(document.activeElement).toBe(codexButton);
    expect(tools?.getAttribute("aria-busy")).toBe("false");
    expect(container.querySelector(".desktop-terminal-launcher-discovery")).toBeNull();
    expect(container.querySelector("[role=status]")?.textContent).toBe("Agent scan complete");
  });

  it("does not flash or animate a fast cached result or replay entries during refresh", () => {
    vi.useFakeTimers();
    const props = { agentMode: "chat" as const, availableAgentIds: ["codex" as const],
      chatRecipes: filterAgentChatCreationRecipesByLocalAgentIds(AGENT_CHAT_CREATION_RECIPES, ["codex"]),
      onCreateChat: vi.fn(), onLaunch: vi.fn(), onRefresh: vi.fn() };
    const container = renderLauncher(<TerminalLauncher {...props} discoveryPhase="loading" />);
    act(() => root?.render(withTestLocalization(<TerminalLauncher {...props} discoveryPhase="ready" />)));
    act(() => vi.advanceTimersByTime(500));
    expect(container.querySelector(".desktop-terminal-launcher-discovery")).toBeNull();
    const codex = findButton(container, "Codex");
    act(() => root?.render(withTestLocalization(<TerminalLauncher {...props} discoveryPhase="loading" discoveryRefreshing />)));
    act(() => vi.advanceTimersByTime(200));
    expect(container.querySelector(".desktop-terminal-launcher-discovery")?.textContent).toBe("Refreshing agents…");
    expect(container.querySelector(".desktop-terminal-launcher-discovered")).toBeNull();
    expect(findButton(container, "Codex")).toBe(codex);
    act(() => codex?.click());
    expect(props.onCreateChat).toHaveBeenCalledOnce();
  });

  it("shows retryable partial failure, never false empty, and respects hidden installations", () => {
    const props = { agentMode: "chat" as const, availableAgentIds: [],
      chatRecipes: [BUILT_IN_AGENT_CREATION_RECIPE], onCreateChat: vi.fn(), onLaunch: vi.fn(), onRefresh: vi.fn() };
    const container = renderLauncher(<TerminalLauncher {...props} discoveryPhase="ready" discoveryHasFailures />);
    expect(container.querySelector(".desktop-terminal-launcher-discovery")?.textContent).toContain("Could not check all Agents");
    expect(container.textContent).not.toContain("No Agent CLIs found");
    expect(findButton(container, "Built-in Agent")?.disabled).toBe(false);
    act(() => container.querySelector<HTMLButtonElement>(".desktop-terminal-launcher-scan")?.click());
    expect(props.onRefresh).toHaveBeenCalledOnce();
    act(() => root?.render(withTestLocalization(<TerminalLauncher {...props} discoveryPhase="ready" discoveryHasInstallations />)));
    expect(container.querySelector(".desktop-terminal-launcher-discovery")).toBeNull();
    act(() => root?.render(withTestLocalization(<TerminalLauncher {...props} discoveryPhase="ready" />)));
    expect(container.querySelector(".desktop-terminal-launcher-discovery")?.textContent).toBe("No Agent CLIs found");
    act(() => root?.render(withTestLocalization(<TerminalLauncher {...props} discoveryPhase="error" />)));
    expect(container.querySelector(".desktop-terminal-launcher-discovery")?.textContent).toContain("Scan again");
  });

  it.each([false, true])("keeps local feedback and setup above bundled Agents with failed=%s", (failed) => {
    const container = renderLauncher(<TerminalLauncher agentMode="chat" discoveryPhase="ready"
      availableAgentIds={[]} discoveryHasFailures={failed} chatRecipes={[BUILT_IN_AGENT_CREATION_RECIPE]}
      agentSetup={() => <div data-setup>Local setup</div>} onCreateChat={vi.fn()} onLaunch={vi.fn()} onRefresh={vi.fn()} />);
    const bundled = findButton(container, "Built-in Agent")!;
    for (const selector of [".desktop-terminal-launcher-discovery", "[data-setup]"]) {
      expect(container.querySelector(selector)!.compareDocumentPosition(bundled)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    }
  });

  it("starts feedback only when presented and retires entry motion before hidden tabs can replay it", () => {
    vi.useFakeTimers();
    const props = { agentMode: "chat" as const, discoveryPhase: "loading" as const,
      availableAgentIds: [], chatRecipes: [BUILT_IN_AGENT_CREATION_RECIPE],
      onCreateChat: vi.fn(), onLaunch: vi.fn(), onRefresh: vi.fn() };
    const container = renderLauncher(<TerminalLauncher {...props} presented={false} />);
    act(() => vi.advanceTimersByTime(1000));
    expect(container.querySelector(".desktop-terminal-launcher-discovery")).toBeNull();
    act(() => root?.render(withTestLocalization(<TerminalLauncher {...props} />)));
    act(() => vi.advanceTimersByTime(199));
    expect(container.querySelector(".desktop-terminal-launcher-discovery")).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    const found = { ...props, availableAgentIds: ["codex" as const],
      chatRecipes: filterAgentChatCreationRecipesByLocalAgentIds(AGENT_CHAT_CREATION_RECIPES, ["codex"]) };
    act(() => root?.render(withTestLocalization(<TerminalLauncher {...found} />)));
    expect(container.querySelector(".desktop-terminal-launcher-discovered")).not.toBeNull();
    act(() => vi.advanceTimersByTime(160));
    expect(container.querySelector(".desktop-terminal-launcher-discovered")).toBeNull();
    act(() => root?.render(withTestLocalization(<TerminalLauncher {...found} presented={false} />)));
    act(() => root?.render(withTestLocalization(<TerminalLauncher {...found} chatPreparing />)));
    act(() => vi.advanceTimersByTime(200));
    expect(container.querySelector(".desktop-terminal-launcher-discovered")).toBeNull();
    expect(container.querySelectorAll(".desktop-terminal-activity-grid")).toHaveLength(1);
    expect(container.querySelector(".desktop-terminal-launcher-discovery-icon")).not.toBeNull();
    expect(container.querySelector(".desktop-terminal-launcher-discovery-spinner")).toBeNull();
  });

  it("supports a standalone Chat launcher without exposing the Shell frame", () => {
    const container = renderLauncher(
      <TerminalLauncher
        agentMode="chat"
        discoveryPhase="ready"
        availableAgentIds={[]}
        terminalEnabled={false}
        chatRecipes={AGENT_CHAT_CREATION_RECIPES}
        onCreateChat={vi.fn()}
        onLaunch={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    expect(container.querySelector(".desktop-terminal-launcher-group.is-agents")).not.toBeNull();
    expect(container.querySelector(".desktop-terminal-launcher-group.is-shell")).toBeNull();
    expect(container.querySelector("#desktop-terminal-launcher-title")?.textContent)
      .toBe("start with an agent");
  });

  it("keeps local recipes alphabetized while Built-in Agent stays last and independent of discovery", () => {
    expect(AGENT_CHAT_CREATION_RECIPES.map(({ id }) => id)).toEqual([
      "claude",
      "codex",
      "cursor",
      "hermes",
      "opencode-native",
      "pi",
      "workbuddy-china",
      "workbuddy-international",
      "puppyone-agent",
    ]);
    const localRecipes = AGENT_CHAT_CREATION_RECIPES.filter(({ availability }) => availability !== "bundled");
    expect(localRecipes.map(({ label }) => label)).toEqual(
      [...localRecipes.map(({ label }) => label)].sort((left, right) => left.localeCompare(right, "en")),
    );
    expect(AGENT_CHAT_CREATION_RECIPES.at(-1)).toBe(BUILT_IN_AGENT_CREATION_RECIPE);
    expect(BUILT_IN_AGENT_CREATION_RECIPE).toMatchObject({
      id: "puppyone-agent",
      label: "Built-in Agent",
      iconKey: "built-in-agent",
      status: "available",
      availability: "bundled",
    });
    expect(AGENT_CHAT_CREATION_RECIPES).toContain(BUILT_IN_AGENT_CREATION_RECIPE);
    expect(filterAgentChatCreationRecipesByLocalAgentIds(AGENT_CHAT_CREATION_RECIPES, []))
      .toEqual([BUILT_IN_AGENT_CREATION_RECIPE]);
    expect(localAgentIdForAgentChatRuntime("opencode-native")).toBe("opencode");
    expect(getDesktopTerminalLauncher("codex").id).toBe("codex");
    expect(getDesktopTerminalLauncher("hermes").id).toBe("hermes");
  });

  it("mounts the contribution-owned history browser only after explicit navigation", () => {
    const renderBrowser = vi.fn(({ onBack }: { onBack: () => void }) => (
      <button type="button" onClick={onBack}>Back</button>
    ));
    const container = renderLauncher(
      <TerminalLauncher
        agentMode="chat"
        discoveryPhase="ready"
        availableAgentIds={[]}
        chatRecipes={AGENT_CHAT_CREATION_RECIPES}
        history={{ label: "Chat history", iconKey: null, renderBrowser }}
        historyRootId="workspace-a"
        historyRootPath="/workspace/a"
        onCreateChat={vi.fn()}
        onRestoreHistoryTarget={vi.fn(async () => true)}
        onLaunch={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    expect(container.querySelectorAll(".desktop-terminal-launcher-group")).toHaveLength(2);
    expect(renderBrowser).not.toHaveBeenCalled();
    act(() => findButton(container, "Chat history")?.click());
    expect(renderBrowser).toHaveBeenCalledWith(expect.objectContaining({
      rootId: "workspace-a",
      rootPath: "/workspace/a",
    }));
    expect(container.querySelector(".desktop-terminal-launcher.is-history")).not.toBeNull();
    act(() => findButton(container, "Back")?.click());
    expect(container.querySelector(".desktop-terminal-launcher-group.is-agents")).not.toBeNull();
  });

  it("keeps both frames available when a prior Shell start reports an error", () => {
    const container = renderLauncher(
      <TerminalLauncher
        agentMode="chat"
        discoveryPhase="ready"
        availableAgentIds={[]}
        chatRecipes={AGENT_CHAT_CREATION_RECIPES}
        onCreateChat={vi.fn()}
        launchError="The Agent could not start."
        onLaunch={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    expect(container.querySelector('[role="alert"]')?.textContent)
      .toContain("The Agent could not start.");
    expect(container.querySelectorAll(".desktop-terminal-launcher-group")).toHaveLength(1);
  });
});

function renderLauncher(element: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(withTestLocalization(element)));
  return container;
}

function findButton(container: HTMLElement, text: string) {
  return Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
    .find((candidate) => candidate.textContent?.includes(text));
}
