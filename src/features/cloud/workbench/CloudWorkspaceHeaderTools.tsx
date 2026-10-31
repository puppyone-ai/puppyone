import { lazy, Suspense, useRef, useState, type ReactNode, type RefObject } from "react";
import { Plug } from "lucide-react";
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

export type CloudWorkspacePeople = Readonly<{
  agents: readonly WorkspaceAgent[];
  open: boolean;
  expandedAgentId: string | null;
  /** Null asks about the Agents as a whole rather than about one of them. */
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
  const [panel, setPanel] = useState<"share" | "agents" | null>(null);
  const [expandedAgentId, setExpandedAgentId] = useState<string | null>(null);
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
    if (panel === "agents" && expandedAgentId === agentId) { closePanel(); return; }
    setExpandedAgentId(agentId);
    setPanel("agents");
  };
  const agentsOpen = panel === "agents";
  return <>
    <div className="desktop-titlebar-cloud-tools" data-window-no-drag="true" aria-busy={!ready || undefined}>
      {ready && manageable && <AgentsEntry anchor={agentsAnchor} renderPeople={renderPeople}
        people={{ agents, open: agentsOpen, expandedAgentId, onOpen: openAgents }} />}
      <Tooltip content={ready ? null : t("shell.workspaceSwitcher.location.checking")}>
        <button ref={shareButton} type="button" className="desktop-titlebar-action desktop-titlebar-share"
          data-cloud-workspace-tool="share" disabled={!ready} aria-label={t("shell.titlebar.share")}
          aria-haspopup="dialog" aria-expanded={panel === "share"} onClick={toggleShare}>
          <span className="desktop-titlebar-share-label">{t("shell.titlebar.share")}</span>
        </button>
      </Tooltip>
      <Tooltip content={t(agentOpen ? "shell.titlebar.hideAgent" : "shell.titlebar.showAgent")}>
        <button type="button" className="desktop-titlebar-action desktop-titlebar-terminal"
          data-cloud-workspace-tool="agent" disabled={!ready || !onToggleAgent}
          aria-label={t(agentOpen ? "shell.titlebar.hideAgent" : "shell.titlebar.showAgent")}
          aria-pressed={agentOpen} aria-expanded={agentOpen} onClick={onToggleAgent}>
          <AgentEntryIcon size={15} strokeWidth={1.8} aria-hidden="true" />
        </button>
      </Tooltip>
    </div>
    {panel === "share" && context?.status === "resolved" && <Suspense fallback={null}>
      <ShareDialog anchor={shareButton} context={context} resource={shareResource} onClose={closePanel} />
    </Suspense>}
    {agentsOpen && context?.status === "resolved" && session && <Suspense fallback={null}>
      <AgentsPanel anchor={agentsAnchor} projectId={context.projectId}
        projectName={context.projectName || context.projectId} session={session} apiBaseUrl={apiBaseUrl}
        agents={agents} expandedAgentId={expandedAgentId} onExpandAgent={setExpandedAgentId}
        renderAgentMark={renderAgentMark} onChanged={() => void refreshAgents()} onClose={closePanel} />
    </Suspense>}
  </>;
}

/** Who is here, or with nobody connected the way to connect one: there is no mark to press then. */
function AgentsEntry({ anchor, people, renderPeople }: {
  anchor: RefObject<HTMLDivElement>;
  people: CloudWorkspacePeople;
  renderPeople: Props["renderPeople"];
}) {
  const { t } = useLocalization();
  return <div ref={anchor} className="desktop-titlebar-cloud-agents-anchor">
    {people.agents.length > 0 ? renderPeople?.(people) : <Tooltip content={t("cloud.share.agent.title")}>
      <button type="button" className="desktop-titlebar-action desktop-titlebar-cloud-tool"
        data-cloud-workspace-tool="connect-agent" aria-label={t("cloud.share.agent.title")}
        aria-haspopup="dialog" aria-expanded={people.open} onClick={() => people.onOpen(null)}>
        <Plug size={15} strokeWidth={1.8} aria-hidden="true" />
      </button>
    </Tooltip>}
  </div>;
}
