import { initializeDesktopPreferences, desktopPreferencesStore } from "../../../../src/preferencesStore";
/** @vitest-environment happy-dom */
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { DesktopTitlebarActions } from "../../../../src/features/app-shell/DesktopTitlebarActions";
import { useGitPresentation } from "../../../../src/features/app-shell/useGitPresentation";
import type { RightSidebarSurface } from "../../../../src/preferenceStorage";
import { GitChangesSidebar } from "../../../../src/features/source-control/GitChangesSidebar";
import { GitHistorySidebar } from "../../../../src/features/source-control/GitHistorySidebar";
import type { GitWorkingSelection } from "../../../../src/features/source-control/types";
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
  workspaceScope?: string | null;
  initialSidebar?: RightSidebarSurface;
};

function Harness({ workspaceScope = "/project/one", initialSidebar }: Options) {
  const [sidebarOpen, setSidebarOpen] = useState(Boolean(initialSidebar));
  const [sidebarSurface, setSidebarSurface] = useState<RightSidebarSurface>(initialSidebar ?? "chat");
  const [selection, setSelection] = useState<GitWorkingSelection | null>(null);
  const presentation = useGitPresentation({
    workspaceScope, sidebarOpen, sidebarSurface,
    setSidebarOpen, setSidebarSurface, onReveal: () => {}, beforeOpenSidebar: () => {},
  });
  const resource = { ...gitResource("README.md"), group: "workingTree" as const };
  const status = gitStatus();
  status.entries = [{ path: resource.path, oldPath: null, status: "modified", staged: " ", unstaged: "M" }];
  status.unstagedEntries = status.entries;
  status.sourceControl.groups = [{ id: "workingTree", label: "Changes", resources: [resource] }];
  const succeed = async () => true;
  const changes = <GitChangesSidebar
    repository={{ status, puppyoneConfig: null }}
    view={{ selectedWorkingFile: selection, operationLoading: null, operationError: null, loading: false, error: null }}
    actions={{ initialize: succeed, selectWorkingFile: setSelection, stagePaths: succeed, stageAll: succeed,
      unstagePaths: succeed, discardPaths: succeed, stageAndCommit: succeed, commit: succeed, commitAndPush: succeed,
      continueOperation: succeed, abortOperation: succeed, pull: succeed, push: succeed, publish: succeed }}
    workingFileDiff={null} workingFileDiffLoading={false} workingFileDiffError={null}
    onOpenFile={() => {}} onOpenHistory={presentation.openHistory}
    cloudBackup={{ loading: false, error: null, enabled: false, start: () => {} }}
  />;
  const history = <GitHistorySidebar
    status={status} statusLoading={false} statusError={null}
    selectedCommitId={null} commitDetail={null} commitDetailLoading={false} commitDetailError={null}
    historyLoading={false}  initializing={false}
    onInitialize={succeed} onSelectCommit={() => {}} onBack={presentation.backToChanges} />;
  return <>
    <DesktopTitlebarActions
      terminalSidebarOpen={false} terminalToolEnabled={false} onToggleTerminal={() => {}}
      gitChangesAvailable gitChangesOpen={presentation.open}
      onToggleGitChanges={presentation.toggle}
    />
    <output data-sidebar-open={String(sidebarOpen)} data-sidebar-surface={sidebarSurface}
      data-changes-active={String(presentation.changesActive)} data-history-active={String(presentation.historyActive)} />
    {sidebarOpen && <aside>
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

describe("Header Git sidebar navigation", () => {
  it("opens and closes Changes in the right sidebar without a popup", () => {
    mount();
    act(() => button().click());
    expect(card()).toBeNull();
    expect(document.querySelector("aside .desktop-git-changes-sidebar")).not.toBeNull();
    expect(button().getAttribute("aria-pressed")).toBe("true");
    expect(button().getAttribute("aria-haspopup")).toBeNull();
    assertActive("changes", true);
    act(() => button().click());
    expect(document.querySelector("aside")).toBeNull();
    expect(button().getAttribute("aria-pressed")).toBe("false");
    assertActive("changes", false);
  });

  it("switches from Chat to Changes and routes History and Back through the same sidebar", () => {
    mount({ initialSidebar: "chat" });
    act(() => button().click());
    act(() => button('.desktop-git-changes-sidebar button[aria-label="History"]').click());
    assertActive("changes", false);
    assertActive("history", true);
    expect(document.querySelector("aside .desktop-git-history-sidebar")).not.toBeNull();
    expect(document.querySelector("output")?.getAttribute("data-sidebar-surface")).toBe("history");
    act(() => button(".desktop-git-history-sidebar .desktop-git-view-back").click());
    assertActive("changes", true);
    assertActive("history", false);
    expect(document.querySelector("aside .desktop-git-changes-sidebar")).not.toBeNull();
    expect(document.querySelector(".desktop-git-history-sidebar")).toBeNull();
    expect(document.querySelector("output")?.getAttribute("data-sidebar-surface")).toBe("changes");
  });

  it("does not reveal Git without an active project", () => {
    mount({ workspaceScope: null });
    act(() => button().click());
    expect(document.querySelector("aside")).toBeNull();
    assertActive("changes", false);
  });
});

beforeEach(() => {
  initializeDesktopPreferences({ getItem: () => null, setItem: () => {}, removeItem: () => {} });
  desktopPreferencesStore.getState().setGitDisplayMode("professional");
});
