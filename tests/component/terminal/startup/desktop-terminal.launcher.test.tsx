/**
 * @vitest-environment happy-dom
 */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AGENT_CHAT_CREATION_RECIPES,
  PUPPYONE_AGENT_CREATION_RECIPE,
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
});

describe("Unified Workbench launcher", () => {
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
        availableAgentIds={["codex", "claude", "cursor", "opencode", "pi", "workbuddy", "hermes"]}
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
      "PuppyOne",
      "WorkBuddy",
    ]);
    expect(container.textContent).toContain("PuppyOne");
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

  it("keeps discovery progress assistive and the vertical Agent list layout-stable", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const render = (phase: "loading" | "ready") => withTestLocalization(
      <TerminalLauncher
        agentMode="chat"
        discoveryPhase={phase}
        availableAgentIds={phase === "ready" ? ["codex"] : []}
        chatRecipes={AGENT_CHAT_CREATION_RECIPES}
        onCreateChat={vi.fn()}
        onLaunch={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    act(() => root?.render(render("loading")));
    const tools = container.querySelector(".desktop-terminal-launcher-tools");
    const codexButton = findButton(container, "Codex");
    expect(container.querySelector(".desktop-terminal-launcher-scan")?.classList)
      .toContain("is-scanning");
    expect(container.querySelector(".desktop-terminal-launcher-availability")?.textContent)
      .toContain("Looking for installed Agents");

    act(() => root?.render(render("ready")));
    expect(container.querySelector(".desktop-terminal-launcher-tools")).toBe(tools);
    expect(findButton(container, "Codex")).toBe(codexButton);
    expect(findButton(container, "Codex")?.disabled).toBe(false);
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

  it("keeps recipes alphabetized while the managed PuppyOne recipe stays independent of local discovery", () => {
    expect(AGENT_CHAT_CREATION_RECIPES.map(({ id }) => id)).toEqual([
      "claude",
      "codex",
      "cursor",
      "hermes",
      "opencode-native",
      "pi",
      "puppyone-agent",
      "workbuddy",
    ]);
    expect(AGENT_CHAT_CREATION_RECIPES.map(({ label }) => label)).toEqual(
      [...AGENT_CHAT_CREATION_RECIPES.map(({ label }) => label)].sort((left, right) => left.localeCompare(right, "en")),
    );
    expect(PUPPYONE_AGENT_CREATION_RECIPE).toMatchObject({
      id: "puppyone-agent",
      status: "available",
      availability: "bundled",
    });
    expect(AGENT_CHAT_CREATION_RECIPES).toContain(PUPPYONE_AGENT_CREATION_RECIPE);
    expect(filterAgentChatCreationRecipesByLocalAgentIds(AGENT_CHAT_CREATION_RECIPES, []))
      .toEqual([PUPPYONE_AGENT_CREATION_RECIPE]);
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
