import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getSourceControlPrimaryActionSlot } from "../../../../src/features/source-control/viewModel";

const viewSource = readFileSync(
  new URL("../../../../src/features/source-control/GitStatusView.tsx", import.meta.url),
  "utf8",
);
const workingFileDetailSource = readFileSync(
  new URL("../../../../src/features/source-control/WorkingFileDetail.tsx", import.meta.url),
  "utf8",
);
const gitCommitDetailSource = readFileSync(
  new URL("../../../../src/features/source-control/GitCommitDetail.tsx", import.meta.url),
  "utf8",
);
const sourceControlComponentsSource = readFileSync(
  new URL("../../../../src/features/source-control/components.tsx", import.meta.url),
  "utf8",
);
const sourceControlSidebarSource = readFileSync(
  new URL("../../../../src/features/source-control/SourceControlSidebar.tsx", import.meta.url),
  "utf8",
);
const sourceControlSidebarSectionsSource = [
  "GitRemoteSections.tsx",
  "GitSidebarPrimitives.tsx",
  "GitIncomingUpdateNotice.tsx",
  "GitLocalStatusSection.tsx",
  "GitLocalStatusPanels.tsx",
].map((fileName) => readFileSync(
  new URL(`../../../../src/features/source-control/sidebar/${fileName}`, import.meta.url),
  "utf8",
)).join("\n");
const sourceControlExpansionStateSource = readFileSync(
  new URL("../../../../src/features/source-control/sidebar/useGitSidebarExpansionState.ts", import.meta.url),
  "utf8",
);
const versionControlSetupSource = readFileSync(
  new URL("../../../../src/features/source-control/VersionControlSetupState.tsx", import.meta.url),
  "utf8",
);
const versionControlIconSource = readFileSync(
  new URL("../../../../src/features/source-control/VersionControlIcon.tsx", import.meta.url),
  "utf8",
);
const versionControlSetupCss = readFileSync(
  new URL("../../../../src/features/source-control/styles/setup-state.css", import.meta.url),
  "utf8",
);
const desktopEntryStateSource = readFileSync(
  new URL("../../../../src/components/DesktopEntryState.tsx", import.meta.url),
  "utf8",
);
const desktopEntryStateCss = readFileSync(
  new URL("../../../../src/styles/entry-state.css", import.meta.url),
  "utf8",
);
const cloudSignInCss = readFileSync(
  new URL("../../../../src/features/cloud/auth/cloud-sign-in.css", import.meta.url),
  "utf8",
);
const cloudAuthCardCss = readFileSync(
  new URL("../../../../src/features/cloud/auth/cloud-auth-card.css", import.meta.url),
  "utf8",
);
const cloudSignInSource = readFileSync(
  new URL("../../../../src/features/cloud/auth/CloudSignInView.tsx", import.meta.url),
  "utf8",
);
const titlebarContextSource = readFileSync(
  new URL("../../../../src/features/app-shell/DesktopTitlebarContext.tsx", import.meta.url),
  "utf8",
);
const navigationSource = readFileSync(
  new URL("../../../../src/features/app-shell/navigation/navigationModel.tsx", import.meta.url),
  "utf8",
);
const operationDialogsSource = readFileSync(
  new URL("../../../../src/features/source-control/operationDialogs.tsx", import.meta.url),
  "utf8",
);
const fileDiffSurfaceSource = readFileSync(
  new URL("../../../../src/features/source-control/diff/GitFileDiffSurface.tsx", import.meta.url),
  "utf8",
);
const textDiffSource = readFileSync(
  new URL("../../../../src/features/source-control/diff/contributions/text-unified/TextUnifiedDiff.tsx", import.meta.url),
  "utf8",
);
const detailCss = readFileSync(
  new URL("../../../../src/features/source-control/styles/history-detail.css", import.meta.url),
  "utf8",
);
const sidebarBaseCss = readFileSync(
  new URL("../../../../src/features/source-control/styles/sidebar-base.css", import.meta.url),
  "utf8",
);
const sidebarResourcesCss = [
  "sidebar-panels.css",
  "sidebar-actions.css",
  "sidebar-providers.css",
  "sidebar-resources.css",
].map((fileName) => readFileSync(
  new URL(`../../../../src/features/source-control/styles/${fileName}`, import.meta.url),
  "utf8",
)).join("\n");
const gitControllerSource = readFileSync(
  new URL("../../../../src/features/source-control/useDesktopGitController.ts", import.meta.url),
  "utf8",
);
const gitRepositoryLifecycleSource = readFileSync(
  new URL("../../../../src/features/source-control/useGitRepositoryLifecycle.ts", import.meta.url),
  "utf8",
);
const historyListCss = readFileSync(
  new URL("../../../../src/features/source-control/styles/history-list.css", import.meta.url),
  "utf8",
);
const historyTimelineSource = readFileSync(
  new URL("../../../../src/features/source-control/GitHistoryTimeline.tsx", import.meta.url),
  "utf8",
);
const historySidebarSource = readFileSync(
  new URL("../../../../src/features/source-control/GitHistorySidebar.tsx", import.meta.url),
  "utf8",
);
const changesSidebarSource = readFileSync(
  new URL("../../../../src/features/source-control/GitChangesSidebar.tsx", import.meta.url),
  "utf8",
);
const appSource = readFileSync(
  new URL("../../../../src/App.tsx", import.meta.url),
  "utf8",
);
const headerElementsSource = readFileSync(
  new URL("../../../../src/features/app-shell/headerElements.tsx", import.meta.url),
  "utf8",
);
const diffCss = readFileSync(
  new URL("../../../../src/features/source-control/styles/diff-utility.css", import.meta.url),
  "utf8",
);

describe("source-control visual architecture", () => {
  it("keeps the Cloud publish reminder in reading and action order", () => {
    const card = compact(readCssBlock(
      sidebarResourcesCss,
      ".desktop-git-backup-card",
    ));
    const action = compact(readCssBlock(
      sidebarResourcesCss,
      ".desktop-git-backup-action",
    ));
    const dismiss = compact(readCssBlock(
      sidebarResourcesCss,
      ".desktop-git-backup-dismiss",
    ));
    const errorTitle = compact(readCssBlock(
      sidebarResourcesCss,
      ".desktop-git-backup-card.is-error .desktop-git-backup-copy span",
    ));

    expect(card).toContain('grid-template-areas: "copy copy" "dismiss action";');
    expect(card).toContain(
      "grid-template-columns: var(--git-action-size) minmax(0, 1fr);",
    );
    expect(action).toContain("grid-area: action;");
    expect(action).toContain("justify-self: end;");
    expect(dismiss).toContain("grid-area: dismiss;");
    expect(dismiss).toContain("align-self: center;");
    expect(dismiss).toContain("justify-self: start;");
    expect(sourceControlSidebarSectionsSource).toContain(
      'const message = cloudBackupError || t("source-control.backup.reminder");',
    );
    expect(sourceControlSidebarSectionsSource).not.toContain("desktop-git-backup-error");
    expect(errorTitle).toContain("color: var(--po-danger);");
  });

  it("aligns every Git section empty state with its section label", () => {
    const sectionTitle = compact(readCssBlock(
      sidebarResourcesCss,
      ".desktop-git-section-title",
    ));
    const sectionTitleIcon = compact(readCssBlock(
      sidebarResourcesCss,
      ".desktop-git-section-title svg",
    ));
    const sectionEmpty = compact(readCssBlock(
      sidebarBaseCss,
      ".desktop-git-sidebar .po-sidebar-empty.desktop-git-section-empty",
    ));
    const emptyStateSources = `${sourceControlSidebarSource}\n${sourceControlSidebarSectionsSource}`;

    expect(emptyStateSources.match(/className="desktop-git-section-empty"/g)).toHaveLength(2);
    expect(sourceControlSidebarSectionsSource).toContain('t("source-control.status.noLocalChanges")');
    expect(sourceControlSidebarSectionsSource).toContain("showCount={false}");
    expect(emptyStateSources).not.toMatch(/desktop-git-empty-(?:remote|committed|stage|changes)/);
    expect(sourceControlComponentsSource).toContain("<ChevronRight size={14}");
    expect(sidebarBaseCss).toContain("--git-section-leading-slot-size: 14px;");
    expect(sidebarBaseCss).toContain("--git-section-title-gap: 6px;");
    expect(sidebarBaseCss).toContain("--git-section-body-top-gap: 2px;");
    expect(sectionTitle).toContain("gap: var(--git-section-title-gap);");
    expect(sectionTitleIcon).toContain("width: var(--git-section-leading-slot-size);");
    expect(sectionTitleIcon).toContain("height: var(--git-section-leading-slot-size);");
    expect(sectionEmpty).toContain("flex: 0 0 auto;");
    expect(sectionEmpty).toContain("min-height: 26px;");
    expect(sectionEmpty).toContain("margin-block: var(--git-section-body-top-gap) 0;");
    expect(sectionEmpty).toContain(compact(`
      padding-inline: calc(
        var(--git-sidebar-left-gap)
        + var(--git-sidebar-content-left)
        + var(--git-section-leading-slot-size)
        + var(--git-section-title-gap)
      )
      calc(var(--git-sidebar-right-gap) + var(--git-sidebar-content-right));
    `));
    expect(sidebarResourcesCss).toContain(
      ".po-sidebar-empty.compact:not(.desktop-git-section-empty)",
    );
    expect(sidebarResourcesCss).toContain(
      ".desktop-git-section-collapse-inner > .po-sidebar-empty.desktop-git-section-empty",
    );
  });

  it("keeps remote provider surfaces out while retaining one compact incoming notice", () => {
    const sidebarPresentation = `${sourceControlSidebarSource}\n${sourceControlSidebarSectionsSource}`;

    expect(sidebarPresentation).not.toContain("GitHubProviderSection");
    expect(sidebarPresentation).not.toContain("PuppyoneCloudProviderSection");
    expect(sidebarPresentation).not.toContain("GitScmSyncRow");
    expect(sidebarPresentation).not.toContain("incomingPreview");
    expect(sidebarPresentation).toContain('label={t("source-control.sync.pull")}');
    expect(sourceControlSidebarSource).toContain("<GitIncomingUpdateNotice");
    expect(sidebarResourcesCss).not.toContain("desktop-git-github-");
    expect(sidebarResourcesCss).not.toContain("desktop-git-cloud-provider-section");
    expect(sidebarResourcesCss).not.toContain("desktop-git-remote-status");
  });

  it("keeps History and Changes as right-sidebar surfaces beside Chat instead of workbench tabs", () => {
    expect(sourceControlSidebarSource).not.toContain("GitSidebarHistory");
    expect(sourceControlSidebarSource).not.toContain("desktop-git-history-pane");
    expect(historySidebarSource).toContain('className="desktop-git-history-sidebar"');
    expect(historySidebarSource).not.toContain("desktop-git-history-sidebar-header");
    expect(historySidebarSource).not.toContain("AuxiliaryWorkbenchContribution");
    expect(appSource).toContain('rightSidebarSurface === "chat"');
    expect(appSource).toContain('rightSidebarSurface === "changes"');
    expect(appSource).toContain('rightSidebarSurface === "history"');
    expect(appSource).toContain("<GitChangesSidebar");
    expect(appSource).toContain("<GitHistorySidebar");
    expect(appSource).toContain('setRightSidebarSurface("history")');
    expect(appSource).toContain('setRightSidebarSurface("changes")');
    expect(appSource).toContain('setRightSidebarSurface("chat")');
    expect(appSource).not.toContain("gitHistoryContribution");
    expect(appSource).not.toContain("GIT_HISTORY_WORKBENCH_KIND");
    expect(headerElementsSource).toContain('id: "history"');
    expect(headerElementsSource).toContain('id: "changes"');
    expect(headerElementsSource).toContain("aria-pressed={history.sidebarOpen}");
    expect(historyTimelineSource).toContain("<VirtualSidebarList");
    expect(viewSource).not.toContain("<VirtualSidebarList");
    expect(gitControllerSource).toContain("gitHistoryActive");
    expect(gitControllerSource).not.toContain("gitMainPanel");
  });

  it("keeps file review inside Changes and restores the established section actions", () => {
    expect(viewSource).toContain('t("source-control.overview.selectChange")');
    expect(viewSource).not.toContain("loading && !status");
    expect(historyTimelineSource).toContain('className="desktop-git-history-loading"');
    expect(historyTimelineSource).toContain('t("source-control.status.readingHistory")');
    expect(changesSidebarSource).toContain("<WorkingFileDetail");
    expect(changesSidebarSource).toContain('className="desktop-history-detail-back"');
    expect(sourceControlSidebarSource).not.toContain('className="desktop-git-commit-composer"');
    expect(sourceControlSidebarSectionsSource).toContain('className="desktop-git-commit-staged-action"');
    expect(sourceControlSidebarSectionsSource).toContain('className="desktop-git-stage-commit-action"');
    expect(appSource).not.toContain('navigateDesktopView("git")');
  });

  it("reserves card surfaces for providers and keeps local source-control groups flat", () => {
    const sectionTitle = compact(readCssBlock(
      sidebarResourcesCss,
      ".desktop-git-section-title",
    ));
    const workingTreeRow = compact(readCssBlock(
      sidebarResourcesCss,
      ".desktop-working-tree-row",
    ));
    const resizer = compact(readCssBlock(
      sidebarResourcesCss,
      ".desktop-git-section-resizer::after",
    ));

    expect(sourceControlSidebarSectionsSource).toContain("export function GitLocalStatusSection");
    expect(sourceControlSidebarSectionsSource).toContain('className="desktop-git-local-section-body"');
    expect(sourceControlSidebarSectionsSource).toContain("controlsId={bodyId}");
    expect(sourceControlSidebarSectionsSource).toContain("count={model.committedCount}");
    expect(sourceControlSidebarSectionsSource).not.toContain("countLabel");
    expect(sourceControlSidebarSectionsSource.match(/<GitLocalStatusSection/g)).toHaveLength(5);
    expect(sourceControlSidebarSectionsSource).toContain("if (model.showCleanSection)");
    expect(sourceControlSidebarSectionsSource).toContain('className: "changes"');
    expect(sourceControlSidebarSource).not.toContain("layout: gitSidebarLayout,");
    for (const panel of ["merge", "committed", "staged", "unstaged"]) {
      expect(sourceControlExpansionStateSource).toContain(`${panel}: true`);
    }
    expect(sourceControlExpansionStateSource).not.toContain("remote: true");
    expect(sourceControlSidebarSectionsSource).toContain("aria-hidden={expanded ? undefined : true}");
    expect(sourceControlSidebarSectionsSource).toContain('const inertWhenCollapsed = expanded ? {} : { inert: "" };');
    expect(sourceControlSidebarSectionsSource).not.toContain("GitStatusCardSection");
    expect(sourceControlSidebarSectionsSource).not.toContain("desktop-git-status-card");
    expect(sourceControlSidebarSectionsSource).not.toContain("STATUS_CARD_CHROME_PX");
    expect(sidebarResourcesCss).not.toContain("desktop-git-status-card");
    expect(sectionTitle).toContain(
      "color: var(--desktop-sidebar-section-title-color, var(--po-text-subtle));",
    );
    expect(workingTreeRow).toContain("width: 100%;");
    expect(workingTreeRow).not.toContain("background");
    expect(compact(sidebarResourcesCss)).toContain(compact(`
      .desktop-git-local-section-body .desktop-working-tree-list,
      .desktop-git-local-section-body .desktop-git-remote-preview {
        overflow-y: hidden;
        scrollbar-gutter: auto;
        padding-inline-end: var(--git-sidebar-right-gap);
      }
    `));
    expect(compact(sidebarResourcesCss)).toContain(compact(`
      .desktop-git-local-section-body .desktop-working-tree-list.is-scrollable,
      .desktop-git-local-section-body .desktop-git-remote-preview.is-scrollable {
        overflow-y: auto;
        scrollbar-gutter: stable;
        padding-inline-end: calc(var(--git-sidebar-right-gap) - var(--git-sidebar-scrollbar-width));
      }
    `));
    expect(sidebarResourcesCss).toContain(".desktop-working-tree-row:hover,");
    expect(resizer).toContain("background: var(--po-sidebar-divider, var(--po-divider));");
  });

  it("keeps remote Fetch lifecycle out of the presentational sidebar", () => {
    const sidebarPresentation = `${sourceControlSidebarSource}\n${sourceControlSidebarSectionsSource}`;

    expect(sidebarPresentation).not.toContain("fetchWorkspaceGit");
    expect(sidebarPresentation).not.toContain("setInterval");
    expect(gitRepositoryLifecycleSource).toContain("getRemoteFetchTarget(activeGitStatus)");
    expect(gitRepositoryLifecycleSource).toContain("REMOTE_FETCH_INTERVAL_MS");
    expect(gitRepositoryLifecycleSource).toContain(
      "fetchWorkspaceGit(context.rootPath, { remoteName })",
    );
    expect(gitControllerSource).toContain('void refreshGitStatus("working-tree")');
  });

  it("keeps file status as a quiet inline marker without moving row actions", () => {
    const stagedGrid = compact(readCssBlock(
      sidebarResourcesCss,
      ".desktop-working-tree-row.is-staged",
    ));
    const actionSlot = compact(readCssBlock(
      sidebarResourcesCss,
      ".desktop-working-tree-action-slot",
    ));
    const state = compact(readCssBlock(
      sidebarResourcesCss,
      ".desktop-working-tree-state",
    ));

    expect(sourceControlComponentsSource).toContain("<GitResourceStatusMarker resource={resource} />");
    expect(sourceControlComponentsSource).toContain('className="desktop-working-tree-action-slot"');
    expect(sourceControlComponentsSource).not.toContain('className="desktop-working-tree-state-slot"');
    expect(sourceControlComponentsSource).toContain("desktop-working-tree-revert-action");
    expect(sourceControlComponentsSource).toContain("desktop-working-tree-state-action");
    expect(sidebarBaseCss).toContain(
      "--git-working-tree-secondary-action-width: var(--git-working-tree-action-size);",
    );
    expect(sidebarBaseCss).toContain(
      "--git-working-tree-state-width: var(--git-working-tree-action-size);",
    );
    expect(sidebarBaseCss).not.toContain("--git-working-tree-status-size");
    expect(stagedGrid).toContain(
      "grid-template-columns: minmax(0, 1fr) var(--git-working-tree-state-width);",
    );
    expect(actionSlot).toContain("grid-column: 3;");
    expect(actionSlot).toContain("place-items: center;");
    expect(state).toContain("flex: 0 0 auto;");
    expect(state).toContain("color: var(--po-text-disabled);");
    expect(state).toContain("font-size: var(--po-type-ui-micro, 11px);");
    expect(state).toContain("font-weight: var(--po-text-weight-regular, 400);");
    expect(state).not.toContain("var(--po-success)");
    expect(state).not.toContain("var(--po-warning)");
    expect(state).not.toContain("var(--po-danger)");
    expect(sourceControlComponentsSource.match(/desktop-working-tree-action-slot/g)).toHaveLength(1);
    expect(sourceControlComponentsSource.match(/<GitResourceStatusMarker resource=\{resource\} \/>/g)).toHaveLength(2);
    expect(sidebarResourcesCss).toContain(
      ".desktop-working-tree-row:hover .desktop-working-tree-state-action",
    );
    expect(sidebarResourcesCss).not.toContain(
      ".desktop-working-tree-row:hover .desktop-working-tree-state,",
    );
    expect(sourceControlSidebarSource).not.toContain("source-control.action.unstageAll");
    expect(gitControllerSource).toContain("const handleDiscardGitPaths = useCallback");
    expect(gitControllerSource).toContain("window.confirm(t(\"source-control.dialog.discard.path\"");
  });

  it("keeps the no-version-control state to one calm enable action", () => {
    expect(titlebarContextSource).toContain('t("shell.branch.noGit")');
    expect(titlebarContextSource).not.toContain('"No Version Control"');
    expect(viewSource).toContain("<VersionControlSetupState");
    expect(versionControlSetupSource).toContain('"source-control.setup.enable"');
    expect(versionControlSetupSource).toContain('"source-control.setup.enabling"');
    expect(versionControlSetupSource).toContain('t("source-control.setup.description")');
    expect(versionControlSetupSource).toContain('ariaLabel={t("source-control.setup.ariaLabel")}');
    expect(versionControlSetupSource.match(/<button/g)).toHaveLength(1);
    expect(versionControlSetupSource).not.toContain("getElectron");
    expect(viewSource).not.toContain("This folder is not under source control.");
    expect(viewSource).not.toContain("Initialize a Git repository");
    expect(viewSource).not.toContain('"Initialize Repository"');
    expect(sourceControlSidebarSource).toContain('t("source-control.status.noRepository")');
    expect(sourceControlSidebarSource).not.toContain('"Initialize Repository"');
    expect(desktopEntryStateCss).toContain("width: min(420px, 100%);");
    expect(versionControlSetupCss).toContain("height: var(--po-control-size);");
  });

  it("shares the responsive setup type scale with the Cloud entry state", () => {
    expect(desktopEntryStateCss).toContain("font-size: var(--po-text-size-title);");
    expect(desktopEntryStateCss).toContain("font-size: var(--po-text-size-body-lg);");
    expect(desktopEntryStateCss).toContain("font-weight: var(--po-text-weight-medium);");

    expect(versionControlSetupCss).toContain("font-size: var(--po-text-size-body);");
    expect(versionControlSetupCss).toContain("font-weight: var(--po-text-weight-semibold);");
    expect(versionControlSetupCss).toContain("font-size: var(--po-text-size-meta);");
    expect(cloudAuthCardCss).toContain(
      "--desktop-cloud-body-size: var(--po-text-size-body, 13px);",
    );
    expect(cloudSignInCss).toContain("font-size: var(--po-text-size-meta);");
  });

  it("keeps Cloud and Version Control in one full-surface coordinate system", () => {
    const root = compact(readCssBlock(desktopEntryStateCss, ".desktop-entry-state"));
    const body = compact(readCssBlock(desktopEntryStateCss, ".desktop-entry-state-body"));
    const cloudMain = compact(readCssBlock(
      cloudSignInCss,
      ".desktop-cloud-main-view.desktop-cloud-auth-main-view",
    ));
    const cloudPage = compact(readCssBlock(
      cloudSignInCss,
      ".desktop-cloud-auth-page-shell",
    ));

    expect(versionControlSetupSource).toContain("<DesktopEntryState");
    expect(cloudSignInSource).toContain("<CloudActivationHero");
    expect(readFileSync(
      new URL("../../../../src/features/cloud/auth/CloudSignedOutRoute.tsx", import.meta.url),
      "utf8",
    )).toContain('className="desktop-cloud-auth-page-shell"');
    expect(desktopEntryStateSource).toContain('className="desktop-entry-state-body"');
    expect(versionControlSetupSource).not.toContain("desktop-utility-view");
    expect(root).toContain("display: grid;");
    expect(root).toContain("width: 100%;");
    expect(root).toContain("height: 100%;");
    expect(root).toContain("min-height: 0;");
    expect(body).toContain("place-items: center;");
    expect(body).toContain("height: 100%;");
    expect(cloudMain).toContain("overflow: hidden;");
    expect(cloudMain).toContain("padding: 0;");
    expect(cloudPage).toContain("display: flex;");
    expect(cloudPage).toContain("flex: 1 1 auto;");
    expect(cloudPage).toContain("width: 100%;");
    expect(cloudPage).toContain("height: 100%;");
    expect(cloudPage).toContain("min-width: 0;");
    expect(cloudPage).toContain("min-height: 0;");
    expect(cloudSignInCss).not.toContain(".desktop-cloud-auth-main-view .desktop-entry-state");
  });

  it("reuses the canonical navigation icon in the Cloud-sized entry footprint", () => {
    const localMark = compact(readCssBlock(versionControlSetupCss, ".desktop-version-control-mark"));
    const localFrame = compact(readCssBlock(versionControlSetupCss, ".desktop-version-control-mark-frame"));
    const cloudMark = compact(readCssBlock(
      cloudSignInCss,
      ".desktop-cloud-sign-in-entry .desktop-cloud-product-mark",
    ));

    expect(versionControlSetupSource).toContain(
      '<VersionControlIcon className="desktop-version-control-mark" />',
    );
    expect(versionControlSetupSource).not.toContain("lucide-react");
    expect(versionControlIconSource).toContain('viewBox="0 0 24 24"');
    expect(navigationSource).toContain(
      '{ view: "git", labelId: "shell.navigation.changes", icon: VersionControlIcon, iconSize: 18 }',
    );
    expect(titlebarContextSource).toContain("<GitBranch size={13}");
    expect(titlebarContextSource).not.toContain("VersionControlIcon");
    expect(operationDialogsSource).toContain("<VersionControlIcon size={13} />");
    expect(navigationSource).not.toContain("PuppyGitIcon");
    expect(operationDialogsSource).not.toContain("../app-shell/navigation");
    expect(localFrame).toContain("width: 78px;");
    expect(localFrame).toContain("height: 58px;");
    expect(localMark).toContain("width: 74px;");
    expect(localMark).toContain("height: 54px;");
    expect(cloudMark).toContain("width: 74px;");
    expect(cloudMark).toContain("height: 54px;");
  });

  it("uses one canonical file diff surface in Changes and History", () => {
    expect(gitCommitDetailSource).toContain("<GitFileDiffSurface");
    expect(workingFileDetailSource).toContain("<GitFileDiffSurface");
    expect(fileDiffSurfaceSource).toContain('className="desktop-file-diff-header"');
    expect(fileDiffSurfaceSource).toContain("<FormatAwareDiff");
    expect(gitCommitDetailSource).not.toContain("hideHeader");
    expect(workingFileDetailSource).not.toContain("hideHeader");
    expect(fileDiffSurfaceSource).not.toContain("without-header");

    const header = compact(readCssBlock(diffCss, ".desktop-file-diff-header"));
    const metadataHeader = compact(readCssBlock(
      diffCss,
      '.desktop-file-diff[data-content-mode="metadata"] .desktop-file-diff-header',
    ));
    const format = compact(readCssBlock(diffCss, ".desktop-file-format-label"));
    const stats = compact(readCssBlock(diffCss, ".desktop-file-diff-stat"));
    expect(header).toContain("grid-template-columns: max-content minmax(0, 1fr);");
    expect(metadataHeader).toContain("border-bottom: 0;");
    expect(format).toContain("color: var(--po-text);");
    expect(format).toContain("font-weight: 650;");
    expect(format).not.toContain("border-radius:");
    expect(format).not.toContain("background:");
    expect(stats).toContain("font-variant-numeric: tabular-nums;");
    expect(stats).toContain("font-weight: 650;");

    const factsIndex = fileDiffSurfaceSource.indexOf('className="desktop-file-diff-facts"');
    const formatIndex = fileDiffSurfaceSource.indexOf('className="desktop-file-format-label"');
    const statusIndex = fileDiffSurfaceSource.indexOf("desktop-change-badge");
    const statsIndex = fileDiffSurfaceSource.indexOf('className="desktop-file-diff-stat"');
    const identityIndex = fileDiffSurfaceSource.indexOf('className="desktop-file-diff-identity"');
    expect(factsIndex).toBeGreaterThan(-1);
    expect(formatIndex).toBeGreaterThan(factsIndex);
    expect(statusIndex).toBeGreaterThan(formatIndex);
    expect(statsIndex).toBeGreaterThan(statusIndex);
    expect(identityIndex).toBeGreaterThan(statsIndex);
    expect(fileDiffSurfaceSource).toContain("resolveDiffViewer(file)");
    expect(fileDiffSurfaceSource).toContain("resolvedViewer={resolvedViewer}");
    expect(workingFileDetailSource).not.toContain("desktop-working-diff-context");
    expect(workingFileDetailSource).not.toContain("getGitDiffContextPresentation");
  });

  it("keeps file actions at toolbar emphasis", () => {
    const actions = compact(readCssBlock(
      detailCss,
      ".desktop-working-file-actions .secondary-action,\n.desktop-working-file-actions .danger-action",
    ));

    expect(actions).toContain("height: var(--git-action-size);");
    expect(actions).toContain("background: transparent;");
    expect(actions).toContain("font-size: var(--git-action-font-size);");
    expect(actions).toContain("font-weight: 500;");

    const actionsSource = workingFileDetailSource.slice(
      workingFileDetailSource.indexOf('className="desktop-working-file-actions"'),
    );
    const openFileIndex = actionsSource.indexOf("onOpenFile(selection.path)");
    const stageIndex = actionsSource.indexOf("onStagePaths([selection.path])");
    const discardIndex = actionsSource.indexOf("onDiscardPaths([selection.path])");
    expect(openFileIndex).toBeGreaterThan(-1);
    expect(stageIndex).toBeGreaterThan(openFileIndex);
    expect(discardIndex).toBeGreaterThan(stageIndex);
  });

  it("shares one 24px action-size contract across Source Control", () => {
    const contract = compact(readCssBlock(
      sidebarBaseCss,
      ".desktop-git-sidebar,\n.desktop-history-detail-view",
    ));
    const operation = compact(readCssBlock(
      sidebarResourcesCss,
      ".desktop-git-operation-button",
    ));

    expect(contract).toContain("--git-action-size: 24px;");
    expect(contract).toContain("--git-action-radius: var(--desktop-toolbar-action-radius);");
    expect(contract).toContain("--git-action-padding-inline: 7px;");
    expect(contract).toContain("--git-action-font-size: var(--po-type-ui-meta, 13px);");
    expect(operation).toContain("height: var(--git-action-size);");
    expect(operation).toContain("padding: 0 var(--git-action-padding-inline);");
    expect(operation).not.toContain("height: 28px;");
    expect(operation).toContain("max-width: 100%;");
    expect(sidebarBaseCss).toContain("container-name: git-sidebar;");
    expect(sidebarBaseCss).toContain("container-type: inline-size;");
    expect(sidebarResourcesCss).toContain("@container git-sidebar (max-width: 300px)");
    expect(sidebarResourcesCss).toContain(
      ".desktop-git-section-actions .desktop-git-operation-label",
    );
    expect(compact(sidebarResourcesCss)).toContain(compact(`
      @container git-sidebar (max-width: 300px) {
        .desktop-git-section-actions .desktop-git-operation-button {
          width: var(--git-action-size);
          flex: 0 0 var(--git-action-size);
          gap: 0;
          padding-inline: 0;
        }

        .desktop-git-section-actions .desktop-git-operation-label {
          display: none;
        }
      }
    `));
    expect(compact(readCssBlock(
      sidebarResourcesCss,
      ".desktop-git-operation-label",
    ))).toContain("min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;");
    expect(compact(readCssBlock(
      sidebarResourcesCss,
      ".desktop-git-section-actions",
    ))).toContain("min-width: 0; max-width: 100%; flex: 0 1 auto;");
    expect(sourceControlSidebarSectionsSource).toContain(
      'const Icon = icon === "upload" ? ArrowUp : ArrowDown;',
    );
  });

  it("assigns solid emphasis to only the next workflow action", () => {
    const operation = compact(readCssBlock(
      sidebarResourcesCss,
      ".desktop-git-operation-button",
    ));
    const primary = compact(readCssBlock(
      sidebarResourcesCss,
      ".desktop-git-operation-button.is-primary",
    ));
    const select = (overrides: Partial<Parameters<typeof getSourceControlPrimaryActionSlot>[0]> = {}) => (
      getSourceControlPrimaryActionSlot({
        hasConflicts: false,
        hasOperationAction: false,
        hasStagedAction: false,
        hasSyncAction: false,
        hasCommittedAction: false,
        hasStageAndCommitAction: false,
        ...overrides,
      })
    );

    expect(operation).toContain("background: var(--po-control);");
    expect(operation).not.toContain("background: transparent;");
    expect(primary).toContain("background: var(--desktop-git-primary-bg);");
    expect(primary).toContain("color: var(--desktop-git-primary-fg);");
    expect(sourceControlSidebarSectionsSource).toContain(
      'className="desktop-git-commit-staged-action"',
    );
    expect(sourceControlSidebarSectionsSource).toContain(
      'className="desktop-git-stage-commit-action"',
    );
    expect(select({ hasStagedAction: true, hasSyncAction: true, hasCommittedAction: true })).toBe("sync");
    expect(select({ hasConflicts: true, hasStagedAction: true, hasSyncAction: true, hasCommittedAction: true })).toBeNull();
    expect(select({ hasOperationAction: true, hasSyncAction: true })).toBe("operation");
    expect(select({ hasSyncAction: true, hasCommittedAction: true })).toBe("sync");
    expect(select({ hasCommittedAction: true, hasStageAndCommitAction: true })).toBe("committed");
    expect(select({ hasStageAndCommitAction: true })).toBe("stage-and-commit");
    expect(select()).toBeNull();
  });

  it("keeps diff typography dense and color subordinate to content", () => {
    const surface = compact(readCssBlock(diffCss, ".desktop-file-diff"));
    const lines = compact(readCssBlock(diffCss, ".desktop-diff-line"));
    const added = compact(readCssBlock(diffCss, ".desktop-diff-line.add"));
    const removed = compact(readCssBlock(diffCss, ".desktop-diff-line.remove"));
    const lineNumber = compact(readCssBlock(diffCss, ".desktop-diff-line .line-number"));
    const linePrefix = compact(readCssBlock(diffCss, ".desktop-diff-line .line-prefix"));
    const lineCode = compact(readCssBlock(diffCss, ".desktop-diff-line code"));

    expect(lines).toContain("font-size: var(--po-type-ui-meta, 13px);");
    expect(lines).toContain("line-height: 18px;");
    expect(surface).toContain(
      "--desktop-git-diff-code-bg: color-mix(in srgb, var(--po-panel) 62%, var(--po-inset));",
    );
    expect(surface).toContain(
      "--desktop-git-diff-added-bg: color-mix(in srgb, var(--po-success) 7%, var(--desktop-git-diff-code-bg));",
    );
    expect(surface).toContain(
      "--desktop-git-diff-removed-bg: color-mix(in srgb, var(--po-danger) 7%, var(--desktop-git-diff-code-bg));",
    );
    expect(added).toContain("color: var(--desktop-git-diff-added-text);");
    expect(removed).toContain("color: var(--desktop-git-diff-removed-text);");
    expect(lineNumber).toContain("width: 42px;");
    expect(linePrefix).toContain("width: 18px;");
    expect(linePrefix).toContain("font-weight: 650;");
    expect(lineCode).toContain("white-space: pre-wrap;");
    expect(diffCss).not.toContain('[data-diff-markers="color"] .desktop-diff-line .line-prefix');

    const hunkBranch = textDiffSource.slice(
      textDiffSource.indexOf('if (line.kind === "hunk")'),
      textDiffSource.indexOf("const prefix =", textDiffSource.indexOf('if (line.kind === "hunk")')),
    );
    const hunkSeparator = compact(readCssBlock(diffCss, ".desktop-diff-hunk-separator"));
    expect(hunkBranch).toContain('className="desktop-diff-hunk-separator"');
    expect(hunkBranch).not.toContain("line.text");
    expect(hunkSeparator).toContain("height: 7px;");

    const lineView = textDiffSource.slice(textDiffSource.indexOf("function DiffLineView"));
    expect(lineView).toContain('line.kind === "remove" ? line.oldLine : line.newLine ?? line.oldLine');
    expect(lineView.match(/className="line-number"/g)).toHaveLength(1);
    expect(lineView).toContain('className="line-prefix"');
  });

  it("keeps sidebar metadata quieter while preserving the shared file-icon system", () => {
    const sidebar = compact(readCssBlock(sidebarBaseCss, ".desktop-git-sidebar"));
    const workingTreeMain = compact(readCssBlock(
      sidebarResourcesCss,
      ".desktop-working-tree-main",
    ));

    expect(sidebar).toContain(
      "--git-font-main: var(--desktop-sidebar-font-size, var(--po-type-left-sidebar-content, 14px));",
    );
    expect(sidebar).toContain(
      "--git-font-small: var(--desktop-sidebar-font-size-meta, var(--po-type-left-sidebar-meta, 12px));",
    );
    expect(sidebar).toContain(
      "--git-line-height: var(--desktop-sidebar-line-height, 18px);",
    );
    expect(sidebar).toContain(
      "--git-weight-regular: var(--desktop-sidebar-font-weight, var(--po-text-weight-medium, 500));",
    );
    expect(sidebar).toContain(
      "--git-weight-strong: var(--desktop-sidebar-font-weight-emphasis, 650);",
    );
    expect(sidebar).toContain(
      "--git-icon-label-gap: var(--desktop-sidebar-icon-label-gap, 4px);",
    );
    expect(historyListCss).toContain("font-size: var(--git-font-main);");
    expect(historyListCss).toContain("font-weight: var(--git-weight-regular);");
    expect(historyListCss).toContain("line-height: var(--git-line-height);");
    expect(historyListCss).toContain(".desktop-working-tree-main,");
    expect(historyListCss).toContain(".desktop-working-tree-name\n");
    expect(sourceControlComponentsSource).not.toContain("desktop-working-tree-dir");
    expect(sidebarResourcesCss).not.toContain(".desktop-working-tree-dir");
    expect(historyListCss).not.toContain(
      ".desktop-git-sidebar .desktop-working-tree-row.active .desktop-working-tree-name",
    );
    expect(workingTreeMain).toContain("gap: var(--git-icon-label-gap);");
    expect(sourceControlComponentsSource.match(/<FileGlyphIcon[^>]+size=\{18\}/g)).toHaveLength(2);
    expect(sourceControlComponentsSource).not.toContain("size={15}");
    expect(sidebarResourcesCss).not.toContain("filter: grayscale(1);");
  });

  it("keeps the History timeline to collapsible date dividers and one-line commit messages", () => {
    const row = compact(readCssBlock(historyListCss, ".desktop-history-row"));
    const date = compact(readCssBlock(historyListCss, ".desktop-history-date-group button"));
    const divider = compact(readCssBlock(historyListCss, ".desktop-history-date-divider"));
    const message = compact(readCssBlock(historyListCss, ".desktop-history-row-message"));
    const stat = compact(readCssBlock(historyListCss, ".desktop-history-row-stat"));
    const files = compact(readCssBlock(historyListCss, ".desktop-history-row-files"));
    const fileCount = compact(readCssBlock(historyListCss, ".desktop-history-row-file-count"));
    const deletedFile = compact(readCssBlock(
      historyListCss,
      '.desktop-history-row-file[data-status="deleted"] bdi',
    ));

    expect(historyTimelineSource).toContain('className="desktop-history-row-message"');
    expect(historyTimelineSource).toContain('className="desktop-history-date-group"');
    expect(historyTimelineSource).toContain("<FileGlyphIcon");
    expect(historyTimelineSource).toContain("aria-expanded={!row.collapsed}");
    expect(historyTimelineSource).toContain("collapsedDateKeys");
    expect(historyTimelineSource).not.toContain('className="desktop-history-dot"');
    expect(historyTimelineSource).not.toContain('className="desktop-history-row-meta"');
    expect(historyTimelineSource).toContain('className="desktop-history-row-stat"');
    expect(historyTimelineSource).not.toContain("commit.commit_id.slice");
    expect(historyTimelineSource).toContain("change.path");
    expect(historyTimelineSource).not.toContain("commit.author_name");
    expect(historyTimelineSource).not.toContain("formatHistoryRelativeTime");
    expect(row).toContain("height: var(--desktop-history-row-height, var(--desktop-sidebar-row-height));");
    expect(row).toContain("overflow: hidden;");
    expect(date).toContain("display: flex;");
    expect(divider).toContain("flex: 1 1 auto;");
    expect(row).toContain("padding-inline-start: 22px;");
    expect(message).toContain("overflow: hidden;");
    expect(message).toContain("text-overflow: ellipsis;");
    expect(message).toContain("white-space: nowrap;");
    expect(stat).toContain("font-variant-numeric: tabular-nums;");
    expect(files).toContain("overflow: hidden;");
    expect(files).toContain("flex-direction: column;");
    expect(fileCount).toContain("display: block;");
    expect(fileCount).not.toContain("margin-inline-start: auto;");
    expect(deletedFile).toContain("text-decoration: line-through;");
    expect(historyTimelineSource).toContain('notation: "compact"');
    expect(historyTimelineSource).toContain("maximumFractionDigits: 1");
  });
});

function readCssBlock(css: string, selector: string): string {
  const match = new RegExp(`(?:^|\\n)\\s*${escapeRegExp(selector)}\\s*\\{`).exec(css);
  if (!match) throw new Error(`Missing CSS block for ${selector}`);
  const bodyStart = match.index + match[0].length;
  const close = /\n\s*}/.exec(css.slice(bodyStart));
  if (!close) throw new Error(`Unclosed CSS block for ${selector}`);
  return css.slice(bodyStart, bodyStart + close.index);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
