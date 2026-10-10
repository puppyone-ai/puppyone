import { useSurfaceAppearance } from "../../../../src/features/appearance/AppearanceRuntime";
import { useEditorAppearanceRevision } from "@puppyone/shared-ui";
import { initializeDesktopPreferences, desktopPreferencesStore } from "../../../../src/preferencesStore";
/** @vitest-environment happy-dom */
import { act, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../../../src/App";
import type { DesktopCloudShell } from "../../../../src/components/DesktopCloudShell";
import type { DesktopTitlebarContext } from "../../../../src/features/app-shell/DesktopTitlebarContext";
import type { RightSidebarSurface } from "../../../../src/preferenceStorage";
import { withTestLocalization } from "../../../support/react/localization";

const state = vi.hoisted(() => ({
  cloudActive: false,
  cloudRequested: false,
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
  DesktopCloudShell: ({ rightSidebar, rightSidebarOpen, titlebarSidebarSlot, titlebarCenteredSlot }: ComponentProps<typeof DesktopCloudShell>) => (
    <div data-sidebar-open={String(rightSidebarOpen)}>
      {titlebarSidebarSlot}{titlebarCenteredSlot}
      {typeof rightSidebar === "function" && rightSidebar({
        contentVisible: state.contentVisible, contentExpanded: state.contentVisible,
        settledCollapsed: !state.contentVisible, phase: state.contentVisible ? "expanded" : "collapsed",
      })}
    </div>
  ),
}));
vi.mock("../../../../src/features/app-shell/DesktopTitlebarContext", () => ({
  DesktopTitlebarContext: ({ onViewCloud, onViewLocal }: ComponentProps<typeof DesktopTitlebarContext>) => <>
    <button data-location-test="cloud" onClick={onViewCloud}>Cloud</button>
    <button data-location-test="local" onClick={onViewLocal}>Local</button>
  </>,
}));
vi.mock("../../../../src/features/app-shell/auxiliary-workbench/AuxiliaryWorkbenchPanel", () => ({
  AuxiliaryWorkbenchPanel: ({ active }: { active: boolean }) => <><input data-chat-active={String(active)} defaultValue="draft" /><EditorAppearanceProbe /></>,
}));
vi.mock("../../../../src/features/app-shell/useWorkspaceLifecycle", () => ({
  useWorkspaceLifecycle: () => ({ workspace: state.workspace, workbenchWorkspace: null, workspaces: [], recentWorkspaceItems: [] }),
}));
vi.mock("../../../../src/features/app-shell/project-sessions/useProjectSession", () => ({ useProjectSession: () => state.project }));
vi.mock("../../../../src/features/cloud/workbench/useAccountCloudWorkspace", () => ({
  useAccountCloudWorkspace: () => ({ active: state.cloudActive, cancel: state.noop,
    useLocal: () => { state.cloudActive = false; } }),
}));
vi.mock("../../../../src/features/cloud/workbench/useNativeCloudWorkbench", () => ({ useNativeCloudWorkbench: () => ({ refreshToken: { sequence: 0, entries: [] } }) }));
vi.mock("../../../../src/features/cloud/workbench/AccountCloudWorkspaceSurface", () => ({
  AccountCloudWorkspaceSurface: () => null,
  useAccountCloudWorkspacePresentation: () => ({}),
}));
vi.mock("../../../../src/features/cloud/workbench/useRepositoryCloudWorkspaceSwitch", () => ({
  useRepositoryCloudWorkspaceSwitch: () => ({ pending: state.cloudRequested,
    requestedLocation: state.cloudRequested ? "cloud" : undefined,
    request: () => { state.cloudRequested = true; }, cancel: () => { state.cloudRequested = false; } }),
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
  state.cloudRequested = false;
  state.contentVisible = true;
  state.sidebarSurface = "chat";
  window.localStorage.clear();
  initializeDesktopPreferences();
  desktopPreferencesStore.getState().setRightSidebarOpen(true);
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
  await act(async () => {
    desktopPreferencesStore.getState().setRightSidebarSurface(state.sidebarSurface);
    root!.render(withTestLocalization(<App />));
  });
  const chat = document.querySelector<HTMLInputElement>("[data-chat-active]");
  expect(chat).not.toBeNull();
  return chat!;
}

describe("App Chat activation", () => {
  it.each(["chat", "changes", "history"] as const)("collapses %s immediately on a Cloud request and keeps it closed on cancellation", async surface => {
    state.sidebarSurface = surface;
    desktopPreferencesStore.getState().setExperimentalSettings(s => ({ ...s, enableCloudWorkspace: true }));
    const chat = await render();
    chat.value = "unsaved local draft";
    chat.focus();
    await act(async () => document.querySelector<HTMLButtonElement>('[data-location-test="cloud"]')!.click());
    expect(state.cloudActive).toBe(false);
    expect(state.cloudRequested).toBe(true);
    expect(desktopPreferencesStore.getState().rightSidebarOpen).toBe(false);
    expect(document.querySelector('[data-sidebar-open]')?.getAttribute('data-sidebar-open')).toBe("false");
    expect(chat.dataset.chatActive).toBe("false");
    expect(chat.closest('.desktop-right-sidebar-surface')?.getAttribute('aria-hidden')).toBe("true");
    expect(document.activeElement).not.toBe(chat);
    await act(async () => document.querySelector<HTMLButtonElement>('[data-location-test="local"]')!.click());
    expect(state.cloudRequested).toBe(false);
    expect(desktopPreferencesStore.getState().rightSidebarOpen).toBe(false);
    expect(await render()).toBe(chat);
    expect(chat.value).toBe("unsaved local draft");
    expect(document.querySelector('[data-sidebar-open]')?.getAttribute('data-sidebar-open')).toBe("false");
  });

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

function EditorAppearanceProbe() {
  const appearance = useSurfaceAppearance();
  const revision = useEditorAppearanceRevision();
  return <output data-editor-revision={revision} data-heading-scale={appearance.markdownPresentation.headingScale}
    data-typography-scale={appearance.typography.scale} />;
}

it("updates the mounted App shell and editor appearance boundary from preference actions", async () => {
  await render();
  const initialRevision = document.querySelector("[data-editor-revision]")?.getAttribute("data-editor-revision");
  await act(async () => {
    const actions = desktopPreferencesStore.getState();
    actions.setPointerCursors(true);
    actions.setDiffMarkers("symbols");
    actions.setTypographyPreferences(s => ({ ...s, scale: "large" }));
    actions.setMarkdownPresentation(s => ({ ...s, headingScale: "large" }));
    actions.setThemeMode("dark");
  });
  const shell = document.querySelector<HTMLElement>("[data-po-appearance-root]");
  expect(shell?.dataset.pointerCursors).toBe("true");
  expect(shell?.dataset.diffMarkers).toBe("symbols");
  expect(shell?.classList.contains("dark")).toBe(true);
  const editor = document.querySelector<HTMLElement>("[data-editor-revision]");
  expect(editor?.dataset.headingScale).toBe("large");
  expect(editor?.dataset.typographyScale).toBe("large");
  expect(editor?.dataset.editorRevision).not.toBe(initialRevision);
});
