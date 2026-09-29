/**
 * @vitest-environment happy-dom
 */
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesktopTitlebarActions } from "../../../../src/features/app-shell/DesktopTitlebarActions";
import {
  HEADER_COACHMARKS_STORAGE_KEY,
  readHeaderCoachmarkProgress,
  useHeaderCoachmarks,
  type HeaderCoachmarkId,
} from "../../../../src/features/app-shell/headerCoachmarks";
import { parseTitlebarActionsSettings } from "../../../../src/preferences";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("contextual Header coachmarks", () => {
  it("offers Agent discovery once without opening the sidebar for the user", () => {
    const updates: Array<HeaderCoachmarkId | null> = [];
    const render = mountHook((active) => updates.push(active));

    render({ workspaceEntryId: null, workspaceScopeId: null, agentOpen: false, changesOpen: false, localChangeCount: null });
    render({ workspaceEntryId: "entry-one", workspaceScopeId: "workspace-one", agentOpen: false, changesOpen: false, localChangeCount: null });

    expect(updates.at(-1)).toBe("agent");
    expect(readHeaderCoachmarkProgress()).toEqual({ agent: false, changes: false });

    render({ workspaceEntryId: "entry-one", workspaceScopeId: "workspace-one", agentOpen: true, changesOpen: false, localChangeCount: null });
    expect(updates.at(-1)).toBeNull();
    expect(readHeaderCoachmarkProgress()).toEqual({ agent: true, changes: false });
  });

  it("waits for a real zero-to-dirty transition before offering Changes", () => {
    const updates: Array<HeaderCoachmarkId | null> = [];
    const render = mountHook((active) => updates.push(active));

    render({ workspaceEntryId: null, workspaceScopeId: "workspace-one", agentOpen: false, changesOpen: false, localChangeCount: 4 });
    expect(updates.at(-1)).toBeNull();

    render({ workspaceEntryId: null, workspaceScopeId: "workspace-one", agentOpen: false, changesOpen: false, localChangeCount: 0 });
    render({ workspaceEntryId: null, workspaceScopeId: "workspace-one", agentOpen: false, changesOpen: false, localChangeCount: 1 });
    expect(updates.at(-1)).toBe("changes");
  });

  it("queues Changes behind Agent when the first edit happens before dismissal", () => {
    const updates: Array<HeaderCoachmarkId | null> = [];
    const render = mountHook((active) => updates.push(active));

    render({ workspaceEntryId: "entry-one", workspaceScopeId: "workspace-one", agentOpen: false, changesOpen: false, localChangeCount: 0 });
    render({ workspaceEntryId: "entry-one", workspaceScopeId: "workspace-one", agentOpen: false, changesOpen: false, localChangeCount: 1 });
    expect(updates.at(-1)).toBe("agent");

    render({ workspaceEntryId: "entry-one", workspaceScopeId: "workspace-one", agentOpen: true, changesOpen: false, localChangeCount: 1 });
    expect(updates.at(-1)).toBe("changes");
  });

  it("does not treat switching to an already-dirty workspace as a new edit", () => {
    window.localStorage.setItem(
      HEADER_COACHMARKS_STORAGE_KEY,
      JSON.stringify({ agent: true, changes: false }),
    );
    const updates: Array<HeaderCoachmarkId | null> = [];
    const render = mountHook((active) => updates.push(active));

    render({ workspaceEntryId: null, workspaceScopeId: "workspace-one", agentOpen: false, changesOpen: false, localChangeCount: 0 });
    render({ workspaceEntryId: null, workspaceScopeId: "workspace-two", agentOpen: false, changesOpen: false, localChangeCount: 7 });
    expect(updates.at(-1)).toBeNull();
  });

  it("replays both coachmarks without consuming one-time progress when the experiment is on", () => {
    const updates: Array<HeaderCoachmarkId | null> = [];
    const render = mountHook((active) => updates.push(active));

    render({
      agentOpen: false,
      alwaysShow: true,
      changesOpen: false,
      localChangeCount: 3,
      workspaceEntryId: null,
      workspaceScopeId: "workspace-one",
    });
    expect(updates.at(-1)).toBe("agent");

    render({
      agentOpen: true,
      alwaysShow: true,
      changesOpen: false,
      localChangeCount: 3,
      workspaceEntryId: null,
      workspaceScopeId: "workspace-one",
    });
    expect(updates.at(-1)).toBe("changes");
    expect(readHeaderCoachmarkProgress()).toEqual({ agent: false, changes: false });

    render({
      agentOpen: false,
      alwaysShow: true,
      changesOpen: true,
      localChangeCount: 3,
      workspaceEntryId: null,
      workspaceScopeId: "workspace-one",
    });
    expect(updates.at(-1)).toBeNull();

    render({
      agentOpen: false,
      alwaysShow: true,
      changesOpen: false,
      localChangeCount: 0,
      workspaceEntryId: null,
      workspaceScopeId: "workspace-one",
    });
    render({
      agentOpen: false,
      alwaysShow: true,
      changesOpen: false,
      localChangeCount: 1,
      workspaceEntryId: null,
      workspaceScopeId: "workspace-one",
    });
    expect(updates.at(-1)).toBe("changes");
  });

  it("persists dismissal and renders the Agent action as a non-modal anchored dialog", async () => {
    const onAcknowledge = vi.fn();
    const onToggleAgent = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    await act(async () => {
      root?.render(withTestLocalization(
        <DesktopTitlebarActions
          titlebarActionsSettings={parseTitlebarActionsSettings(null)}
          terminalSidebarOpen={false}
          terminalToolEnabled
          onToggleTerminal={onToggleAgent}
          activeCoachmark="agent"
          onAcknowledgeCoachmark={onAcknowledge}
        />,
      ));
      await Promise.resolve();
    });

    const dialog = document.querySelector<HTMLElement>(".desktop-header-coachmark");
    expect(dialog?.getAttribute("role")).toBe("dialog");
    expect(dialog?.textContent).toContain("Work with an Agent");
    expect(host.querySelector('[data-coachmark-feature="agent"]')?.getAttribute("data-coachmark-active")).toBe("true");

    const choose = Array.from(dialog?.querySelectorAll<HTMLButtonElement>("button") ?? [])
      .find((button) => button.textContent === "Choose an Agent");
    act(() => choose?.click());
    expect(onAcknowledge).toHaveBeenCalledWith("agent");
    expect(onToggleAgent).toHaveBeenCalledOnce();
  });

  it("recovers from malformed stored progress", () => {
    window.localStorage.setItem(HEADER_COACHMARKS_STORAGE_KEY, "not-json");
    expect(readHeaderCoachmarkProgress()).toEqual({ agent: false, changes: false });
  });
});

type HookProps = Parameters<typeof useHeaderCoachmarks>[0];

function mountHook(onUpdate: (active: HeaderCoachmarkId | null) => void) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  return (props: HookProps) => {
    act(() => root?.render(<HookHarness {...props} onUpdate={onUpdate} />));
  };
}

function HookHarness({ onUpdate, ...props }: HookProps & { onUpdate: (active: HeaderCoachmarkId | null) => void }) {
  const coachmarks = useHeaderCoachmarks(props);
  useEffect(() => {
    onUpdate(coachmarks.active);
  }, [coachmarks.active, onUpdate]);
  return null;
}
