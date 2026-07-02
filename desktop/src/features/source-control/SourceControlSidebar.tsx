import { ArrowDown, ArrowUp, Clock3, Cloud, Minus, Plus, Undo2, X } from "lucide-react";
import type { FileIconThemeId } from "@puppyone/shared-ui";
import {
  Fragment,
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import type { GitStatusSnapshot, PuppyoneWorkspaceConfig } from "../../types/electron";
import type { GitDisplayMode } from "../../preferences";
import {
  SourceControlPreviewResourceList,
  SourceControlResourceGroup,
  SourceControlSectionHeader,
  SourceControlWorkingTreeRow,
} from "./components";
import type { GitActionIconKind, GitMainPanel, GitSyncState, GitWorkingSelection } from "./types";
import {
  buildSourceControlSidebarModel,
  getGitScmSyncSection,
  getGitSyncState,
} from "./viewModel";

export type GitSidebarProps = {
  status: GitStatusSnapshot | null;
  puppyoneConfig: PuppyoneWorkspaceConfig | null;
  gitDisplayMode: GitDisplayMode;
  fileIconTheme: FileIconThemeId;
  activePanel: GitMainPanel;
  selectedWorkingFile: GitWorkingSelection | null;
  operationLoading: string | null;
  operationError: string | null;
  loading: boolean;
  error: string | null;
  onSelectPanel: (panel: GitMainPanel) => void;
  onSelectWorkingFile: (selection: GitWorkingSelection) => void;
  onStagePaths: (paths: string[]) => Promise<boolean>;
  onStageAll: () => Promise<boolean>;
  onUnstagePaths: (paths: string[]) => Promise<boolean>;
  onUnstageAll: () => Promise<boolean>;
  onDiscardPaths: (paths: string[]) => Promise<boolean>;
  onDiscardAll: () => Promise<boolean>;
  onStageAndCommit: () => Promise<boolean>;
  onCommit: () => Promise<boolean>;
  onCommitAndPush: () => Promise<boolean>;
  onPull: () => Promise<boolean>;
  onPush: () => Promise<boolean>;
  onPublish: () => Promise<boolean>;
  cloudBackupLoading: boolean;
  cloudBackupError: string | null;
  onStartPuppyoneBackup: () => void;
  onInitializeRepository: () => Promise<boolean>;
};

type GitSidebarPanelId = "remote" | "merge" | "committed" | "staged" | "unstaged";

type GitSidebarPanel = {
  id: GitSidebarPanelId;
  className: string;
  grow: number;
  expanded: boolean;
  bodyRows: number;
  content: ReactNode;
};

const GIT_SIDEBAR_PANEL_MAX_VISIBLE_ROWS = 9;
const GIT_SIDEBAR_PANEL_EMPTY_BODY_ROWS = 1.5;
const GIT_SIDEBAR_PANEL_MIN_HEIGHT: Record<GitSidebarPanelId, number> = {
  remote: 72,
  merge: 72,
  committed: 72,
  staged: 72,
  unstaged: 72,
};

function getPanelBodyRows(resourceCount: number, hasBodyPlaceholder = false) {
  if (resourceCount > 0) return resourceCount;
  return hasBodyPlaceholder ? GIT_SIDEBAR_PANEL_EMPTY_BODY_ROWS : 0;
}

export function GitSidebar({
  status,
  puppyoneConfig,
  gitDisplayMode,
  fileIconTheme,
  activePanel,
  selectedWorkingFile,
  operationLoading,
  operationError,
  loading,
  error,
  onSelectPanel,
  onSelectWorkingFile,
  onStagePaths,
  onStageAll,
  onUnstagePaths,
  onUnstageAll,
  onDiscardPaths,
  onDiscardAll,
  onStageAndCommit,
  onCommit,
  onCommitAndPush,
  onPull,
  onPush,
  onPublish,
  cloudBackupLoading,
  cloudBackupError,
  onStartPuppyoneBackup,
  onInitializeRepository,
}: GitSidebarProps) {
  const [backupCardDismissed, setBackupCardDismissed] = useState(false);
  const [remoteExpanded, setRemoteExpanded] = useState(true);
  const [committedExpanded, setCommittedExpanded] = useState(true);
  const [stagedExpanded, setStagedExpanded] = useState(true);
  const [workingExpanded, setWorkingExpanded] = useState(true);
  const [panelHeights, setPanelHeights] = useState<Partial<Record<GitSidebarPanelId, number>>>({});
  const [activeResizeSplit, setActiveResizeSplit] = useState<string | null>(null);
  const panelRefs = useRef<Partial<Record<GitSidebarPanelId, HTMLDivElement | null>>>({});
  const sourceControl = status?.sourceControl ?? null;
  const historyCommits = status?.allCommits ?? status?.commits ?? [];
  const currentBranch = status?.branches.find((branch) => branch.current) ?? null;
  const syncState = getGitSyncState(status, currentBranch, puppyoneConfig);
  const historyCount = historyCommits.length || status?.totalCommits || 0;
  const disabled = Boolean(operationLoading) || loading || !status?.isRepo;
  const canCommit = !disabled && sourceControl?.actions.canCommit === true;
  const {
    professionalMode,
    mergeResources,
    stagedResources,
    workingResources,
    localChangeResources,
    committedCount,
    committedResources,
    committedPrimaryAction,
    showCommittedSection,
    stagedPrimaryAction,
    showSimpleChangeAction,
  } = buildSourceControlSidebarModel({
    status,
    syncState,
    displayMode: gitDisplayMode,
    canCommit,
  });
  const remoteSection = !syncState.setupRequired ? getGitScmSyncSection(status, syncState) : null;

  const setPanelRef = useCallback((id: GitSidebarPanelId, node: HTMLDivElement | null) => {
    panelRefs.current[id] = node;
  }, []);

  const beginPanelResize = useCallback((
    event: ReactPointerEvent<HTMLDivElement>,
    previous: GitSidebarPanelId,
    next: GitSidebarPanelId,
  ) => {
    if (event.button !== 0) return;
    const previousNode = panelRefs.current[previous];
    const nextNode = panelRefs.current[next];
    if (!previousNode || !nextNode) return;

    const previousStart = previousNode.getBoundingClientRect().height;
    const nextStart = nextNode.getBoundingClientRect().height;
    const totalHeight = previousStart + nextStart;
    const previousMin = getPanelComputedMinHeight(previousNode, GIT_SIDEBAR_PANEL_MIN_HEIGHT[previous]);
    const nextMin = getPanelComputedMinHeight(nextNode, GIT_SIDEBAR_PANEL_MIN_HEIGHT[next]);
    if (totalHeight < previousMin + nextMin) return;

    const startY = event.clientY;
    const splitId = `${previous}:${next}`;
    event.preventDefault();
    setActiveResizeSplit(splitId);
    document.body.classList.add("desktop-git-sidebar-resizing");

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientY - startY;
      const previousMax = getPanelComputedMaxHeight(previousNode, previousStart);
      const nextMax = getPanelComputedMaxHeight(nextNode, nextStart);
      const previousLowerBound = Math.max(previousMin, totalHeight - nextMax);
      const previousUpperBound = Math.min(previousMax, totalHeight - nextMin);
      if (previousLowerBound > previousUpperBound) return;

      const nextPreviousHeight = clampNumber(previousStart + delta, previousLowerBound, previousUpperBound);
      const nextNextHeight = totalHeight - nextPreviousHeight;
      setPanelHeights((current) => ({
        ...current,
        [previous]: Math.round(nextPreviousHeight),
        [next]: Math.round(nextNextHeight),
      }));
    };

    const stopResize = () => {
      setActiveResizeSplit(null);
      document.body.classList.remove("desktop-git-sidebar-resizing");
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);
  }, []);

  const getPanelStyle = useCallback((panel: GitSidebarPanel): CSSProperties => {
    if (!panel.expanded) {
      return {
        flex: "0 0 var(--desktop-sidebar-row-height)",
        maxHeight: "var(--desktop-sidebar-row-height)",
        minHeight: "var(--desktop-sidebar-row-height)",
      };
    }
    const visibleBodyRows = clampNumber(panel.bodyRows, 0, GIT_SIDEBAR_PANEL_MAX_VISIBLE_ROWS);
    const maxHeight = visibleBodyRows > 0
      ? `calc(var(--desktop-sidebar-row-height) * ${visibleBodyRows + 1} + 8px)`
      : "var(--desktop-sidebar-row-height)";
    const minHeight = `min(${GIT_SIDEBAR_PANEL_MIN_HEIGHT[panel.id]}px, ${maxHeight})`;
    const height = panelHeights[panel.id];
    if (typeof height === "number") {
      return {
        flex: `0 1 ${height}px`,
        maxHeight,
        minHeight,
      };
    }
    return {
      flexGrow: panel.grow,
      maxHeight,
      minHeight,
    };
  }, [panelHeights]);

  const panels: GitSidebarPanel[] = [];

  if (!syncState.setupRequired) {
    panels.push({
      id: "remote",
      className: "remote",
      grow: 1.05,
      expanded: remoteExpanded,
      bodyRows: getPanelBodyRows(remoteSection?.previewResources.length ?? 0, Boolean(remoteSection?.fallbackSummary)),
      content: (
        <GitScmSyncRow
          status={status}
          state={syncState}
          fileIconTheme={fileIconTheme}
          expanded={remoteExpanded}
          selectedWorkingFile={selectedWorkingFile}
          disabled={disabled}
          operationLoading={operationLoading}
          onToggleExpanded={() => setRemoteExpanded((expanded) => !expanded)}
          onSelectWorkingFile={onSelectWorkingFile}
          onPull={onPull}
          onPush={onPush}
          onPublish={onPublish}
        />
      ),
    });
  }

  if (mergeResources.length > 0) {
    panels.push({
      id: "merge",
      className: "merge",
      grow: 0.9,
      expanded: true,
      bodyRows: getPanelBodyRows(mergeResources.length),
      content: (
        <SourceControlResourceGroup
          title="Merge Changes"
          resources={mergeResources}
          selectedWorkingFile={selectedWorkingFile}
          operationLoading={operationLoading}
          fileIconTheme={fileIconTheme}
          onSelectWorkingFile={onSelectWorkingFile}
          onStagePaths={onStagePaths}
          onUnstagePaths={onUnstagePaths}
          onDiscardPaths={onDiscardPaths}
        />
      ),
    });
  }

  if (showCommittedSection) {
    panels.push({
      id: "committed",
      className: "committed",
      grow: 1.05,
      expanded: committedExpanded,
      bodyRows: getPanelBodyRows(committedResources.length, true),
      content: (
        <>
          <SourceControlSectionHeader
            title="Committed Changes"
            count={committedCount}
            highlightCount={committedCount > 0}
            expanded={committedExpanded}
            onToggle={() => setCommittedExpanded((expanded) => !expanded)}
            action={committedPrimaryAction ? (
              <GitOperationButton
                className="desktop-git-commit-push-action"
                title={committedPrimaryAction.title}
                disabled={disabled || committedPrimaryAction.disabled}
                icon={committedPrimaryAction.icon}
                label={committedPrimaryAction.label}
                loadingKey={committedPrimaryAction.loadingKey}
                loadingLabel={committedPrimaryAction.loadingLabel}
                operationLoading={operationLoading}
                onClick={() => {
                  if (committedPrimaryAction.kind === "push") void onPush();
                  if (committedPrimaryAction.kind === "publish") void onPublish();
                }}
              />
            ) : null}
          />
          <GitSectionCollapse expanded={committedExpanded}>
            {committedCount === 0 ? (
              <div className="desktop-tool-sidebar-empty compact desktop-git-empty-committed">Empty</div>
            ) : committedResources.length > 0 ? (
              <SourceControlPreviewResourceList
                resources={committedResources}
                fileIconTheme={fileIconTheme}
                selectedWorkingFile={selectedWorkingFile}
                origin="committed"
                ariaLabel="Committed change preview"
                onSelectWorkingFile={onSelectWorkingFile}
              />
            ) : (
              <div className="desktop-git-committed-summary">
                {committedCount === 1 ? "1 local commit is ready to push." : `${committedCount} local commits are ready to push.`}
              </div>
            )}
          </GitSectionCollapse>
        </>
      ),
    });
  }

  if (professionalMode) {
    panels.push({
      id: "staged",
      className: "staged",
      grow: 0.9,
      expanded: stagedExpanded,
      bodyRows: getPanelBodyRows(stagedResources.length, true),
      content: (
        <>
          <SourceControlSectionHeader
            title="Staged Changes"
            count={stagedResources.length}
            expanded={stagedExpanded}
            onToggle={() => setStagedExpanded((expanded) => !expanded)}
            action={stagedPrimaryAction ? (
              <div className="desktop-git-section-actions">
                {stagedResources.length > 0 && (
                  <button
                    className="desktop-tool-sidebar-icon"
                    type="button"
                    title="Unstage all"
                    aria-label="Unstage all"
                    disabled={disabled}
                    onClick={() => void onUnstageAll()}
                  >
                    <Minus size={13} />
                  </button>
                )}
                <GitOperationButton
                  className="desktop-git-commit-push-action"
                  title={stagedPrimaryAction.title}
                  disabled={disabled || stagedPrimaryAction.disabled}
                  icon={stagedPrimaryAction.icon}
                  label={stagedPrimaryAction.label}
                  loadingKey={stagedPrimaryAction.loadingKey}
                  loadingLabel={stagedPrimaryAction.loadingLabel}
                  operationLoading={operationLoading}
                  onClick={() => {
                    if (stagedPrimaryAction.kind === "commit") void onCommit();
                    if (stagedPrimaryAction.kind === "commit-push") void onCommitAndPush();
                    if (stagedPrimaryAction.kind === "push") void onPush();
                    if (stagedPrimaryAction.kind === "publish") void onPublish();
                  }}
                />
              </div>
            ) : null}
          />
          <GitSectionCollapse expanded={stagedExpanded}>
            {stagedResources.length === 0 ? (
              <div className="desktop-tool-sidebar-empty compact desktop-git-empty-stage">Empty</div>
            ) : (
              <div className="desktop-working-tree-list">
                {stagedResources.map((resource) => (
                  <SourceControlWorkingTreeRow
                    resource={resource}
                    key={resource.id}
                    selected={selectedWorkingFile?.staged === true && selectedWorkingFile.path === resource.path}
                    operationLoading={operationLoading}
                    fileIconTheme={fileIconTheme}
                    onSelect={onSelectWorkingFile}
                    onStagePaths={onStagePaths}
                    onUnstagePaths={onUnstagePaths}
                    onDiscardPaths={onDiscardPaths}
                  />
                ))}
              </div>
            )}
          </GitSectionCollapse>
        </>
      ),
    });
  }

  panels.push({
    id: "unstaged",
    className: "unstaged",
    grow: 1.15,
    expanded: workingExpanded,
    bodyRows: getPanelBodyRows(localChangeResources.length, true),
    content: (
      <>
        <SourceControlSectionHeader
          title="Unstaged Changes"
          count={localChangeResources.length}
          expanded={workingExpanded}
          onToggle={() => setWorkingExpanded((expanded) => !expanded)}
          action={professionalMode ? (
            workingResources.length > 0 ? (
              <div className="desktop-git-section-actions">
                <button
                  className="desktop-tool-sidebar-icon danger"
                  type="button"
                  title="Discard all"
                  aria-label="Discard all"
                  disabled={disabled}
                  onClick={() => void onDiscardAll()}
                >
                  <Undo2 size={13} />
                </button>
                <button
                  className="desktop-tool-sidebar-icon primary"
                  type="button"
                  title="Stage all"
                  aria-label="Stage all"
                  disabled={disabled}
                  onClick={() => void onStageAll()}
                >
                  <Plus size={13} />
                </button>
              </div>
            ) : null
          ) : showSimpleChangeAction ? (
            <div className="desktop-git-section-actions">
              {workingResources.length > 0 && (
                <button
                  className="desktop-tool-sidebar-icon danger"
                  type="button"
                  title="Discard all"
                  aria-label="Discard all"
                  disabled={disabled}
                  onClick={() => void onDiscardAll()}
                >
                  <Undo2 size={13} />
                </button>
              )}
              <GitOperationButton
                className="desktop-git-commit-push-action desktop-git-stage-commit-action"
                title="Stage all local changes and commit them."
                disabled={disabled}
                icon="plus"
                label="Stage & Commit"
                loadingKey="stage-commit"
                loadingLabel="Committing..."
                operationLoading={operationLoading}
                onClick={() => void onStageAndCommit()}
              />
            </div>
          ) : null}
        />
        <GitSectionCollapse expanded={workingExpanded}>
          {localChangeResources.length === 0 ? (
            <div className="desktop-tool-sidebar-empty compact desktop-git-empty-changes">Empty</div>
          ) : (
            <div className="desktop-working-tree-list">
              {localChangeResources.map((resource) => (
                <SourceControlWorkingTreeRow
                  resource={resource}
                  key={resource.id}
                  selected={selectedWorkingFile?.staged === (resource.group === "index") && selectedWorkingFile.path === resource.path}
                  operationLoading={operationLoading}
                  fileIconTheme={fileIconTheme}
                  onSelect={onSelectWorkingFile}
                  onStagePaths={onStagePaths}
                  onUnstagePaths={onUnstagePaths}
                  onDiscardPaths={onDiscardPaths}
                />
              ))}
            </div>
          )}
        </GitSectionCollapse>
      </>
    ),
  });

  return (
    <section className="desktop-tool-sidebar desktop-git-sidebar">
      <div className="desktop-tool-sidebar-list desktop-git-sidebar-list">
        {error ? (
          <div className="desktop-tool-sidebar-empty danger">{error}</div>
        ) : status && !status.isRepo ? (
          <div className="desktop-tool-sidebar-empty vertical">
            <span>No repository</span>
            {operationError && <small className="desktop-tool-sidebar-error-text">{operationError}</small>}
            <button
              className="desktop-tool-sidebar-action"
              type="button"
              disabled={Boolean(operationLoading)}
              onClick={() => void onInitializeRepository()}
            >
              Initialize Repository
            </button>
          </div>
        ) : loading && !status ? (
          <div className="desktop-tool-sidebar-empty">Reading Git...</div>
        ) : (
          <>
            <div className="desktop-git-fixed-region">
              <GitRemotePrompt
                state={syncState}
                disabled={disabled}
                cloudBackupLoading={cloudBackupLoading}
                cloudBackupError={cloudBackupError}
                dismissed={backupCardDismissed}
                onDismiss={() => setBackupCardDismissed(true)}
                onStartPuppyoneBackup={onStartPuppyoneBackup}
              />

              {operationError && <div className="desktop-git-operation-error">{operationError}</div>}
            </div>

            <div className="desktop-git-resizable-stack">
              {panels.map((panel, index) => (
                <Fragment key={panel.id}>
                  {index > 0 && (
                    <GitSidebarSectionResizer
                      previous={panels[index - 1].id}
                      next={panel.id}
                      active={activeResizeSplit === `${panels[index - 1].id}:${panel.id}`}
                      onPointerDown={beginPanelResize}
                    />
                  )}
                  <div
                    ref={(node) => setPanelRef(panel.id, node)}
                    className={`desktop-git-resizable-section desktop-git-resizable-section-${panel.className} ${panel.expanded ? "expanded" : "collapsed"}`}
                    style={getPanelStyle(panel)}
                  >
                    {panel.content}
                  </div>
                </Fragment>
              ))}
            </div>

            <GitHistoryShortcut
              active={activePanel === "history"}
              count={historyCount}
              onSelect={() => onSelectPanel("history")}
            />
          </>
        )}
      </div>
    </section>
  );
}

function GitSectionCollapse({
  expanded,
  children,
}: {
  expanded: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`desktop-git-section-collapse ${expanded ? "expanded" : "collapsed"}`}>
      <div className="desktop-git-section-collapse-inner">
        {children}
      </div>
    </div>
  );
}

function GitSidebarSectionResizer({
  previous,
  next,
  active,
  onPointerDown,
}: {
  previous: GitSidebarPanelId;
  next: GitSidebarPanelId;
  active: boolean;
  onPointerDown: (
    event: ReactPointerEvent<HTMLDivElement>,
    previous: GitSidebarPanelId,
    next: GitSidebarPanelId,
  ) => void;
}) {
  return (
    <div
      className={`desktop-git-section-resizer ${active ? "active" : ""}`}
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize Git sidebar sections"
      onPointerDown={(event) => onPointerDown(event, previous, next)}
    />
  );
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getPanelComputedMaxHeight(node: HTMLElement, fallback: number) {
  const computedMaxHeight = window.getComputedStyle(node).maxHeight;
  if (!computedMaxHeight || computedMaxHeight === "none") return Number.POSITIVE_INFINITY;
  const parsed = Number.parseFloat(computedMaxHeight);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getPanelComputedMinHeight(node: HTMLElement, fallback: number) {
  const computedMinHeight = window.getComputedStyle(node).minHeight;
  if (!computedMinHeight || computedMinHeight === "auto") return fallback;
  const parsed = Number.parseFloat(computedMinHeight);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function GitRemotePrompt({
  state,
  disabled,
  cloudBackupLoading,
  cloudBackupError,
  dismissed,
  onDismiss,
  onStartPuppyoneBackup,
}: {
  state: GitSyncState;
  disabled: boolean;
  cloudBackupLoading: boolean;
  cloudBackupError: string | null;
  dismissed: boolean;
  onDismiss: () => void;
  onStartPuppyoneBackup: () => void;
}) {
  if (state.setupRequired) {
    if (dismissed && !cloudBackupError) return null;

    return (
      <section className="desktop-git-backup-card">
        <div className="desktop-git-backup-copy">
          <span>This workspace is not backed up to PuppyOne Cloud.</span>
        </div>
        <button
          className="desktop-git-backup-action"
          type="button"
          aria-busy={cloudBackupLoading || undefined}
          disabled={disabled || cloudBackupLoading}
          onClick={onStartPuppyoneBackup}
        >
          {cloudBackupLoading ? <SourceControlDots /> : <Cloud size={13} />}
          <span>Get Cloud</span>
        </button>
        <button
          className="desktop-git-backup-dismiss"
          type="button"
          aria-label="Dismiss backup reminder"
          title="Dismiss"
          disabled={cloudBackupLoading}
          onClick={onDismiss}
        >
          <X size={13} />
        </button>
        {cloudBackupError && <div className="desktop-git-backup-error">{cloudBackupError}</div>}
      </section>
    );
  }

  return null;
}

function GitScmSyncRow({
  status,
  state,
  fileIconTheme,
  expanded,
  selectedWorkingFile,
  disabled,
  operationLoading,
  onToggleExpanded,
  onSelectWorkingFile,
  onPull,
  onPush,
  onPublish,
}: {
  status: GitStatusSnapshot | null;
  state: GitSyncState;
  fileIconTheme: FileIconThemeId;
  expanded: boolean;
  selectedWorkingFile: GitWorkingSelection | null;
  disabled: boolean;
  operationLoading: string | null;
  onToggleExpanded: () => void;
  onSelectWorkingFile: (selection: GitWorkingSelection) => void;
  onPull: () => Promise<boolean>;
  onPush: () => Promise<boolean>;
  onPublish: () => Promise<boolean>;
}) {
  const section = getGitScmSyncSection(status, state);

  return (
    <section className={`desktop-git-remote-status desktop-git-scm-sync ${section.copy.tone}`}>
      <SourceControlSectionHeader
        title={section.copy.title}
        count={section.copy.count}
        highlightCount={section.copy.count > 0}
        expanded={expanded}
        onToggle={onToggleExpanded}
        action={section.action ? (
          <GitOperationButton
            className="desktop-git-remote-action"
            disabled={disabled || section.action.disabled}
            title={section.action.title}
            icon={section.action.icon}
            label={section.action.label}
            loadingKey={section.action.kind}
            loadingLabel={section.action.loadingLabel}
            operationLoading={operationLoading}
            onClick={() => {
              if (section.action?.kind === "pull") void onPull();
              if (section.action?.kind === "push") void onPush();
              if (section.action?.kind === "publish") void onPublish();
            }}
          />
        ) : null}
      />
      {section.previewResources.length > 0 && (
        <GitSectionCollapse expanded={expanded}>
          <SourceControlPreviewResourceList
            resources={section.previewResources}
            fileIconTheme={fileIconTheme}
            selectedWorkingFile={selectedWorkingFile}
            origin="remote"
            ariaLabel="Remote change preview"
            onSelectWorkingFile={onSelectWorkingFile}
          />
        </GitSectionCollapse>
      )}
      {section.previewResources.length === 0 && section.fallbackSummary && (
        <GitSectionCollapse expanded={expanded}>
          <div className="desktop-git-preview-summary">{section.fallbackSummary}</div>
        </GitSectionCollapse>
      )}
    </section>
  );
}

function GitOperationButton({
  className,
  title,
  disabled,
  icon,
  label,
  loadingKey,
  loadingLabel,
  operationLoading,
  onClick,
}: {
  className: string;
  title: string;
  disabled: boolean;
  icon: GitActionIconKind;
  label: string;
  loadingKey: string;
  loadingLabel: string;
  operationLoading: string | null;
  onClick: () => void;
}) {
  const loading = operationLoading === loadingKey;

  return (
    <button
      className={`${className} ${loading ? "is-loading" : ""}`}
      type="button"
      title={title}
      aria-label={loading ? loadingLabel : label}
      aria-busy={loading || undefined}
      disabled={disabled}
      onClick={onClick}
    >
      {loading ? <SourceControlDots /> : renderGitActionIcon(icon)}
      <span>{label}</span>
    </button>
  );
}

function SourceControlDots() {
  return (
    <span className="desktop-git-loading-dots" data-puppy-loader="dots" role="status" aria-label="Loading">
      {[0, 1, 2].map((index) => (
        <span key={index} style={{ animationDelay: `${index * 0.16}s` }} />
      ))}
    </span>
  );
}

function renderGitActionIcon(icon: GitActionIconKind) {
  if (icon === "plus") return <Plus size={15} strokeWidth={2.25} aria-hidden="true" />;
  const Icon = icon === "upload" ? ArrowUp : ArrowDown;
  return <Icon className="desktop-git-action-arrow" size={15} strokeWidth={2.25} aria-hidden="true" />;
}

function GitHistoryShortcut({
  active,
  count,
  onSelect,
}: {
  active: boolean;
  count: number;
  onSelect: () => void;
}) {
  return (
    <section className="desktop-git-history-drawer">
      <button
        className={`desktop-git-history-drawer-header ${active ? "active" : ""}`}
        type="button"
        aria-pressed={active}
        onClick={onSelect}
      >
        <Clock3 size={13} />
        <span>History</span>
        <small>{count}</small>
      </button>
    </section>
  );
}
