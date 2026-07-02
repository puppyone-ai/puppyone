import type { RefObject } from "react";
import type { Workspace } from "@puppyone/shared-ui";
import { ChevronDown, Plus } from "lucide-react";

type DesktopWorkspaceSwitcherProps = {
  open: boolean;
  refObject: RefObject<HTMLDivElement>;
  titlebarLabel: string;
  workspace: Workspace;
  workspaces: Workspace[];
  onOpenFolder: () => void;
  onOpenWorkspace: (workspace: Workspace) => void;
  onToggle: () => void;
};

export function DesktopWorkspaceSwitcher({
  open,
  refObject,
  titlebarLabel,
  workspace,
  workspaces,
  onOpenFolder,
  onOpenWorkspace,
  onToggle,
}: DesktopWorkspaceSwitcherProps) {
  return (
    <div className="desktop-titlebar-workspace-wrap" ref={refObject}>
      <button
        className="desktop-titlebar-workspace-button"
        type="button"
        aria-label={`Switch workspace: ${workspace.name}`}
        aria-expanded={open}
        title={workspace.name}
        onClick={onToggle}
      >
        <span className="desktop-titlebar-workspace-mark">{workspace.name[0]?.toUpperCase() ?? "P"}</span>
        <span className="desktop-titlebar-workspace-name">{titlebarLabel}</span>
        <ChevronDown size={12} />
      </button>

      {open && (
        <div className="desktop-project-menu desktop-titlebar-menu">
          {workspaces.map((item) => (
            <button
              key={item.id}
              className={`desktop-project-option ${item.id === workspace.id ? "active" : ""}`}
              type="button"
              title={`${item.name} - ${item.path}`}
              onClick={() => onOpenWorkspace(item)}
            >
              <span className="desktop-project-mark">{item.name[0]?.toUpperCase() ?? "P"}</span>
              <span className="desktop-project-option-text">
                <strong>{item.name}</strong>
                <small>{item.path}</small>
              </span>
            </button>
          ))}
          <button className="desktop-project-add" type="button" onClick={onOpenFolder}>
            <Plus size={14} />
            <span>Open local folder</span>
          </button>
        </div>
      )}
    </div>
  );
}
