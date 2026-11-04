import { useState, type ReactNode, type RefObject } from "react";
import { LoaderCircle, Plus, Settings } from "lucide-react";
import { Button } from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization/react";
import { DesktopMenuItem, DesktopMenuSeparator } from "../../../components/DesktopMenu";
import { DesktopTitlebarMenuLayer } from "../../../components/DesktopTitlebarMenuLayer";
import type { DesktopCloudSession } from "../../../lib/cloudApi";
import { formatRelativeTime } from "../utils";
import type { AgentRequest } from "./agentLinks";
import { useAgentRequestAnswer } from "./useAgentRequestAnswer";
import { agentMark, type ShareAgentMark } from "./agentMark";
import { CloudWorkspaceAgentInvite } from "./CloudWorkspaceAgentInvite";
import { workspaceAgentStatus, type WorkspaceAgent } from "./useWorkspaceAgents";
import "./workspace-share.css";

/** Larger than in the Header: the card is where the Agents are met, not glanced at. */
const ROSTER_MARK_SIZE = 40;
/** An Agent asking to join, big enough to be recognized in the roster once it is let in. */
const REQUEST_MARK_SIZE = 28;

/** Only the owner may let an Agent in, so only they get the card's controls. */
export type AgentsPanelControl = Readonly<{
  session: DesktopCloudSession;
  apiBaseUrl: string;
  projectId: string;
  projectName: string;
  /** An invite is out and no Agent has answered it yet. */
  waiting: boolean;
  onInvited: () => void;
  /** The Header states who is here, so it hears about a change at once rather than on its next poll. */
  onChanged: () => void;
}>;

/**
 * Everything about Agents in one card under the Header: who asks to join and
 * the answer, who is here and when each was last here, and how to invite one.
 * Removing an Agent is a bigger decision, so it stays in Manage agents.
 *
 * It is a Header menu like the project and place menus on the left (their
 * surface, inset, separator, width and the edge it hangs from) except where it
 * meets the Agents: they are a roster, each as itself with its name and when
 * it was last here under it, the one at work awake, rather than rows squeezed
 * into an icon column. Inviting another and managing are menu rows, each
 * opening a dialog of its own. It is wider only where a row needs it: the first
 * invite, with nothing to list yet, is the ticket itself, and an Agent asking
 * to join keeps when it asked beside its answer.
 */
export function CloudWorkspaceAgentsPanel({ anchor, agents, requests = [], control, renderAgentMark, onInvite, onManage,
  onClose }: {
  anchor: RefObject<HTMLElement | null>;
  agents: readonly WorkspaceAgent[];
  requests?: readonly AgentRequest[];
  control?: AgentsPanelControl | null;
  renderAgentMark?: (agent: ShareAgentMark) => ReactNode;
  /** Inviting another Agent is a dialog of its own, as Manage agents is. */
  onInvite?: () => void;
  onManage: () => void;
  onClose: () => void;
}) {
  const localization = useLocalization();
  const { t } = localization;
  const [failed, setFailed] = useState(false);
  const listed = agents.length > 0 || requests.length > 0;
  const asking = requests.length > 0 && control;
  return <DesktopTitlebarMenuLayer anchorRef={anchor} open onDismiss={onClose} dismissOnFocusExit={false}
    className="desktop-cloud-workspace-share desktop-cloud-agents-panel" gap={2} preferredWidth={listed && !asking ? 280 : 320}
    preferredMaxHeight={560} widthMode="fixed" alignment="end" role="dialog"
    ariaLabel={t("cloud.share.agent.connected")}>
    {asking && <ul className="desktop-cloud-agent-list desktop-cloud-agent-requests"
      aria-label={t("cloud.share.agent.request.status")}>
      {requests.map(request => <AgentRequestRow key={request.id} request={request} control={control}
        renderAgentMark={renderAgentMark} onFailed={() => setFailed(true)} onDeciding={() => setFailed(false)} />)}
    </ul>}
    {failed && <p className="desktop-cloud-agents-panel-alert" role="alert">{t("cloud.share.agent.changeFailed")}</p>}
    {agents.length > 0 && asking && <DesktopMenuSeparator />}
    {agents.length > 0 && <ul className="desktop-cloud-agent-roster" aria-label={t("cloud.share.agent.connected")}>
      {/* In the Header's order: whoever is at work first, then the ones at rest. */}
      {[...agents].sort((left, right) => Number(right.active) - Number(left.active)).map(agent => {
        const state = agentRecency(agent, localization);
        return <li key={agent.id} data-cloud-agent-row={agent.id} data-active={agent.active || undefined}>
          <span className="desktop-cloud-agent-portrait">{agentMark({ ...agent, size: ROSTER_MARK_SIZE }, renderAgentMark)}</span>
          <span className="desktop-cloud-agent-name" dir="auto">{agent.name}</span>
          {state && <span className="desktop-cloud-agent-state">{state}</span>}
        </li>;
      })}
    </ul>}
    {listed && (control || agents.length > 0) && <DesktopMenuSeparator />}
    {(control || agents.length > 0) && <div className="desktop-cloud-agents-foot" data-alone={!listed || undefined}>
      {control && !listed && <CloudWorkspaceAgentInvite session={control.session} apiBaseUrl={control.apiBaseUrl}
        projectId={control.projectId} projectName={control.projectName} waiting={control.waiting}
        onInvited={control.onInvited} renderAgentMark={renderAgentMark} />}
      {control && listed && <DesktopMenuItem className="desktop-cloud-agents-row-action" role="button"
        data-cloud-agent-invite-open="" aria-haspopup="dialog"
        icon={<Plus size={15} strokeWidth={1.75} aria-hidden="true" />}
        label={t("cloud.share.agent.invite.another")} onClick={onInvite} />}
      {/* An invite copied in the dialog is still awaited here, under the row that opens it. */}
      {control && listed && control.waiting && <p className="desktop-cloud-agent-invite-note" role="status">
        <LoaderCircle className="animate-spin" size={12} strokeWidth={2.2} aria-hidden="true" />
        {t("cloud.share.agent.invite.waiting")}
      </p>}
      {agents.length > 0 && <DesktopMenuItem className="desktop-cloud-agents-manage desktop-cloud-agents-row-action"
        role="button" data-cloud-agents-manage=""
        icon={<Settings size={15} strokeWidth={1.75} aria-hidden="true" />}
        label={t("cloud.share.agent.manage")} onClick={onManage} />}
    </div>}
  </DesktopTitlebarMenuLayer>;
}

/**
 * The row already names the Agent and the list is who is here, so the trailing
 * fact is only how long ago it was here; "Last active" would say it twice and
 * take the name's room.
 */
function agentRecency(agent: WorkspaceAgent, localization: ReturnType<typeof useLocalization>) {
  if (agent.active || !agent.activityKnown || !agent.lastActiveAt) return workspaceAgentStatus(agent, localization);
  return formatRelativeTime(agent.lastActiveAt, localization);
}

/**
 * An Agent asking to join, answered where the owner already is. It names
 * itself, so the time it asked is what ties it to the invite just sent.
 */
function AgentRequestRow({ request, control, renderAgentMark, onFailed, onDeciding }: {
  request: AgentRequest;
  control: AgentsPanelControl;
  renderAgentMark?: (agent: ShareAgentMark) => ReactNode;
  onFailed: () => void;
  onDeciding: () => void;
}) {
  const localization = useLocalization();
  const { t } = localization;
  const { deciding, answer } = useAgentRequestAnswer({ session: control.session, apiBaseUrl: control.apiBaseUrl,
    onChanged: control.onChanged, onDeciding, onFailed });
  const decide = (decision: "approve" | "reject") => answer(request.id, decision);
  return <li data-cloud-agent-request={request.id}>
    <span className="desktop-cloud-agent-waiting-mark">
      {agentMark({ id: request.id, name: request.name, active: false, avatar: request.avatar,
        size: REQUEST_MARK_SIZE }, renderAgentMark)}
    </span>
    <span className="desktop-cloud-agent-request-text">
      <span className="desktop-cloud-agent-name" dir="auto">{request.name}</span>
      <span className="desktop-cloud-agent-state">
        {t("cloud.share.agent.request.status")} · {formatRelativeTime(request.requested_at, localization)}
      </span>
    </span>
    <span className="desktop-cloud-agent-request-actions">
      <button type="button" className="desktop-cloud-agent-request-deny" disabled={deciding}
        aria-label={`${t("cloud.share.agent.request.deny")} ${request.name}`} onClick={() => void decide("reject")}>
        {t("cloud.share.agent.request.deny")}
      </button>
      <Button tone="primary" className="desktop-cloud-agent-request-allow" disabled={deciding}
        aria-label={`${t("cloud.share.agent.request.allow")} ${request.name}`} onClick={() => void decide("approve")}>
        {t("cloud.share.agent.request.allow")}
      </Button>
    </span>
  </li>;
}
