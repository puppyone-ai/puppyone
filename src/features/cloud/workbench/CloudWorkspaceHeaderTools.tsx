import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { Forward, LoaderCircle, Plus } from "lucide-react";
import { Tooltip } from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization/react";
import { AgentEntryIcon } from "../../../components/brand/AgentEntryIcon";
import type { DesktopCloudSession } from "../../../lib/cloudApi";
import type { ProjectCloudContext } from "../project/context";
import type { CloudWorkspaceShareResource } from "../share/cloudWorkspaceShareResource";
import type { AgentRequest } from "../share/agentLinks";
import { CloudWorkspaceAgentRequestCard } from "../share/CloudWorkspaceAgentRequestCard";
import type { ShareAgentMark } from "../share/agentMark";
import { useWorkspaceAgents, type WorkspaceAgent } from "../share/useWorkspaceAgents";

const ShareDialog = lazy(() => import("../share/CloudWorkspaceShareDialog").then(module => ({ default: module.CloudWorkspaceShareDialog })));
const AgentsDialog = lazy(() => import("../share/CloudWorkspaceAgentsDialog").then(module => ({ default: module.CloudWorkspaceAgentsDialog })));

export type CloudWorkspacePeople = Readonly<{
  agents: readonly WorkspaceAgent[];
  /** Agents asking to join; their persistent card asks the owner for a decision. */
  requests: readonly AgentRequest[];
  open: boolean;
  /** The mark that opened the dialog, so the Header shows which one is pressed. */
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

/**
 * Sharing with people stays out of the Header until inviting Agents works end
 * to end; its card and dialog are kept so it can come back as it is.
 */
const SHARE_WITH_PEOPLE = false;
/** A sign-in request lasts ten minutes, so an invite with no answer by then is not awaited. */
const INVITE_WAIT_MS = 10 * 60_000;
/** Who opened the Agents dialog: one Agent's mark, the stack of the ones at rest, or the empty seat. */
const MORE = "more";
const INVITE = "invite";

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
  const [opener, setOpener] = useState<string | null>(null);
  /** The Agents already here when the last invite was copied, so a newcomer ends the wait. */
  const [invite, setInvite] = useState<ReadonlySet<string> | null>(null);
  const shareButton = useRef<HTMLButtonElement>(null);
  const agentsAnchor = useRef<HTMLDivElement>(null);
  const denyRequest = useRef<HTMLButtonElement>(null);
  const [shareResource, setShareResource] = useState<CloudWorkspaceShareResource | null | undefined>();
  const ready = context?.status === "resolved" && session !== null;
  // Inviting watches closely for an answer; a pending request then has its own persistent card.
  const { agents, requests, manageable, loading, refresh: refreshAgents } = useWorkspaceAgents(
    agentTarget(context, session, apiBaseUrl), { waiting: panel === "agents" || invite !== null });
  const pending = requests[0];
  // A decision takes the place of the invite/dialog, never another competing overlay.
  useEffect(() => { if (pending?.id) setPanel(null); }, [pending?.id]);
  const answered = invite !== null && (requests.length > 0 || agents.some(agent => !invite.has(agent.id)));
  useEffect(() => { if (answered) setInvite(null); }, [answered]);
  useEffect(() => {
    if (!invite) return undefined;
    const timer = setTimeout(() => setInvite(null), INVITE_WAIT_MS);
    return () => clearTimeout(timer);
  }, [invite]);
  const closePanel = () => setPanel(null);
  const toggleShare = () => {
    if (panel === "share") { closePanel(); return; }
    try { setShareResource(getShareResource?.()); }
    catch { setShareResource(null); }
    setPanel("share");
  };
  // The Agents open straight into their dialog: no menu stands between the Header and what it opens.
  const openAgents = (next: string) => {
    if (pending) { denyRequest.current?.focus(); return; }
    setOpener(next);
    setPanel("agents");
  };
  const listed = agents.length > 0 || requests.length > 0;
  const agentsOpen = !pending && panel === "agents" && (listed || manageable);
  const refreshPeople = () => void refreshAgents();
  // After an invite, the Agents are read more often until one answers, so it shows up while it is awaited.
  const control = manageable && session && context?.status === "resolved" ? {
    session, apiBaseUrl, projectId: context.projectId, projectName: context.projectName || context.projectId,
    onInvited: () => { setInvite(new Set(agents.map(agent => agent.id))); refreshPeople(); },
    onChanged: refreshPeople,
  } : null;
  const pressedAgentId = opener === MORE || opener === INVITE ? null : opener;
  // Until it is known whether this person may invite, the seat holds its place rather than appearing late.
  const checking = session !== null && (!context || context.status === "resolving" || loading);
  // The empty seat is the way in only while nobody is here; once Agents are, any of them opens the dialog.
  const seat = (manageable || checking) && !(ready && listed);
  const agentsShown = (ready && listed) || seat;
  return <>
    <div className="desktop-titlebar-cloud-tools" data-window-no-drag="true" aria-busy={!ready || undefined}
      data-share-people={SHARE_WITH_PEOPLE || undefined}>
      {agentsShown && <div ref={agentsAnchor} className="desktop-titlebar-cloud-agents-anchor">
        {ready && listed && renderPeople?.({ agents, requests, open: agentsOpen && opener !== INVITE, pressedAgentId,
          onOpen: agentId => openAgents(agentId ?? MORE) })}
        {seat && <InviteAgentTool checking={!manageable} open={agentsOpen && opener === INVITE}
          onOpen={() => openAgents(INVITE)} />}
      </div>}
      {SHARE_WITH_PEOPLE && <Tooltip content={t(ready ? "shell.titlebar.share" : "shell.workspaceSwitcher.location.checking")}>
        <button ref={shareButton} type="button" className="desktop-titlebar-action desktop-titlebar-share"
          data-cloud-workspace-tool="share" disabled={!ready} aria-label={t("shell.titlebar.share")}
          aria-haspopup="dialog" aria-expanded={panel === "share"} onClick={toggleShare}>
          <Forward size={15} strokeWidth={1.8} aria-hidden="true" />
        </button>
      </Tooltip>}
      {(agentsShown || SHARE_WITH_PEOPLE) && <span className="desktop-titlebar-action-divider" aria-hidden="true" />}
      <AgentPaneTool open={agentOpen} disabled={!ready || !onToggleAgent} onToggle={onToggleAgent} />
    </div>
    {pending && control && <CloudWorkspaceAgentRequestCard key={pending.id} request={pending} count={requests.length}
      anchorRef={agentsAnchor} denyRef={denyRequest} session={control.session} apiBaseUrl={apiBaseUrl}
      projectName={control.projectName} onChanged={refreshPeople} renderAgentMark={renderAgentMark} />}
    {context?.status === "resolved" && <Suspense fallback={null}>
      {panel === "share" && <ShareDialog anchor={shareButton} context={context} resource={shareResource} onClose={closePanel} />}
      {agentsOpen && control && <AgentsDialog control={control} agents={agents} requests={requests}
        renderAgentMark={renderAgentMark} onClose={closePanel} />}
    </Suspense>}
  </>;
}

/** An empty seat where the Agents will be: the first one invited takes its place in the row. */
function InviteAgentTool({ checking, open, onOpen }: { checking: boolean; open: boolean; onOpen: () => void }) {
  const { t } = useLocalization();
  const label = t(checking ? "shell.workspaceSwitcher.location.checking" : "cloud.share.agent.invite.title");
  return <Tooltip content={label}>
    <button type="button" className="desktop-titlebar-cloud-agent desktop-titlebar-cloud-agent-invite"
      data-cloud-workspace-tool="invite-agent" data-checking={checking || undefined} disabled={checking}
      aria-label={label} aria-haspopup="dialog" aria-expanded={open} onClick={onOpen}>
      <span className="desktop-titlebar-cloud-agent-seat" aria-hidden="true">
        {checking
          ? <LoaderCircle className="animate-spin" size={13} strokeWidth={2} />
          : <Plus size={13} strokeWidth={2} />}
      </span>
    </button>
  </Tooltip>;
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
