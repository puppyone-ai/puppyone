/** @vitest-environment happy-dom */
import { act, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../../../src/App";
import type { DesktopCloudShell } from "../../../../src/components/DesktopCloudShell";
import type { RightSidebarSurface } from "../../../../src/features/app-shell/preferences";
import { withTestLocalization } from "../../../support/react/localization";

const state = vi.hoisted(() => ({
  cloudActive: false,
  contentVisible: true,
  sidebarSurface: "chat" as RightSidebarSurface,
  noop: () => {},
  project: { context: { generation: "retained-project" } },
  workspace: { id: "project", name: "Project", path: "/fixture/project", status: "recording" },
}));

// Execute App's real composition. Control only its external state and capture
// the shell/panel boundary; sidebarVisibility.integration covers the panel's
// downstream presentation, command-target, inertness and resource lifecycle.
vi.mock("../../../../src/components/DesktopCloudShell", () => ({
  DesktopCloudShell: ({ rightSidebar, rightSidebarOpen }: ComponentProps<typeof DesktopCloudShell>) => (
    <div data-sidebar-open={String(rightSidebarOpen)}>
      {typeof rightSidebar === "function" && rightSidebar({
        contentVisible: state.contentVisible, contentExpanded: state.contentVisible,
        settledCollapsed: !state.contentVisible, phase: state.contentVisible ? "expanded" : "collapsed",
      })}
    </div>
  ),
}));
vi.mock("../../../../src/features/app-shell/auxiliary-workbench/AuxiliaryWorkbenchPanel", () => ({
  AuxiliaryWorkbenchPanel: ({ active }: { active: boolean }) => <input data-chat-active={String(active)} defaultValue="draft" />,
}));
vi.mock("../../../../src/features/app-shell/useDesktopPreferences", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../../src/features/app-shell/useDesktopPreferences")>();
  return { useDesktopPreferences: () => ({
    ...original.useDesktopPreferences(),
    rightSidebarOpen: true,
    rightSidebarSurface: state.sidebarSurface,
  }) };
});
vi.mock("../../../../src/features/app-shell/useWorkspaceLifecycle", () => ({
  useWorkspaceLifecycle: () => ({ workspace: state.workspace, workbenchWorkspace: null, workspaces: [], recentWorkspaceItems: [] }),
}));
vi.mock("../../../../src/features/app-shell/project-sessions/useProjectSession", () => ({ useProjectSession: () => state.project }));
vi.mock("../../../../src/features/cloud/workbench/useAccountCloudWorkspace", () => ({
  useAccountCloudWorkspace: () => ({ active: state.cloudActive, useLocal: state.noop }),
}));
vi.mock("../../../../src/features/cloud/workbench/useNativeCloudWorkbench", () => ({ useNativeCloudWorkbench: () => ({}) }));
vi.mock("../../../../src/features/cloud/workbench/AccountCloudWorkspaceSurface", () => ({
  AccountCloudWorkspaceSurface: () => null,
  useAccountCloudWorkspacePresentation: () => ({}),
}));
vi.mock("../../../../src/features/cloud/workbench/useRepositoryCloudWorkspaceSwitch", () => ({
  useRepositoryCloudWorkspaceSwitch: () => ({ cancel: state.noop }),
}));
vi.mock("../../../../src/features/cloud/workbench/useHomepageCloudProjects", () => ({ useHomepageCloudProjects: () => ({ items: [] }) }));
vi.mock("../../../../src/features/cloud/hooks/useDesktopCloudSession", () => ({
  useDesktopCloudSession: () => ({ cloudSession: null, cloudAuthStatus: "anonymous", cloudSessionRestoring: false }),
}));
vi.mock("../../../../src/lib/cloudApi", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../../src/lib/cloudApi")>(),
  getDesktopCloudApiBaseUrl: () => "http://127.0.0.1:8000/api/v1",
}));
vi.mock("../../../../src/features/cloud/project/context", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../../src/features/cloud/project/context")>(),
  useCurrentRepositoryCloudContext: () => ({ status: "signed-out" }),
  getResolvedCloudProjectId: () => null,
  getProjectCloudLocationState: () => "signed-out",
}));
vi.mock("../../../../src/features/cloud/initialization/useCloudInitialization", () => ({ useCloudInitialization: () => ({}) }));
vi.mock("../../../../src/features/cloud/share", () => ({
  CloudShareProvider: ({ children }: { children: ReactNode }) => children,
  ShareWizardDialog: () => null,
  useProjectShareActivity: () => ({ shares: [] }),
}));
vi.mock("../../../../src/features/source-control/useDesktopGitController", () => ({
  useDesktopGitController: () => ({
    activeGitStatus: null, setGitOperationError: state.noop, setGitOperationLoading: state.noop,
    setBranchSwitcherOpen: state.noop,
  }),
}));
vi.mock("../../../../src/features/source-control/GitChangesSidebar", () => ({ GitChangesSidebar: () => null }));
vi.mock("../../../../src/features/source-control/GitHistorySidebar", () => ({ GitHistorySidebar: () => null }));
vi.mock("../../../../src/features/app-shell/usePuppyoneConfig", () => ({ usePuppyoneConfig: () => ({}) }));
vi.mock("../../../../src/features/data-workspace/useAiEditReviewRequest", () => ({ useAiEditReviewRequest: () => null }));
vi.mock("../../../../src/features/data-workspace/useDataNodeActions", () => ({
  useDataNodeActions: () => ({ resetDataNodeActions: state.noop }),
}));
vi.mock("../../../../src/features/editor-workbench/controller/useDesktopEditorWorkbench", () => ({
  useDesktopEditorWorkbench: () => ({ state: { editors: [] }, activePath: null }),
}));
vi.mock("../../../../src/features/app-shell/DesktopOverlayPortal", () => ({ DesktopOverlayPortal: () => null }));
vi.mock("../../../../src/features/updates", () => ({ useDesktopUpdates: () => ({}) }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
beforeEach(() => {
  state.cloudActive = false;
  state.contentVisible = true;
  state.sidebarSurface = "chat";
  window.localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("App activation tests must not access the network"); }));
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

async function render() {
  if (!root) {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  }
  await act(async () => root!.render(withTestLocalization(<App />)));
  const chat = document.querySelector<HTMLInputElement>("[data-chat-active]");
  expect(chat).not.toBeNull();
  return chat!;
}

describe("App Chat activation", () => {
  it.each(["chat", "changes", "history"] as const)("requires visible local Chat when the selected surface is %s", async (surface) => {
    state.sidebarSurface = surface;
    for (const cloudActive of [false, true]) {
      for (const contentVisible of [false, true]) {
        state.cloudActive = cloudActive;
        state.contentVisible = contentVisible;
        const chat = await render();
        expect(chat.dataset.chatActive).toBe(String(!cloudActive && contentVisible && surface === "chat"));
        expect(document.querySelector("[data-sidebar-open]")?.getAttribute("data-sidebar-open")).toBe(String(!cloudActive));
      }
    }
  });

  it("deactivates retained Chat immediately on Cloud entry, even while the closing pane remains visible", async () => {
    const chat = await render();
    chat.value = "unsaved local draft";
    expect(chat.dataset.chatActive).toBe("true");
    state.cloudActive = true;
    expect(await render()).toBe(chat);
    expect(chat.dataset.chatActive).toBe("false");
    expect(chat.closest(".desktop-right-sidebar-surface")?.getAttribute("aria-hidden")).toBe("true");
    state.cloudActive = false;
    expect(await render()).toBe(chat);
    expect(chat.dataset.chatActive).toBe("true");
    expect(chat.value).toBe("unsaved local draft");
  });
});
