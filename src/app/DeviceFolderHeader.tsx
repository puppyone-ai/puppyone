import { Tooltip, type Workspace, type WorkspaceFolder } from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization";
import { useRef, useState } from "react";
import { SquareTerminal } from "lucide-react";
import { AgentEntryIcon } from "../components/brand/AgentEntryIcon";
import { DesktopTitlebarContext } from "../features/app-shell/DesktopTitlebarContext";
import type { ProjectPlaceMenuProps } from "../features/app-shell/project-place/ProjectPlaceMenu";
import { VersionControlIcon } from "../features/source-control";
import type { ProjectHomeItem } from "../lib/workspaceHomeModel";

const noop = () => {};
const placeHandlers: ProjectPlaceMenuProps["handlers"] = { onOpenLocalFolder: noop };

/** Same project navigation and named-place control as local and Cloud projects. */
export function DeviceFolderHeader({ workspace, folder, hostName, writable, projectItems,
  onHome, onSelectProject, onSelectCloudProject, onCreateProject }: {
  workspace: Workspace; folder: WorkspaceFolder; hostName: string; writable: boolean;
  projectItems?: readonly ProjectHomeItem[]; onHome: () => void;
  onSelectProject?: (path: string) => void; onSelectCloudProject?: (id: string) => void; onCreateProject?: () => void;
}) {
  const { t } = useLocalization();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  return <DesktopTitlebarContext titlebarLabel={workspace.name} workspace={workspace} workspaceFolders={[folder]}
    multiRootWorkspacesEnabled={false} projectItems={projectItems} open={open} refObject={anchor}
    onClose={() => setOpen(false)} onToggle={() => setOpen(current => !current)} onHome={onHome}
    onSelectProject={onSelectProject} onSelectCloudProject={onSelectCloudProject} onCreateProject={onCreateProject}
    placeMenu={{ menu: { place: "computer", label: hostName, address: { short: hostName, full: hostName },
      detail: t(writable ? "hosts.catalog.editable" : "hosts.catalog.readOnly"), action: null }, handlers: placeHandlers }} />;
}

export type DeviceFolderTool = "terminal" | "agent" | "git";
const toolIcons = { terminal: SquareTerminal, agent: AgentEntryIcon, git: VersionControlIcon };

/** Commands follow the shared Header geometry and the remote folder's own capabilities. */
export function DeviceFolderHeaderActions({ tools, activeTool, onToggle }: {
  tools: readonly DeviceFolderTool[]; activeTool: DeviceFolderTool | null; onToggle: (tool: DeviceFolderTool) => void;
}) {
  const { t } = useLocalization();
  return <>{tools.map(tool => {
    const Icon = toolIcons[tool];
    const label = t(`hosts.tools.${tool}`);
    return <Tooltip key={tool} content={label}><button type="button" className="desktop-titlebar-action"
      data-window-no-drag="true" aria-label={label} aria-pressed={activeTool === tool} onClick={() => onToggle(tool)}>
      <Icon size={15} strokeWidth={1.8} aria-hidden="true" />
    </button></Tooltip>;
  })}</>;
}
