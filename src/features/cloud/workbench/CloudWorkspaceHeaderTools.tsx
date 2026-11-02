import { lazy, Suspense, useRef, useState, type ReactNode } from "react";
import { Forward } from "lucide-react";
import { Tooltip } from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization/react";
import { AgentEntryIcon } from "../../../components/brand/AgentEntryIcon";
import type { DesktopCloudSession } from "../../../lib/cloudApi";
import type { ProjectCloudContext } from "../project/context";
import type { CloudWorkspaceShareResource } from "../share/cloudWorkspaceShareResource";
import type { ShareAgentMark } from "../share/CloudWorkspaceAgentsPanel";
import { useWorkspaceAgents, type WorkspaceAgent } from "../share/useWorkspaceAgents";

const ShareDialog = lazy(() => import("../share/CloudWorkspaceShareDialog").then(module => ({ default: module.CloudWorkspaceShareDialog })));
const AgentsPanel = lazy(() => import("../share/CloudWorkspaceAgentsPanel").then(module => ({ default: module.CloudWorkspaceAgentsPanel })));
const AgentsDialog = lazy(() => import("../share/CloudWorkspaceAgentsDialog").then(module => ({ default: module.CloudWorkspaceAgentsDialog })));

export type CloudWorkspacePeople = Readonly<{
  agents: readonly WorkspaceAgent[];
  open: boolean;
  /** The mark that opened the list, so the Header shows which one is pressed. */
  pressedAgentId: string | null;
  onOpen: (agentId: string | null) => void;
}>;

type Props = {
  context: ProjectCloudContext | null;
  getShareResource?: () => CloudWorkspaceShareResource | null;
  session: DesktopCloudSession | null;
  apiBaseUrl: string;
  onSessionChange: (session: DesktopCloudSession | null) => void;
  agentOpen?: boolean;
  onToggleAgent?: () => void;
  /** The Header's marks belong to the shell; this feature only supplies who is there. */
  renderPeople?: (people: CloudWorkspacePeople) => ReactNode;
  renderAgentMark?: (agent: ShareAgentMark) => ReactNode;
};

/** An Agent connects to the whole workspace, so a scoped view has none to show. */
function agentTarget(context: ProjectCloudContext | null, session: DesktopCloudSession | null, apiBaseUrl: string) {
  if (context?.status !== "resolved" || !session || context.target.kind !== "project_root") return null;
  return { session, projectId: context.projectId, apiBaseUrl };
}

/** Both hosted entry paths use the active Cloud identity, never a retained local remote. */
export function CloudWorkspaceHeaderTools(props: Props) {
  const scope = JSON.stringify([props.apiBaseUrl, props.session?.user_id,
    props.session?.session_generation, props.context?.status === "resolved" ? props.context.target : null]);
  return <ScopedCloudWorkspaceHeaderTools key={scope} {...props} />;
}

function ScopedCloudWorkspaceHeaderTools({ context, session, apiBaseUrl, getShareResource, agentOpen = false, onToggleAgent, renderPeople, renderAgentMark }: Props) {
  const { t } = useLocalization();
  const [panel, setPanel] = useState<"share" | "agents" | "manage" | null>(null);
  const [pressedAgentId, setPressedAgentId] = useState<string | null>(null);
  const shareButton = useRef<HTMLButtonElement>(null);
  const agentsAnchor = useRef<HTMLDivElement>(null);
  const [shareResource, setShareResource] = useState<CloudWorkspaceShareResource | null | undefined>();
  const ready = context?.status === "resolved" && session !== null;
  const { agents, manageable, refresh: refreshAgents } = useWorkspaceAgents(agentTarget(context, session, apiBaseUrl));
  const closePanel = () => setPanel(null);
  const toggleShare = () => {
    if (panel === "share") { closePanel(); return; }
    try { setShareResource(getShareResource?.()); }
    catch { setShareResource(null); }
    setPanel("share");
  };
  const openAgents = (agentId: string | null) => {
    if (panel === "agents" && pressedAgentId === agentId) { closePanel(); return; }
    setPressedAgentId(agentId);
    setPanel("agents");
  };
  const agentsOpen = panel === "agents" && agents.length > 0;
  const refreshPeople = () => void refreshAgents();
  const invite = manageable && session ? { session, apiBaseUrl, onChanged: refreshPeople } : null;
  return <>
    <div className="desktop-titlebar-cloud-tools" data-window-no-drag="true" aria-busy={!ready || undefined}>
      {ready && agents.length > 0 && <div ref={agentsAnchor} className="desktop-titlebar-cloud-agents-anchor">
        {renderPeople?.({ agents, open: agentsOpen, pressedAgentId, onOpen: openAgents })}
      </div>}
      <Tooltip content={t(ready ? "shell.titlebar.share" : "shell.workspaceSwitcher.location.checking")}>
        <button ref={shareButton} type="button" className="desktop-titlebar-action desktop-titlebar-share"
          data-cloud-workspace-tool="share" disabled={!ready} aria-label={t("shell.titlebar.share")}
          aria-haspopup="dialog" aria-expanded={panel === "share"} onClick={toggleShare}>
          <Forward size={15} strokeWidth={1.8} aria-hidden="true" />
        </button>
      </Tooltip>
      <span className="desktop-titlebar-action-divider" aria-hidden="true" />
      <AgentPaneTool open={agentOpen} disabled={!ready || !onToggleAgent} onToggle={onToggleAgent} />
    </div>
    {context?.status === "resolved" && <Suspense fallback={null}>
      {panel === "share" && <ShareDialog anchor={shareButton} context={context} resource={shareResource} onClose={closePanel}
        agentInvite={invite} />}
      {agentsOpen && <AgentsPanel anchor={agentsAnchor} agents={agents} renderAgentMark={renderAgentMark}
        onManage={() => setPanel("manage")} onClose={closePanel} />}
      {panel === "manage" && session && <AgentsDialog projectId={context.projectId} session={session} apiBaseUrl={apiBaseUrl}
        agents={agents} renderAgentMark={renderAgentMark} onChanged={refreshPeople} onClose={closePanel} />}
    </Suspense>}
  </>;
}

function AgentPaneTool({ open, disabled, onToggle }: { open: boolean; disabled: boolean; onToggle?: () => void }) {
  const { t } = useLocalization();
  const label = t(open ? "shell.titlebar.hideAgent" : "shell.titlebar.showAgent");
  return <Tooltip content={label}>
    <button type="button" className="desktop-titlebar-action desktop-titlebar-terminal"
      data-cloud-workspace-tool="agent" disabled={disabled} aria-label={label}
      aria-pressed={open} aria-expanded={open} onClick={onToggle}>
      <AgentEntryIcon size={15} strokeWidth={1.8} aria-hidden="true" />
    </button>
  </Tooltip>;
}
