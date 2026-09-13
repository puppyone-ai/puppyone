import type { AuxiliaryWorkbenchHistoryBrowserContext } from "../../../../src/features/app-shell/auxiliary-workbench/types";
/**
 * @vitest-environment happy-dom
 */
import { useLocalization } from "@puppyone/localization/react";
import type { Workspace } from "@puppyone/shared-ui";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuxiliaryWorkbenchLauncher } from "../../../../src/features/app-shell/auxiliary-workbench/AuxiliaryWorkbenchLauncher";
import { AuxiliaryWorkbenchPanel } from "../../../../src/features/app-shell/auxiliary-workbench/AuxiliaryWorkbenchPanel";
import { ProjectWorkbenchStore } from "../../../../src/features/app-shell/auxiliary-workbench/ProjectWorkbenchStore";
import type {
  AuxiliaryWorkbenchContribution,
  AuxiliaryWorkbenchPreparationContext,
} from "../../../../src/features/app-shell/auxiliary-workbench/types";
import { createTerminalWorkbenchContribution } from "../../../../src/features/desktop-terminal/workbench/TerminalWorkbenchContribution";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
const stores = new Map<string, ProjectWorkbenchStore>();

function RightTerminalPanel({ workspace, active, hiddenAgentIds, contributions = [] }: {
  workspace: Workspace; active: boolean; hiddenAgentIds: readonly string[]; contributions?: readonly AuxiliaryWorkbenchContribution[];
}) {
  const { t } = useLocalization();
  let store = stores.get(workspace.path);
  if (!store) { store = new ProjectWorkbenchStore({ projectId: workspace.id, rootPath: workspace.path, generation: workspace.id }); stores.set(workspace.path, store); }
  const all = [createTerminalWorkbenchContribution(t, () => { throw new Error("This fixture does not launch terminals"); }), ...contributions];
  return <AuxiliaryWorkbenchPanel key={store.context.generation} store={store} active={active} contributions={all}
    renderLauncher={(context) => <AuxiliaryWorkbenchLauncher {...context} store={store!} contributions={all} hiddenAgentIds={hiddenAgentIds} />} />;
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  stores.forEach((store) => store.dispose()); stores.clear();
  document.body.replaceChildren();
  delete (window as Window & { puppyoneDesktop?: unknown }).puppyoneDesktop;
});

describe("Unified Workbench blank launcher flow", () => {
  it("intersects discovered Agents with the Active Chat visibility settings", async () => {
    installTerminalAgentBridge(["codex", "claude"]);
    const contribution = fakeChatContribution(new Map());
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const render = (hiddenAgentIds: readonly string[]) => withTestLocalization(
      <RightTerminalPanel
        active
        contributions={[contribution]}
        hiddenAgentIds={hiddenAgentIds}
        workspace={WORKSPACE}
      />,
    );
    await act(async () => {
      root?.render(render([]));
    });

    await vi.waitFor(() => expect(document.body.textContent).toContain("Codex"));
    expect(document.body.textContent).toContain("Claude Code");

    act(() => root?.render(render(["claude"])));
    expect(document.body.textContent).not.toContain("Claude Code");
  });

  it("opens the launcher from plus and resolves an Agent choice into a Chat Tab", async () => {
    installTerminalAgentBridge();
    const selectedRecipeByItemId = new Map<string, string>();
    const contribution = fakeChatContribution(selectedRecipeByItemId);
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(withTestLocalization(
        <RightTerminalPanel
          active
          contributions={[contribution]}
          hiddenAgentIds={[]}
          workspace={WORKSPACE}
        />,
      ));
    });

    expect(document.querySelector("[data-agent-mode=\"chat\"]")).not.toBeNull();
    await clickButton("Codex");
    await vi.waitFor(() => {
      expect(document.querySelector('[data-fake-chat="codex"]')).not.toBeNull();
    });
    expect(document.querySelectorAll('[role="tab"]')).toHaveLength(1);
    expect(document.querySelector(
      '[role="tab"] .desktop-terminal-launcher-icon.is-codex',
    )).not.toBeNull();

    const plus = document.querySelector<HTMLButtonElement>('[aria-label="New tab"]');
    expect(plus).not.toBeNull();
    act(() => plus?.click());

    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.querySelectorAll('[role="tab"]')).toHaveLength(2);
    expect(document.querySelector(".desktop-terminal-launcher-group.is-agents")).not.toBeNull();
    expect(document.querySelector(".desktop-terminal-launcher-divider")).not.toBeNull();

    await clickButton("Claude Code");
    await vi.waitFor(() => {
      expect(document.querySelector('[data-fake-chat="claude"]')).not.toBeNull();
      expect(document.querySelector(".desktop-terminal-launcher")).toBeNull();
    });
    expect(document.querySelectorAll('[role="tab"]')).toHaveLength(2);
    expect(document.querySelector(
      '[aria-selected="true"] .desktop-terminal-launcher-icon.is-claude',
    )).not.toBeNull();
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it("uses detected Terminal CLI Agents when the Chat contribution is absent", async () => {
    installTerminalAgentBridge(["codex", "cursor", "hermes"]);
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(withTestLocalization(
        <RightTerminalPanel
          active
          hiddenAgentIds={[]}
          workspace={WORKSPACE}
        />,
      ));
    });

    await vi.waitFor(() => {
      const agentFrame = document.querySelector('[data-agent-mode="terminal"]');
      expect(agentFrame).not.toBeNull();
      expect(agentFrame?.textContent).toContain("Codex");
      expect(agentFrame?.textContent).toContain("Cursor Agent");
      expect(agentFrame?.textContent).toContain("Hermes Agent");
    });
    expect(document.body.textContent).not.toContain("PuppyOne");
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it("keeps multiple blank tabs independent, with neutral icons and in-place promotion", async () => {
    installTerminalAgentBridge();
    const prepared = new Map<string, string>();
    const contribution = fakeChatContribution(prepared);
    const container = document.createElement("div");
    document.body.appendChild(container); root = createRoot(container);
    await act(async () => root?.render(withTestLocalization(<RightTerminalPanel active
      contributions={[contribution]} hiddenAgentIds={[]} workspace={WORKSPACE} />)));
    const store = stores.get(WORKSPACE.path)!;
    act(() => { store.createLauncher(null, "New tab"); });
    const plus = document.querySelector<HTMLButtonElement>('.desktop-terminal-new-button')!;
    await act(async () => { plus.click(); plus.click(); });
    const blanks = store.getSnapshot().topology.items.map((item) => item.id);
    expect(new Set(blanks).size).toBe(3);
    expect(prepared.size).toBe(0);
    expect(document.querySelectorAll('[role="tab"]')).toHaveLength(3);
    expect(document.querySelectorAll('[role="tab"] .lucide-square-dashed')).toHaveLength(3);
    expect(document.querySelector('[role="tab"] .lucide-square-terminal')).toBeNull();
    expect(plus.disabled).toBe(false);

    await clickButton("Chat history");
    expect(document.querySelector('[data-fake-history="true"]')).not.toBeNull();
    expect(store.getSnapshot().snapshots.get(blanks[2])).toMatchObject({ title: "Chat history", iconKey: "history" });
    expect(document.querySelector('[role="tab"][aria-selected="true"] .lucide-history')).not.toBeNull();
    const select = (id: string) => document.querySelector<HTMLButtonElement>(`[data-terminal-tab-session-id="${id}"] [role="tab"]`)!;
    await act(async () => select(blanks[0]).click());
    expect(document.querySelector('[data-fake-history="true"]')).toBeNull();
    await clickButton("Codex");
    const items = store.getSnapshot().topology.items;
    expect(items.map((item) => item.kind)).toEqual(["agent-chat", "launcher", "launcher"]);
    expect(items.slice(1).map((item) => item.id)).toEqual(blanks.slice(1));
    expect(prepared.size).toBe(1);
    expect(store.getHeaderKey(items[0].id)).toBe(blanks[0]);
    expect(document.querySelectorAll('[role="tab"] .lucide-square-dashed')).toHaveLength(1);
    expect(document.querySelectorAll('[role="tab"] .lucide-history')).toHaveLength(1);
    await act(async () => select(blanks[2]).click());
    expect(document.querySelector('[data-fake-history="true"]')).not.toBeNull();
    await clickButton("Back");
    expect(store.getSnapshot().snapshots.get(blanks[2])).toMatchObject({ title: "New tab", iconKey: null });
    expect(store.getHeaderKey(blanks[2])).toBe(blanks[2]);
    const close = document.querySelector<HTMLButtonElement>(`[data-terminal-tab-session-id="${blanks[1]}"] .desktop-terminal-tab-close`)!;
    await act(async () => close.click());
    expect(store.getSnapshot().topology.items.map((item) => item.id)).toEqual([items[0].id, blanks[2]]);
  });

  it("opens global Chat history explicitly and commits a restored Chat only after preparation", async () => {
    installTerminalAgentBridge();
    const preparedByItemId = new Map<string, string>();
    const contribution = fakeChatContribution(preparedByItemId);
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(withTestLocalization(
        <RightTerminalPanel
          active
          contributions={[contribution]}
          hiddenAgentIds={[]}
          workspace={WORKSPACE}
        />,
      ));
    });

    expect(document.querySelector(".desktop-terminal-launcher-group.is-history-entry")).not.toBeNull();
    await clickButton("Chat history");
    expect(document.querySelector('[data-fake-history="true"]')).not.toBeNull();
    expect(document.querySelectorAll('[role="tab"]')).toHaveLength(1);
    expect(document.querySelector('[role="tab"]')?.textContent).toBe("Chat history");
    expect(document.querySelector('[role="tab"] .lucide-history')).not.toBeNull();

    await clickButton("Restore saved chat");
    await vi.waitFor(() => {
      expect(document.querySelector('[data-fake-chat="history:saved-chat"]')).not.toBeNull();
    });
    expect(document.querySelectorAll('[role="tab"]')).toHaveLength(1);
  });
});

const WORKSPACE: Workspace = Object.freeze({
  id: "workspace-a",
  name: "Workspace A",
  path: "/workspace/a",
  status: "recording",
});

function fakeChatContribution(
  selectedRecipeByItemId: Map<string, string>,
): AuxiliaryWorkbenchContribution {
  return Object.freeze({
    kind: "agent-chat",
    label: "Agent Chat",
    createLabel: "New chat",
    creationRecipes: Object.freeze([
      Object.freeze({ id: "codex", label: "Codex", iconKey: "codex", status: "available" as const }),
      Object.freeze({ id: "claude", label: "Claude Code", iconKey: "claude", status: "available" as const }),
    ]),
    initialSnapshot: Object.freeze({
      title: "New chat",
      accessibleLabel: "New chat — Agent Chat",
      detail: "Agent Chat",
      iconKey: null,
      status: "starting" as const,
      running: false,
      resourceId: null,
    }),
    minimumSize: Object.freeze({ width: 320, height: 260 }),
    history: Object.freeze({
      label: "Chat history",
      iconKey: null,
      renderBrowser: ({ onBack, onOpen }: AuxiliaryWorkbenchHistoryBrowserContext) => (
        <div data-fake-history="true">
          <button type="button" onClick={onBack}>Back</button>
          <button
            type="button"
            onClick={() => onOpen({
              id: "saved-chat",
              title: "Saved chat",
              iconKey: "codex",
              payload: { runtimeId: "codex" },
            })}
          >
            Restore saved chat
          </button>
        </div>
      ),
    }),
    prepare: async ({ item, recipe, historyTarget }: AuxiliaryWorkbenchPreparationContext) => {
      selectedRecipeByItemId.set(
        item.id,
        historyTarget ? `history:${historyTarget.id}` : recipe?.id ?? "unknown",
      );
    },
    renderItem: ({ item }) => (
      <div data-fake-chat={selectedRecipeByItemId.get(item.id)}>
        {selectedRecipeByItemId.get(item.id)}
      </div>
    ),
    close: Object.freeze({
      decide: () => Object.freeze({ kind: "close" as const }),
      commit: async () => true,
    }),
  });
}

async function clickButton(label: string) {
  await act(async () => {
    await Promise.resolve();
  });
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
    .find((candidate) => candidate.textContent?.trim() === label);
  expect(button).not.toBeUndefined();
  await act(async () => {
    button?.click();
    await Promise.resolve();
  });
}

function installTerminalAgentBridge(
  availableAgentIds: readonly ("codex" | "claude" | "cursor" | "opencode" | "pi" | "hermes")[] = [
    "codex",
    "claude",
  ],
) {
  Object.defineProperty(window, "puppyoneDesktop", {
    configurable: true,
    value: {
      locateTerminalAgents: vi.fn(async () => ({
        availableAgentIds,
        scannedAt: "2026-08-30T00:00:00.000Z",
        source: "scan",
      })),
      onTerminalAgentLocationProgress: vi.fn(() => () => undefined),
    },
  });
}
