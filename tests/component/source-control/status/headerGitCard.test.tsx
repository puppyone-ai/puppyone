import { initializeDesktopPreferences, desktopPreferencesStore } from "../../../../src/preferencesStore";
/** @vitest-environment happy-dom */
import { act, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { DesktopTitlebarActions } from "../../../../src/features/app-shell/DesktopTitlebarActions";
import { DesktopGitHeaderCard } from "../../../../src/features/app-shell/DesktopGitHeaderCard";
import { useGitPresentation } from "../../../../src/features/app-shell/useGitPresentation";
import type { RightSidebarSurface } from "../../../../src/preferenceStorage";
import { GitChangesSidebar } from "../../../../src/features/source-control/GitChangesSidebar";
import { GitHistorySidebar } from "../../../../src/features/source-control/GitHistorySidebar";
import type { GitWorkingSelection } from "../../../../src/features/source-control/types";
import { DEFAULT_TITLEBAR_ACTIONS_SETTINGS } from "../../../../src/preferences";
import { gitResource, gitStatus } from "../../../support/source-control/gitFixtures";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
  window.localStorage.clear();
});

type Options = {
  centeredProject?: boolean;
  cardExperiment?: boolean;
  workspaceScope?: string | null;
  initialSidebar?: RightSidebarSurface;
};

function Harness({ centeredProject = true, cardExperiment = true, workspaceScope = "/project/one", initialSidebar }: Options) {
  const [sidebarOpen, setSidebarOpen] = useState(Boolean(initialSidebar));
  const [sidebarSurface, setSidebarSurface] = useState<RightSidebarSurface>(initialSidebar ?? "chat");
  const [selection, setSelection] = useState<GitWorkingSelection | null>(null);
  const [editorClicks, setEditorClicks] = useState(0);
  const anchorRef = useRef<HTMLDivElement>(null);
  const presentation = useGitPresentation({
    centeredProject, cardExperiment, workspaceScope, sidebarOpen, sidebarSurface,
    setSidebarOpen, setSidebarSurface, onReveal: () => {}, beforeOpenSidebar: () => {},
  });
  const resource = { ...gitResource("README.md"), group: "workingTree" as const };
  const status = gitStatus();
  status.entries = [{ path: resource.path, oldPath: null, status: "modified", staged: " ", unstaged: "M" }];
  status.unstagedEntries = status.entries;
  status.sourceControl.groups = [{ id: "workingTree", label: "Changes", resources: [resource] }];
  const succeed = async () => true;
  const changes = <GitChangesSidebar
    focusNavigation={presentation.cardEnabled}
    repository={{ status, puppyoneConfig: null }}
    view={{ selectedWorkingFile: selection, operationLoading: null, operationError: null, loading: false, error: null }}
    actions={{ initialize: succeed, selectWorkingFile: setSelection, stagePaths: succeed, stageAll: succeed,
      unstagePaths: succeed, discardPaths: succeed, stageAndCommit: succeed, commit: succeed, commitAndPush: succeed,
      continueOperation: succeed, abortOperation: succeed, pull: succeed, push: succeed, publish: succeed }}
    workingFileDiff={null} workingFileDiffLoading={false} workingFileDiffError={null}
    onOpenFile={() => {}} onOpenHistory={presentation.openHistory}
    cloudBackup={{ loading: false, error: null, enabled: false, start: () => {} }}
  />;
  const history = <GitHistorySidebar focusNavigation={presentation.cardEnabled}
    status={status} statusLoading={false} statusError={null}
    selectedCommitId={null} commitDetail={null} commitDetailLoading={false} commitDetailError={null}
    historyLoading={false} fileIconTheme="default" initializing={false}
    onInitialize={succeed} onSelectCommit={() => {}} onBack={presentation.backToChanges} />;
  return <>
    <DesktopTitlebarActions
      titlebarActionsSettings={DEFAULT_TITLEBAR_ACTIONS_SETTINGS}
      terminalSidebarOpen={false} terminalToolEnabled={false} onToggleTerminal={() => {}}
      gitChangesAvailable gitChangesOpen={presentation.open}
      gitCardEnabled={presentation.cardEnabled} gitAnchorRef={anchorRef}
      onToggleGitChanges={presentation.toggle}
    />
    <output data-sidebar-open={String(presentation.effectiveSidebarOpen)} data-sidebar-surface={sidebarSurface}
      data-editor-clicks={editorClicks}
      data-changes-active={String(presentation.changesActive)} data-history-active={String(presentation.historyActive)} />
    <button className="editor-action" onClick={() => setEditorClicks((value) => value + 1)}>Editor</button>
    <DesktopGitHeaderCard anchorRef={anchorRef} open={presentation.cardOpen}
      surface={presentation.cardSurface} onDismiss={presentation.closeCard}
      changes={changes} history={history}
    />
    {!presentation.cardEnabled && presentation.effectiveSidebarOpen && <aside>
      {sidebarSurface === "changes" && changes}
      {sidebarSurface === "history" && history}
    </aside>}
  </>;
}

function mount(options: Options = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const render = (next: Options) => act(() => root?.render(withTestLocalization(<Harness {...next} />)));
  render(options);
  return render;
}
function button(selector = ".desktop-titlebar-changes") {
  const element = document.querySelector<HTMLButtonElement>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  return element;
}
function card() { return document.querySelector<HTMLElement>(".desktop-git-header-card"); }
function assertActive(surface: "changes" | "history", active: boolean) {
  expect(document.querySelector("output")?.getAttribute(`data-${surface}-active`)).toBe(String(active));
}

describe("Git Header card", () => {
  it.each([[false, false], [true, false], [false, true], [true, true]])(
    "gates the card with centeredProject=%s and cardExperiment=%s",
    (centeredProject, cardExperiment) => {
      mount({ centeredProject, cardExperiment });
      act(() => button().click());
      const enabled = centeredProject && cardExperiment;
      expect(Boolean(card())).toBe(enabled);
      expect(document.querySelector("output")?.getAttribute("data-sidebar-open")).toBe(String(!enabled));
      assertActive("changes", true);
      act(() => button().click());
      expect(card()).toBeNull();
      assertActive("changes", false);
    },
  );

  it("preserves Chat while Git is open and exposes dialog trigger semantics", () => {
    mount({ initialSidebar: "chat" });
    act(() => button().click());
    expect(button().getAttribute("aria-haspopup")).toBe("dialog");
    expect(button().getAttribute("aria-expanded")).toBe("true");
    expect(button().getAttribute("aria-controls")).toBe(card()?.id);
    expect(card()?.getAttribute("role")).toBe("dialog");
    expect(document.activeElement).toBe(card());
    expect(document.querySelector("output")?.getAttribute("data-sidebar-open")).toBe("true");
    expect(document.querySelector("output")?.getAttribute("data-sidebar-surface")).toBe("chat");
  });

  it("moves an already-open Git sidebar out of the sidebar when the experiment is enabled", () => {
    const render = mount({ cardExperiment: false, initialSidebar: "changes" });
    render({ cardExperiment: true });
    expect(document.querySelector("output")?.getAttribute("data-sidebar-open")).toBe("false");
    assertActive("changes", false);
    act(() => button().click());
    expect(card()).not.toBeNull();
  });

  it("uses the existing Changes and History views with Escape returning before dismissing", () => {
    mount();
    act(() => button().click());
    act(() => button('.desktop-git-header-card button[aria-label="History"]').click());
    expect(document.activeElement).toBe(button(".desktop-git-history-sidebar .desktop-git-view-back"));
    assertActive("changes", false);
    assertActive("history", true);
    const history = card()?.querySelector(".desktop-git-history-sidebar");
    act(() => history?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(card()).not.toBeNull();
    assertActive("history", false);
    assertActive("changes", true);

    act(() => button(".desktop-git-header-card .desktop-working-tree-main").click());
    expect(document.activeElement).toBe(button(".desktop-git-changes-detail-header .desktop-git-view-back"));
    expect(card()?.querySelector(".desktop-git-changes-detail")).not.toBeNull();
    const changes = card()?.querySelector(".desktop-git-changes-sidebar");
    act(() => changes?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(card()).not.toBeNull();
    expect(card()?.querySelector(".desktop-git-changes-detail")).toBeNull();
    act(() => changes?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(card()).toBeNull();
    expect(document.activeElement).toBe(button());
  });

  it.each([false, true])("routes History and Back through the selected presentation (card=%s)", (cardExperiment) => {
    mount({ cardExperiment, initialSidebar: "chat" });
    act(() => button().click());
    act(() => button('.desktop-git-changes-sidebar button[aria-label="History"]').click());
    assertActive("changes", false);
    assertActive("history", true);
    expect(document.querySelector(".desktop-git-history-sidebar")).not.toBeNull();
    expect(document.querySelector("output")?.getAttribute("data-sidebar-surface")).toBe(cardExperiment ? "chat" : "history");

    act(() => button(".desktop-git-history-sidebar .desktop-git-view-back").click());
    assertActive("changes", true);
    assertActive("history", false);
    expect(document.querySelector(".desktop-git-changes-sidebar")).not.toBeNull();
    if (cardExperiment) {
      expect(document.querySelector(".desktop-git-history-sidebar")?.closest("[hidden]")).not.toBeNull();
    } else {
      expect(document.querySelector(".desktop-git-history-sidebar")).toBeNull();
    }
    expect(document.querySelector("output")?.getAttribute("data-sidebar-surface")).toBe(cardExperiment ? "chat" : "changes");
    expect(document.querySelector("output")?.getAttribute("data-sidebar-open")).toBe("true");
  });

  it.each(["project", "home", "experiment", "layout"])("closes on %s changes without reopening stale content", (change) => {
    const render = mount();
    act(() => button().click());
    render(change === "project" ? { workspaceScope: "/project/two" }
      : change === "home" ? { workspaceScope: null }
      : change === "experiment" ? { cardExperiment: false }
      : { centeredProject: false });
    expect(card()).toBeNull();
    assertActive("changes", false);
    render({});
    expect(card()).toBeNull();
  });

  it("dismisses outside clicks without swallowing the target action", () => {
    mount();
    act(() => button().click());
    act(() => button(".editor-action").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
    act(() => button(".editor-action").click());
    expect(card()).toBeNull();
    expect(document.querySelector("output")?.getAttribute("data-editor-clicks")).toBe("1");
  });

  it("keeps the card behind Git operation dialogs and allows their focus and buttons", () => {
    mount();
    act(() => button().click());
    const modal = document.createElement("div");
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    const action = document.createElement("button");
    modal.append(action);
    document.body.append(modal);
    act(() => {
      action.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      action.focus();
      action.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(card()).not.toBeNull();
    expect(document.activeElement).toBe(action);
  });
});

beforeEach(() => {
  initializeDesktopPreferences({ getItem: () => null, setItem: () => {}, removeItem: () => {} });
  desktopPreferencesStore.getState().setGitDisplayMode("professional");
});
