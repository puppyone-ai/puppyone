import { GitBranch, Monitor, Moon, RefreshCw, Settings, ShieldCheck, SlidersHorizontal, Sun } from "lucide-react";
import type { Workspace } from "@puppyone/data-core";
import type { GitStatusSnapshot } from "../types/electron";
import type { ThemeMode } from "../App";

type GitStatusViewProps = {
  workspace: Workspace;
  status: GitStatusSnapshot | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
};

type SettingsViewProps = {
  workspace: Workspace;
  themeMode: ThemeMode;
  onThemeModeChange: (mode: ThemeMode) => void;
};

type GitSidebarProps = Omit<GitStatusViewProps, "workspace">;

export function GitStatusView({
  workspace,
  status,
  loading,
  error,
  onRefresh,
}: GitStatusViewProps) {
  const entries = status?.entries ?? [];

  return (
    <section className="desktop-utility-view">
      <header className="desktop-utility-header">
        <div className="desktop-utility-title">
          <GitBranch size={18} />
          <div>
            <span>Git</span>
            <strong>{status?.branch ?? workspace.name}</strong>
          </div>
        </div>
        <button className="desktop-utility-icon-button" type="button" onClick={onRefresh} aria-label="Refresh Git status">
          <RefreshCw size={15} className={loading ? "spin" : undefined} />
        </button>
      </header>

      <div className="desktop-utility-body">
        {error ? (
          <div className="desktop-utility-empty danger">{error}</div>
        ) : status && !status.isRepo ? (
          <div className="desktop-utility-empty">No Git repository in this workspace.</div>
        ) : loading && !status ? (
          <div className="desktop-utility-empty">Reading Git status...</div>
        ) : entries.length === 0 ? (
          <div className="desktop-utility-empty">Working tree clean.</div>
        ) : (
          <div className="desktop-git-list">
            {entries.map((entry) => (
              <div className="desktop-git-row" key={`${entry.status}:${entry.path}`}>
                <span className={`desktop-git-status ${entry.status}`}>{shortGitStatus(entry.status)}</span>
                <span className="desktop-git-path">{entry.path}</span>
                <span className="desktop-git-code">
                  {(entry.staged ?? " ")}{(entry.unstaged ?? " ")}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export function GitSidebar({ status, loading, error, onRefresh }: GitSidebarProps) {
  const entries = status?.entries ?? [];

  return (
    <section className="desktop-tool-sidebar">
      <header className="desktop-tool-sidebar-header">
        <div>
          <span>Source Control</span>
          <strong>{status?.branch ?? "Git"}</strong>
        </div>
        <button className="desktop-tool-sidebar-icon" type="button" onClick={onRefresh} aria-label="Refresh Git status">
          <RefreshCw size={14} className={loading ? "spin" : undefined} />
        </button>
      </header>

      <div className="desktop-tool-sidebar-list">
        {error ? (
          <div className="desktop-tool-sidebar-empty danger">{error}</div>
        ) : status && !status.isRepo ? (
          <div className="desktop-tool-sidebar-empty">No repository</div>
        ) : loading && !status ? (
          <div className="desktop-tool-sidebar-empty">Reading status...</div>
        ) : entries.length === 0 ? (
          <div className="desktop-tool-sidebar-empty">No changes</div>
        ) : (
          entries.map((entry) => (
            <button className="desktop-tool-sidebar-row" type="button" key={`${entry.status}:${entry.path}`}>
              <span className={`desktop-git-status ${entry.status}`}>{shortGitStatus(entry.status)}</span>
              <span>{entry.path}</span>
            </button>
          ))
        )}
      </div>
    </section>
  );
}

export function SettingsView({ workspace, themeMode, onThemeModeChange }: SettingsViewProps) {
  return (
    <section className="desktop-utility-view">
      <header className="desktop-utility-header">
        <div className="desktop-utility-title">
          <Settings size={18} />
          <div>
            <span>Settings</span>
            <strong>{workspace.name}</strong>
          </div>
        </div>
      </header>

      <div className="desktop-utility-body">
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
          <div className="desktop-settings-row">
            <span>Status</span>
            <strong className="desktop-settings-status">
              <ShieldCheck size={14} />
              Protected
            </strong>
          </div>
        </div>
      </div>
    </section>
  );
}

export function SettingsSidebar() {
  return (
    <section className="desktop-tool-sidebar">
      <header className="desktop-tool-sidebar-header">
        <div>
          <span>Settings</span>
          <strong>Local workspace</strong>
        </div>
      </header>
      <div className="desktop-tool-sidebar-list">
        <button className="desktop-tool-sidebar-row active" type="button">
          <Settings size={15} />
          <span>Workspace</span>
        </button>
        <button className="desktop-tool-sidebar-row" type="button">
          <GitBranch size={15} />
          <span>Git</span>
        </button>
        <button className="desktop-tool-sidebar-row" type="button">
          <ShieldCheck size={15} />
          <span>Protection</span>
        </button>
        <button className="desktop-tool-sidebar-row" type="button">
          <SlidersHorizontal size={15} />
          <span>Advanced</span>
        </button>
      </div>
    </section>
  );
}

function shortGitStatus(status: string) {
  if (status === "untracked") return "U";
  if (status === "added") return "A";
  if (status === "deleted") return "D";
  if (status === "renamed") return "R";
  if (status === "modified") return "M";
  return "C";
}
