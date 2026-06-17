import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DataWorkspace } from "@puppyone/data-ui";
import { DesktopCloudShell, type DesktopView } from "./components/DesktopCloudShell";
import { GitSidebar, GitStatusView, SettingsSidebar, SettingsView } from "./components/DesktopUtilityViews";
import { MinimalOnboarding } from "./components/MinimalOnboarding";
import type { Workspace } from "@puppyone/data-core";
import { createLocalDataPort, getWorkspaceGitStatus, selectWorkspaceFolder } from "./lib/localFiles";
import type { GitStatusSnapshot } from "./types/electron";
import { ChevronDown, Folder, GitBranch, Plus, Settings } from "lucide-react";

export type ThemeMode = "system" | "light" | "dark";

const THEME_STORAGE_KEY = "puppyone.desktop.theme";

export function App() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<DesktopView>("data");
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [gitStatus, setGitStatus] = useState<GitStatusSnapshot | null>(null);
  const [gitStatusLoading, setGitStatusLoading] = useState(false);
  const [gitStatusError, setGitStatusError] = useState<string | null>(null);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => readInitialThemeMode());
  const [systemDark, setSystemDark] = useState(() => readSystemDarkMode());
  const switcherRef = useRef<HTMLDivElement>(null);

  const workspace = useMemo(
    () => workspaces.find((item) => item.id === activeWorkspaceId) ?? workspaces[0] ?? null,
    [activeWorkspaceId, workspaces],
  );
  const workspaceKey = useMemo(() => workspace?.path ?? "no-workspace", [workspace?.path]);
  const dataPort = useMemo(
    () => (workspace ? createLocalDataPort(workspace.path) : null),
    [workspace],
  );
  const resolvedTheme = themeMode === "system" ? (systemDark ? "dark" : "light") : themeMode;

  useEffect(() => {
    window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
  }, [themeMode]);

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => setSystemDark(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    const preventFileDropNavigation = (event: DragEvent) => {
      event.preventDefault();
    };

    window.addEventListener("dragover", preventFileDropNavigation);
    window.addEventListener("drop", preventFileDropNavigation);
    return () => {
      window.removeEventListener("dragover", preventFileDropNavigation);
      window.removeEventListener("drop", preventFileDropNavigation);
    };
  }, []);

  useEffect(() => {
    if (!switcherOpen) return undefined;

    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && switcherRef.current?.contains(target)) return;
      setSwitcherOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSwitcherOpen(false);
    };

    window.addEventListener("pointerdown", closeOnPointerDown, true);
    window.addEventListener("keydown", closeOnEscape, true);
    return () => {
      window.removeEventListener("pointerdown", closeOnPointerDown, true);
      window.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [switcherOpen]);

  useEffect(() => {
    setGitStatus(null);
    setGitStatusError(null);
  }, [workspace?.path]);

  const openWorkspace = (nextWorkspace: Workspace) => {
    setWorkspaces((current) => {
      const withoutExisting = current.filter((item) => item.id !== nextWorkspace.id);
      return [nextWorkspace, ...withoutExisting];
    });
    setActiveWorkspaceId(nextWorkspace.id);
    setActiveView("data");
    setSwitcherOpen(false);
  };

  const openFolder = async () => {
    const nextWorkspace = await selectWorkspaceFolder();
    if (nextWorkspace) openWorkspace(nextWorkspace);
    setSwitcherOpen(false);
  };

  const refreshGitStatus = useCallback(async () => {
    if (!workspace) return;
    setGitStatusLoading(true);
    setGitStatusError(null);
    try {
      setGitStatus(await getWorkspaceGitStatus(workspace.path));
    } catch (error) {
      setGitStatusError(error instanceof Error ? error.message : String(error));
    } finally {
      setGitStatusLoading(false);
    }
  }, [workspace]);

  useEffect(() => {
    if (activeView === "git") void refreshGitStatus();
  }, [activeView, refreshGitStatus]);

  if (!workspace) {
    return <MinimalOnboarding onOpenWorkspace={openWorkspace} />;
  }

  return (
    <div className={`app-shell cloud-runtime ${resolvedTheme === "dark" ? "dark" : ""}`} data-theme-mode={themeMode}>
      <DesktopCloudShell>
        {dataPort ? (
          <DataWorkspace
            key={workspaceKey}
            workspace={workspace}
            dataPort={dataPort}
            showHeader={false}
            showExplorerToolbar={false}
            showPreviewHeader={false}
            explorerSlot={activeView === "data" ? undefined : (
              activeView === "git" ? (
                <GitSidebar
                  status={gitStatus}
                  loading={gitStatusLoading}
                  error={gitStatusError}
                  onRefresh={refreshGitStatus}
                />
              ) : (
                <SettingsSidebar />
              )
            )}
            explorerFooterSlot={
              <div className="desktop-sidebar-footer-bar">
                <div className="desktop-footer-switcher-wrap" ref={switcherRef}>
                  <button
                    className="desktop-footer-workspace-button"
                    type="button"
                    title={workspace.name}
                    aria-label="Switch workspace"
                    onClick={() => setSwitcherOpen((open) => !open)}
                  >
                    <span>{workspace.name}</span>
                    <ChevronDown size={13} />
                  </button>

                  {switcherOpen && (
                    <div className="desktop-project-menu desktop-footer-menu">
                      <div className="desktop-project-menu-title">Workspaces</div>
                      {workspaces.map((item) => (
                        <button
                          key={item.id}
                          className={`desktop-project-option ${item.id === workspace.id ? "active" : ""}`}
                          type="button"
                          onClick={() => {
                            setActiveWorkspaceId(item.id);
                            setActiveView("data");
                            setSwitcherOpen(false);
                          }}
                        >
                          <span className="desktop-project-mark">{item.name[0]?.toUpperCase() ?? "P"}</span>
                          <span>
                            <strong>{item.name}</strong>
                            <small>{item.path}</small>
                          </span>
                        </button>
                      ))}
                      <button className="desktop-project-add" type="button" onClick={openFolder}>
                        <Plus size={14} />
                        <span>Open local folder</span>
                      </button>
                    </div>
                  )}
                </div>
                <div className="desktop-sidebar-footer-actions">
                  <button
                    className={`desktop-sidebar-footer-button ${activeView === "data" ? "active" : ""}`}
                    type="button"
                    title="Context"
                    aria-label="Context"
                    onClick={() => {
                      setActiveView("data");
                      setSwitcherOpen(false);
                    }}
                  >
                    <Folder size={17} />
                  </button>
                  <button
                    className={`desktop-sidebar-footer-button ${activeView === "git" ? "active" : ""}`}
                    type="button"
                    title="Git"
                    aria-label="Git"
                    onClick={() => {
                      setActiveView("git");
                      setSwitcherOpen(false);
                    }}
                  >
                    <GitBranch size={17} />
                  </button>
                  <button
                    className={`desktop-sidebar-footer-button ${activeView === "settings" ? "active" : ""}`}
                    type="button"
                    title="Settings"
                    aria-label="Settings"
                    onClick={() => {
                      setActiveView("settings");
                      setSwitcherOpen(false);
                    }}
                  >
                    <Settings size={17} />
                  </button>
                </div>
              </div>
            }
            mainSlot={activeView === "data" ? undefined : (
              activeView === "git" ? (
                <GitStatusView
                  workspace={workspace}
                  status={gitStatus}
                  loading={gitStatusLoading}
                  error={gitStatusError}
                  onRefresh={refreshGitStatus}
                />
              ) : (
                <SettingsView
                  workspace={workspace}
                  themeMode={themeMode}
                  onThemeModeChange={setThemeMode}
                />
              )
            )}
            capabilities={{
              create: true,
              rename: true,
              delete: true,
              move: true,
              write: true,
              history: true,
              accessPoints: false,
              cloudSync: false,
              localGit: true,
              connectors: false,
            }}
          />
        ) : (
          activeView === "settings" ? (
            <SettingsView
              workspace={workspace}
              themeMode={themeMode}
              onThemeModeChange={setThemeMode}
            />
          ) : (
            <GitStatusView
              workspace={workspace}
              status={gitStatus}
              loading={gitStatusLoading}
              error={gitStatusError}
              onRefresh={refreshGitStatus}
            />
          )
        )}
      </DesktopCloudShell>
    </div>
  );
}

function readInitialThemeMode(): ThemeMode {
  if (typeof window === "undefined") return "system";
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === "light" || stored === "dark" || stored === "system") return stored;
  return "system";
}

function readSystemDarkMode(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}
