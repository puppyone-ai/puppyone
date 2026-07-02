import {
  ChevronDown,
  Folder,
  GitBranch,
  Link2,
  Monitor,
  PanelLeft,
  Settings,
  ShieldCheck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useState } from "react";
import type { Workspace } from "../lib/mockData";

export type DesktopView = "data" | "changes" | "access" | "monitor" | "settings";

type CloudSidebarProps = {
  workspaces: Workspace[];
  activeWorkspace: Workspace;
  activeView: DesktopView;
  onSelectWorkspace: (workspaceId: string) => void;
  onNavigate: (view: DesktopView) => void;
};

const navItems: Array<{
  id: DesktopView;
  label: string;
  icon: LucideIcon;
  groupEnd?: boolean;
}> = [
  { id: "data", label: "Data", icon: Folder },
  { id: "changes", label: "Changes", icon: GitBranch, groupEnd: true },
  { id: "access", label: "Access", icon: Link2 },
  { id: "monitor", label: "Monitor", icon: Monitor },
  { id: "settings", label: "Settings", icon: Settings },
];

export function CloudSidebar({
  workspaces,
  activeWorkspace,
  activeView,
  onSelectWorkspace,
  onNavigate,
}: CloudSidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const initial = (activeWorkspace.name[0] || "P").toUpperCase();

  return (
    <aside
      className={`cloud-sidebar ${collapsed ? "is-collapsed" : ""}`}
      style={{ width: collapsed ? 47 : 200 }}
    >
      <div className="cloud-sidebar-header">
        {collapsed ? (
          <button
            className="sidebar-identity-chip collapsed"
            type="button"
            title="Expand sidebar"
            aria-label="Expand sidebar"
            onClick={() => setCollapsed(false)}
          >
            <span>{initial}</span>
            <PanelLeft className="collapsed-hover-icon" size={15} />
          </button>
        ) : (
          <>
            <div className="workspace-switcher">
              <button
                className="workspace-switcher-trigger"
                type="button"
                onClick={() => setSwitcherOpen((open) => !open)}
              >
                <span className="sidebar-identity-chip">{initial}</span>
                <span className="workspace-switcher-copy">
                  <span>{activeWorkspace.name}</span>
                  <span>{activeWorkspace.path}</span>
                </span>
                <ChevronDown size={14} />
              </button>

              {switcherOpen && (
                <div className="workspace-switcher-menu">
                  {workspaces.map((workspace) => (
                    <button
                      key={workspace.id}
                      className={`workspace-option ${workspace.id === activeWorkspace.id ? "active" : ""}`}
                      type="button"
                      onClick={() => {
                        onSelectWorkspace(workspace.id);
                        setSwitcherOpen(false);
                      }}
                    >
                      <span className="workspace-option-mark">
                        {workspace.name[0]?.toUpperCase() ?? "P"}
                      </span>
                      <span>
                        <strong>{workspace.name}</strong>
                        <small>{workspace.path}</small>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              className="sidebar-collapse-button"
              type="button"
              title="Collapse sidebar"
              aria-label="Collapse sidebar"
              onClick={() => setCollapsed(true)}
            >
              <PanelLeft size={14} />
            </button>
          </>
        )}
      </div>

      <nav className="cloud-nav">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = activeView === item.id;
          return (
            <div key={item.id} className={item.groupEnd ? "nav-group-end" : undefined}>
              <button
                className={`cloud-nav-row ${active ? "active" : ""}`}
                type="button"
                title={collapsed ? item.label : undefined}
                onClick={() => onNavigate(item.id)}
              >
                <span className="cloud-nav-icon">
                  <Icon size={15} strokeWidth={2} />
                </span>
                {!collapsed && <span className="cloud-nav-label">{item.label}</span>}
              </button>
            </div>
          );
        })}
      </nav>

      <div className="cloud-sidebar-footer">
        {!collapsed && (
          <span className="sidebar-stat">
            {activeWorkspace.commitCount ?? 0} commit{activeWorkspace.commitCount === 1 ? "" : "s"}
          </span>
        )}
        <span className="user-avatar">
          <ShieldCheck size={13} />
        </span>
      </div>
    </aside>
  );
}
