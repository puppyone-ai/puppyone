import { useEffect, useState } from "react";
import { Check, Copy, FileText, GitBranch, GripVertical, Monitor, Moon, PanelBottom, PanelTop, Pencil, RefreshCw, Settings, ShieldCheck, SquareTerminal, Sun, Unlink } from "lucide-react";
import { FILE_ICON_THEMES, FileGlyphIcon } from "@puppyone/shared-ui";
import { DesktopUpdateSettingsRow } from "../../components/DesktopUpdateControls";
import { DEFAULT_EXPLORER_EXCLUDE_PATTERNS, SIDEBAR_NAVIGATION_LAYOUT_OPTIONS, normalizeExplorerExcludePatterns, type FilesVisibilitySettings, type RightSidebarToolId } from "../../preferences";
import type { GitStatusSnapshot, PuppyoneWorkspaceConfig } from "../../types/electron";
import { getPuppyoneRemote, maskRemoteUrl, parsePuppyoneRemote } from "../source-control/remotes";
import { SettingsGroup, SettingsLine, SettingsSectionHeader } from "./components";
import { PuppyoneWorkspaceConfigSettings } from "./PuppyoneWorkspaceConfigSettings";
import type { SettingsSidebarProps, SettingsViewProps, SettingsSection } from "./types";
import { remoteKindLabel, shortCommit, writeClipboardText } from "./utils";

const RIGHT_SIDEBAR_TOOL_DEFINITIONS = [
  {
    id: "terminal",
    label: "Terminal",
    icon: SquareTerminal,
  },
] as const satisfies Array<{
  id: RightSidebarToolId;
  label: string;
  icon: typeof SquareTerminal;
}>;

export function SettingsView({
  workspace,
  activeSection,
  gitStatus,
  gitStatusLoading,
  gitStatusError,
  themeMode,
  gitDisplayMode,
  fileIconTheme,
  sidebarNavigationLayout,
  filesVisibilitySettings,
  rightSidebarToolsSettings,
  aiEditAssistEnabled,
  puppyoneConfig,
  puppyoneConfigLoading,
  puppyoneConfigSaving,
  puppyoneConfigError,
  updateState,
  onThemeModeChange,
  onGitDisplayModeChange,
  onFileIconThemeChange,
  onSidebarNavigationLayoutChange,
  onFilesVisibilitySettingsChange,
  onRightSidebarToolsSettingsChange,
  onAiEditAssistEnabledChange,
  onPuppyoneConfigChange,
  onUnlinkWorkspace,
  onRefreshGitStatus,
  onCheckForUpdates,
  onUpdateNow,
}: SettingsViewProps) {
  const [unlinking, setUnlinking] = useState(false);
  const [unlinkError, setUnlinkError] = useState<string | null>(null);
  const [copiedRemoteKey, setCopiedRemoteKey] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [draggingRightSidebarToolId, setDraggingRightSidebarToolId] = useState<RightSidebarToolId | null>(null);
  const orderedRightSidebarTools = rightSidebarToolsSettings.order
    .map((toolId) => RIGHT_SIDEBAR_TOOL_DEFINITIONS.find((tool) => tool.id === toolId))
    .filter((tool): tool is typeof RIGHT_SIDEBAR_TOOL_DEFINITIONS[number] => Boolean(tool));

  const unlinkWorkspace = async () => {
    if (unlinking) return;
    const confirmed = window.confirm(
      `Unlink "${workspace.name}" from puppyone? Local files will stay on disk. You will choose a folder again next time.`,
    );
    if (!confirmed) return;

    setUnlinking(true);
    setUnlinkError(null);
    try {
      await onUnlinkWorkspace();
    } catch (error) {
      setUnlinkError(error instanceof Error ? error.message : String(error));
      setUnlinking(false);
    }
  };

  const copyRemoteUrl = async (key: string, url: string) => {
    setCopyError(null);
    try {
      await writeClipboardText(url);
      setCopiedRemoteKey(key);
      window.setTimeout(() => setCopiedRemoteKey((current) => current === key ? null : current), 1500);
    } catch (error) {
      setCopyError(error instanceof Error ? error.message : String(error));
    }
  };

  if (activeSection === "git") {
    return (
      <GitSettingsView
        status={gitStatus}
        loading={gitStatusLoading}
        error={gitStatusError}
        copiedRemoteKey={copiedRemoteKey}
        copyError={copyError}
        puppyoneConfig={puppyoneConfig}
        puppyoneConfigLoading={puppyoneConfigLoading}
        puppyoneConfigSaving={puppyoneConfigSaving}
        puppyoneConfigError={puppyoneConfigError}
        onCopyRemoteUrl={copyRemoteUrl}
        onPuppyoneConfigChange={onPuppyoneConfigChange}
        onRefresh={onRefreshGitStatus}
      />
    );
  }

  if (activeSection === "files") {
    return (
      <FilesSettingsView
        settings={filesVisibilitySettings}
        onChange={onFilesVisibilitySettingsChange}
      />
    );
  }

  if (activeSection === "editor") {
    return (
      <EditorSettingsView
        aiEditAssistEnabled={aiEditAssistEnabled}
        onAiEditAssistEnabledChange={onAiEditAssistEnabledChange}
      />
    );
  }

  if (activeSection === "appearance") {
    return (
      <section className="desktop-utility-view desktop-settings-view">
        <div className="desktop-utility-body desktop-settings-body">
          <div className="desktop-settings-section">
            <SettingsSectionHeader title="Appearance" detail="Local display preferences for this device." />
            <div className="desktop-settings-list">
              <div className="desktop-settings-row desktop-settings-row-control">
                <span>Theme</span>
                <div className="desktop-theme-segment" aria-label="Theme mode">
                  <button
                    className={themeMode === "system" ? "active" : ""}
                    type="button"
                    onClick={() => onThemeModeChange("system")}
                  >
                    <Monitor size={14} />
                    <span>System</span>
                  </button>
                  <button
                    className={themeMode === "light" ? "active" : ""}
                    type="button"
                    onClick={() => onThemeModeChange("light")}
                  >
                    <Sun size={14} />
                    <span>Light</span>
                  </button>
                  <button
                    className={themeMode === "dark" ? "active" : ""}
                    type="button"
                    onClick={() => onThemeModeChange("dark")}
                  >
                    <Moon size={14} />
                    <span>Dark</span>
                  </button>
                </div>
              </div>
              <div className="desktop-settings-row desktop-settings-row-control">
                <span>Git view</span>
                <div className="desktop-theme-segment" aria-label="Git view mode">
                  <button
                    className={gitDisplayMode === "simple" ? "active" : ""}
                    type="button"
                    title="Show Remote, Committed, and Changes. Stage is handled automatically when committing."
                    onClick={() => onGitDisplayModeChange("simple")}
                  >
                    <span>Simple</span>
                  </button>
                  <button
                    className={gitDisplayMode === "professional" ? "active" : ""}
                    type="button"
                    title="Show Remote, Committed, Staged, and Unstaged changes separately."
                    onClick={() => onGitDisplayModeChange("professional")}
                  >
                    <span>Professional</span>
                  </button>
                </div>
              </div>
              <div className="desktop-settings-row desktop-settings-row-control">
                <span>File icons</span>
                <div className="desktop-theme-segment desktop-file-icon-theme-segment" aria-label="File icon theme">
                  {FILE_ICON_THEMES.map((theme) => (
                    <button
                      key={theme.id}
                      className={fileIconTheme === theme.id ? "active" : ""}
                      type="button"
                      title={theme.description}
                      onClick={() => onFileIconThemeChange(theme.id)}
                    >
                      <FileGlyphIcon name="document.md" size={14} theme={theme.id} />
                      <span>{theme.label}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="desktop-settings-row desktop-settings-row-control">
                <span>Navigation</span>
                <div className="desktop-theme-segment desktop-sidebar-layout-segment" aria-label="Sidebar navigation layout">
                  {SIDEBAR_NAVIGATION_LAYOUT_OPTIONS.map((option) => {
                    const Icon = option.placement === "top" ? PanelTop : PanelBottom;
                    return (
                      <button
                        className={sidebarNavigationLayout === option.value ? "active" : ""}
                        type="button"
                        key={option.value}
                        onClick={() => onSidebarNavigationLayoutChange(option.value)}
                      >
                        <Icon size={14} />
                        <span>{option.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="desktop-settings-row desktop-settings-row-control desktop-settings-tools-row">
                <span>Right sidebar</span>
                <div className="desktop-settings-tool-list">
                  {orderedRightSidebarTools.map((tool) => {
                    const Icon = tool.icon;
                    return (
                      <div
                        className={`desktop-settings-tool-item ${draggingRightSidebarToolId === tool.id ? "dragging" : ""}`}
                        key={tool.id}
                        draggable={orderedRightSidebarTools.length > 1}
                        onDragStart={(event) => {
                          setDraggingRightSidebarToolId(tool.id);
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData("text/plain", tool.id);
                        }}
                        onDragOver={(event) => {
                          if (!draggingRightSidebarToolId || draggingRightSidebarToolId === tool.id) return;
                          event.preventDefault();
                          event.dataTransfer.dropEffect = "move";
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          const sourceToolId = readRightSidebarDragToolId(event.dataTransfer.getData("text/plain")) ?? draggingRightSidebarToolId;
                          if (!sourceToolId || sourceToolId === tool.id) return;
                          onRightSidebarToolsSettingsChange({
                            ...rightSidebarToolsSettings,
                            order: moveRightSidebarTool(rightSidebarToolsSettings.order, sourceToolId, tool.id),
                          });
                          setDraggingRightSidebarToolId(null);
                        }}
                        onDragEnd={() => setDraggingRightSidebarToolId(null)}
                      >
                        <span className="desktop-settings-tool-drag-handle" aria-hidden="true">
                          <GripVertical size={14} />
                        </span>
                        <span className="desktop-settings-tool-label">
                          <Icon size={14} />
                          <span>{tool.label}</span>
                        </span>
                        <label className="desktop-settings-switch">
                          <input
                            type="checkbox"
                            checked={rightSidebarToolsSettings.enabled[tool.id]}
                            onChange={(event) => onRightSidebarToolsSettingsChange({
                              ...rightSidebarToolsSettings,
                              enabled: {
                                ...rightSidebarToolsSettings.enabled,
                                [tool.id]: event.target.checked,
                              },
                            })}
                          />
                          <span aria-hidden="true" />
                        </label>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="desktop-utility-view desktop-settings-view">
      <div className="desktop-utility-body desktop-settings-body">
        <div className="desktop-settings-section">
          <SettingsSectionHeader title="General" detail="Local project settings for this desktop app." />
          <div className="desktop-settings-list">
            <div className="desktop-settings-row">
              <span>Name</span>
              <strong>{workspace.name}</strong>
            </div>
            <div className="desktop-settings-row">
              <span>Path</span>
              <strong>{workspace.path}</strong>
            </div>
            <div className="desktop-settings-row">
              <span>Mode</span>
              <strong>Local</strong>
            </div>
            <div className="desktop-settings-row">
              <span>Status</span>
              <strong className="desktop-settings-status">
                <ShieldCheck size={14} />
                Protected
              </strong>
            </div>
            <DesktopUpdateSettingsRow
              state={updateState}
              onCheckForUpdates={onCheckForUpdates}
              onUpdateNow={onUpdateNow}
            />
            <div className="desktop-settings-row desktop-settings-row-control">
              <span>Project binding</span>
              <button
                className="desktop-settings-action danger"
                type="button"
                disabled={unlinking}
                title="Unlink workspace"
                onClick={() => void unlinkWorkspace()}
              >
                <Unlink size={14} />
                <span>{unlinking ? "Unlinking..." : "Unlink"}</span>
              </button>
            </div>
            {unlinkError && <div className="desktop-utility-empty danger">{unlinkError}</div>}
          </div>
        </div>
      </div>
    </section>
  );
}

function EditorSettingsView({
  aiEditAssistEnabled,
  onAiEditAssistEnabledChange,
}: {
  aiEditAssistEnabled: boolean;
  onAiEditAssistEnabledChange: (enabled: boolean) => void;
}) {
  return (
    <section className="desktop-utility-view desktop-settings-view">
      <div className="desktop-utility-body desktop-settings-body">
        <div className="desktop-settings-section">
          <SettingsSectionHeader title="Editor" detail="Local editor and review preferences for this device." />
          <div className="desktop-settings-list">
            <div className="desktop-settings-row desktop-settings-row-control">
              <span className="desktop-settings-label-stack">
                <strong>AI edit assist</strong>
                <small>Show optional agent change markers and review card in editors. Off by default.</small>
              </span>
              <label className="desktop-settings-switch">
                <input
                  type="checkbox"
                  checked={aiEditAssistEnabled}
                  onChange={(event) => onAiEditAssistEnabledChange(event.target.checked)}
                />
                <span aria-hidden="true" />
              </label>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function FilesSettingsView({
  settings,
  onChange,
}: {
  settings: FilesVisibilitySettings;
  onChange: (settings: FilesVisibilitySettings) => void;
}) {
  const savedPatternText = settings.excludePatterns.join("\n");
  const [patternDraft, setPatternDraft] = useState(savedPatternText);
  const normalizedDraft = normalizeExplorerExcludePatterns(patternDraft);
  const patternsDirty = normalizedDraft.join("\n") !== savedPatternText;

  useEffect(() => {
    setPatternDraft(savedPatternText);
  }, [savedPatternText]);

  const applyPatterns = () => {
    onChange({
      ...settings,
      excludePatterns: normalizedDraft,
    });
  };

  const resetPatterns = () => {
    const nextPatterns = [...DEFAULT_EXPLORER_EXCLUDE_PATTERNS];
    setPatternDraft(nextPatterns.join("\n"));
    onChange({
      ...settings,
      excludePatterns: nextPatterns,
    });
  };

  return (
    <section className="desktop-utility-view desktop-settings-view">
      <div className="desktop-utility-body desktop-settings-body">
        <div className="desktop-settings-section desktop-files-settings-section">
          <SettingsSectionHeader title="Git Ignore" />

          <SettingsGroup title="Ignored files">
            <div className="desktop-settings-line desktop-settings-toggle-line desktop-files-toggle-line">
              <span>Show hidden files</span>
              <label className="desktop-settings-switch">
                <input
                  type="checkbox"
                  checked={settings.showHiddenFiles}
                  onChange={(event) => onChange({
                    ...settings,
                    showHiddenFiles: event.target.checked,
                  })}
                />
                <span aria-hidden="true" />
              </label>
            </div>
            <div className="desktop-settings-pattern-editor desktop-files-pattern-editor">
              <div className="desktop-files-pattern-editor-toolbar">
                <span>Exclude patterns</span>
                <small>{normalizedDraft.length} pattern{normalizedDraft.length === 1 ? "" : "s"}</small>
              </div>
              <textarea
                value={patternDraft}
                spellCheck={false}
                onChange={(event) => setPatternDraft(event.target.value)}
              />
              <div className="desktop-settings-pattern-editor-footer">
                <button
                  className="desktop-settings-row-action"
                  type="button"
                  disabled={!patternsDirty}
                  onClick={applyPatterns}
                >
                  <Check size={13} />
                  <span>Apply</span>
                </button>
                <button
                  className="desktop-settings-row-action"
                  type="button"
                  onClick={resetPatterns}
                >
                  <RefreshCw size={13} />
                  <span>Reset</span>
                </button>
              </div>
            </div>
          </SettingsGroup>
        </div>
      </div>
    </section>
  );
}

function readRightSidebarDragToolId(value: string): RightSidebarToolId | null {
  return RIGHT_SIDEBAR_TOOL_DEFINITIONS.some((tool) => tool.id === value)
    ? value as RightSidebarToolId
    : null;
}

function moveRightSidebarTool(
  order: RightSidebarToolId[],
  sourceToolId: RightSidebarToolId,
  targetToolId: RightSidebarToolId,
): RightSidebarToolId[] {
  if (sourceToolId === targetToolId) return order;

  const nextOrder = order.filter((toolId) => toolId !== sourceToolId);
  const targetIndex = nextOrder.indexOf(targetToolId);
  if (targetIndex < 0) return order;

  nextOrder.splice(targetIndex, 0, sourceToolId);
  return nextOrder;
}

function GitSettingsView({
  status,
  loading,
  error,
  copiedRemoteKey,
  copyError,
  puppyoneConfig,
  puppyoneConfigLoading,
  puppyoneConfigSaving,
  puppyoneConfigError,
  onCopyRemoteUrl,
  onPuppyoneConfigChange,
  onRefresh,
}: {
  status: GitStatusSnapshot | null;
  loading: boolean;
  error: string | null;
  copiedRemoteKey: string | null;
  copyError: string | null;
  puppyoneConfig: PuppyoneWorkspaceConfig | null;
  puppyoneConfigLoading: boolean;
  puppyoneConfigSaving: boolean;
  puppyoneConfigError: string | null;
  onCopyRemoteUrl: (key: string, url: string) => Promise<void>;
  onPuppyoneConfigChange: (config: PuppyoneWorkspaceConfig) => Promise<PuppyoneWorkspaceConfig | null>;
  onRefresh: () => void;
}) {
  const currentBranch = status?.branches.find((branch) => branch.current) ?? null;
  const remotes = status?.remotes ?? [];
  const localBranchCount = status?.branches.filter((branch) => !branch.remote).length ?? 0;
  const remoteBranchCount = status?.branches.filter((branch) => branch.remote).length ?? 0;
  const puppyoneRemote = remotes
    .map((remote) => ({ remote, info: parsePuppyoneRemote(remote.fetchUrl ?? remote.pushUrl) }))
    .find((entry) => entry.info);
  const cloudRemote = puppyoneRemote?.remote ?? null;
  const cloudInfo = puppyoneRemote?.info ?? null;
  const cloudRemoteUrl = cloudRemote ? cloudRemote.fetchUrl ?? cloudRemote.pushUrl : null;
  const cloudCopyKey = cloudRemoteUrl ? `${cloudRemote?.name}:${cloudRemoteUrl}` : "";

  return (
    <section className="desktop-utility-view desktop-settings-view">
      <div className="desktop-utility-body desktop-settings-body">
        <div className="desktop-settings-section">
          <div className="desktop-settings-heading-row">
            <SettingsSectionHeader title="Git" />
            <button className="desktop-settings-action" type="button" onClick={onRefresh} disabled={loading}>
              <RefreshCw size={14} className={loading ? "spin" : undefined} />
              <span>Refresh</span>
            </button>
          </div>

          {error ? (
            <div className="desktop-utility-empty danger">{error}</div>
          ) : loading && !status ? (
            <div className="desktop-utility-empty">Reading Git...</div>
          ) : status && !status.isRepo ? (
            <div className="desktop-utility-empty">Not a Git repository.</div>
          ) : (
            <>
              <SettingsGroup title="Repository">
                <SettingsLine label="Branch" value={status?.branch ?? "Detached"} />
                <SettingsLine label="Branches" value={`${localBranchCount} local, ${remoteBranchCount} remote`} />
                <SettingsLine label="Upstream" value={currentBranch?.upstream ?? "Not configured"} />
                <SettingsLine
                  label="Sync status"
                  value={currentBranch?.upstream ? `${currentBranch.ahead} ahead, ${currentBranch.behind} behind` : "Local only"}
                />
                <SettingsLine label="HEAD" value={status?.headCommitId ? shortCommit(status.headCommitId) : "No commits"} monospace />
              </SettingsGroup>

              <PuppyoneWorkspaceConfigSettings
                config={puppyoneConfig}
                remotes={remotes}
                branches={status?.branches ?? []}
                currentBranchName={status?.branch ?? null}
                loading={puppyoneConfigLoading}
                saving={puppyoneConfigSaving}
                error={puppyoneConfigError}
                onChange={onPuppyoneConfigChange}
              />

              <SettingsGroup title="puppyone remote">
                <SettingsLine
                  label="Status"
                  value={cloudInfo ? "Connected" : "Not configured"}
                  tone={cloudInfo ? "success" : undefined}
                />
                {cloudInfo ? (
                  <>
                    <SettingsLine label="Remote" value={cloudRemote?.name ?? "puppyone"} />
                    <SettingsLine label="Host" value={cloudInfo.host} />
                    <SettingsLine
                      label={cloudInfo.kind === "access-point" ? "Access key" : "Project"}
                      value={cloudInfo.displayId}
                      monospace
                    />
                    <SettingsLine
                      label="Git URL"
                      value={cloudRemoteUrl ? maskRemoteUrl(cloudRemoteUrl) : "Not configured"}
                      title={cloudRemoteUrl ?? undefined}
                      monospace
                      action={cloudRemoteUrl ? (
                        <button
                          className="desktop-settings-row-action"
                          type="button"
                          onClick={() => void onCopyRemoteUrl(cloudCopyKey, cloudRemoteUrl)}
                        >
                          <Copy size={13} />
                          <span>{copiedRemoteKey === cloudCopyKey ? "Copied" : "Copy"}</span>
                        </button>
                      ) : undefined}
                    />
                  </>
                ) : (
                  <div className="desktop-settings-muted-row">Not configured</div>
                )}
              </SettingsGroup>

              <SettingsGroup title="Remotes">
                {remotes.length === 0 ? (
                  <div className="desktop-settings-muted-row">No remotes</div>
                ) : (
                  remotes.map((remote) => {
                    const copyUrl = remote.fetchUrl ?? remote.pushUrl;
                    const copyKey = `${remote.name}:${copyUrl ?? ""}`;
                    const remoteInfo = parsePuppyoneRemote(copyUrl);
                    const provider = remoteInfo ? "puppyone" : remoteKindLabel(copyUrl);
                    const pushUrlDiffers = Boolean(remote.fetchUrl && remote.pushUrl && remote.fetchUrl !== remote.pushUrl);
                    return (
                      <div className="desktop-settings-remote-setting" key={remote.name}>
                        <div className="desktop-settings-remote-setting-main">
                          <strong>{remote.name}</strong>
                          <span className={`desktop-settings-badge ${remoteInfo ? "connected" : ""}`}>
                            {provider}
                          </span>
                        </div>
                        <div className="desktop-settings-remote-setting-meta">
                          <strong>{remote.branches.length}</strong>
                          <span>{remote.branches.length === 1 ? "branch" : "branches"}</span>
                        </div>
                        <div className="desktop-settings-remote-setting-url">
                          <code title={copyUrl ?? ""}>{copyUrl ? maskRemoteUrl(copyUrl) : "Not configured"}</code>
                          {pushUrlDiffers && remote.pushUrl && (
                            <small title={remote.pushUrl}>Push URL differs</small>
                          )}
                        </div>
                        <button
                          className="desktop-settings-row-action"
                          type="button"
                          disabled={!copyUrl}
                          onClick={() => copyUrl ? void onCopyRemoteUrl(copyKey, copyUrl) : undefined}
                        >
                          <Copy size={13} />
                          <span>{copiedRemoteKey === copyKey ? "Copied" : "Copy"}</span>
                        </button>
                      </div>
                    );
                  })
                )}
              </SettingsGroup>
              {copyError && <div className="desktop-utility-empty danger">{copyError}</div>}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

export function SettingsSidebar({ activeSection, onSelectSection }: SettingsSidebarProps) {
  const settingsSections = [
    { id: "workspace", label: "General", icon: Settings, disabled: false },
    { id: "appearance", label: "Appearance", icon: Monitor, disabled: false },
    { id: "git", label: "Git", icon: GitBranch, disabled: false },
    { id: "files", label: "Git Ignore", icon: FileText, disabled: false },
    { id: "editor", label: "Editor", icon: Pencil, disabled: false },
  ] satisfies Array<{
    id: SettingsSection;
    label: string;
    icon: typeof Settings;
    disabled: boolean;
  }>;

  return (
    <section className="desktop-tool-sidebar desktop-settings-sidebar">
      <div className="desktop-tool-sidebar-list">
        {settingsSections.map((section) => {
          const Icon = section.icon;
          return (
            <button
              className={`desktop-tool-sidebar-row ${section.id === activeSection ? "active" : ""}`}
              type="button"
              disabled={section.disabled}
              aria-disabled={section.disabled}
              title={section.disabled ? `${section.label} is not available yet` : section.label}
              key={section.id}
              onClick={() => onSelectSection(section.id)}
            >
              <Icon size={15} />
              <span>{section.label}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
