import {
  ChevronDown,
  Folder,
  GitBranch,
  Link2,
  Monitor,
  Plus,
  Settings,
} from "lucide-react";
import { useState } from "react";
import type { Workspace } from "@puppyone/data-core";
import { selectWorkspaceFolder } from "../lib/localFiles";

export type DesktopView = "data" | "changes" | "access" | "monitor" | "settings";

type DesktopCloudShellProps = {
  workspaces: Workspace[];
  activeWorkspace: Workspace;
  activeView: DesktopView;
  onSelectWorkspace: (workspaceId: string) => void;
  onOpenWorkspace: (workspace: Workspace) => void;
  onNavigate: (view: DesktopView) => void;
  children: React.ReactNode;
};

const navItems = [
  { id: "data", label: "Context", icon: Folder },
  { id: "changes", label: "Changes", icon: GitBranch },
  { id: "access", label: "Access", icon: Link2, groupEnd: true },
  { id: "monitor", label: "Monitor", icon: Monitor },
  { id: "settings", label: "Settings", icon: Settings },
] as const;

export function DesktopCloudShell({
  workspaces,
  activeWorkspace,
  activeView,
  onSelectWorkspace,
  onOpenWorkspace,
  onNavigate,
  children,
}: DesktopCloudShellProps) {
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const initial = (activeWorkspace.name[0] || "P").toUpperCase();

  const openFolder = async () => {
    const workspace = await selectWorkspaceFolder();
    if (workspace) onOpenWorkspace(workspace);
    setSwitcherOpen(false);
  };

  return (
    <div className="desktop-cloud-frame dark">
      <aside className="desktop-cloud-rail">
        <div className="desktop-rail-header">
          <button
            className="desktop-identity-button"
            type="button"
            title="Switch project"
            aria-label="Switch project"
            onClick={() => setSwitcherOpen((open) => !open)}
          >
            <span>{initial}</span>
          </button>

          {switcherOpen && (
            <div className="desktop-project-menu">
              <div className="desktop-project-menu-title">Projects</div>
              {workspaces.map((workspace) => (
                <button
                  key={workspace.id}
                  className={`desktop-project-option ${workspace.id === activeWorkspace.id ? "active" : ""}`}
                  type="button"
                  onClick={() => {
                    onSelectWorkspace(workspace.id);
                    setSwitcherOpen(false);
                  }}
                >
                  <span className="desktop-project-mark">{workspace.name[0]?.toUpperCase() ?? "P"}</span>
                  <span>
                    <strong>{workspace.name}</strong>
                    <small>{workspace.path}</small>
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

        <nav className="desktop-rail-nav">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeView === item.id;
            return (
              <div
                key={item.id}
                className={"groupEnd" in item && item.groupEnd ? "desktop-rail-group-end" : undefined}
              >
                <button
                  className={`desktop-rail-button ${active ? "active" : ""}`}
                  type="button"
                  title={item.label}
                  aria-label={item.label}
                  onClick={() => onNavigate(item.id)}
                >
                  <Icon size={18} strokeWidth={2} />
                </button>
              </div>
            );
          })}
        </nav>

        <div className="desktop-rail-footer">
          <button className="desktop-rail-avatar" type="button" title={activeWorkspace.name}>
            <ChevronDown size={13} />
          </button>
        </div>
      </aside>

      <main className="desktop-cloud-surface">
        {children}
      </main>
    </div>
  );
}
