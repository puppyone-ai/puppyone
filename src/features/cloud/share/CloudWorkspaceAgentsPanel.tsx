import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Settings } from "lucide-react";
import { Button } from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization/react";
import { DesktopMenuItem } from "../../../components/DesktopMenu";
import { DesktopTitlebarMenuLayer } from "../../../components/DesktopTitlebarMenuLayer";
import type { DesktopCloudSession } from "../../../lib/cloudApi";
import { formatRelativeTime } from "../utils";
import { decideAgentRequest, type AgentRequest } from "./agentLinks";
import { CloudWorkspaceAgentInvite } from "./CloudWorkspaceAgentInvite";
import { workspaceAgentStatus, type WorkspaceAgent } from "./useWorkspaceAgents";
import "./workspace-share.css";

/** What the list tells the shell about an Agent, to be drawn as the Header draws it. */
export type ShareAgentMark = Readonly<{ id: string; name: string; active: boolean }>;

/** Draws one Agent: the shell's mark, or a lamp where the shell lends none. */
export function agentMark(agent: ShareAgentMark, renderAgentMark?: (agent: ShareAgentMark) => ReactNode) {
  return renderAgentMark?.({ id: agent.id, name: agent.name, active: agent.active })
    ?? <span className="desktop-cloud-agent-lamp" data-active={agent.active || undefined} aria-hidden="true" />;
}

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
 */
export function CloudWorkspaceAgentsPanel({ anchor, agents, requests = [], control, renderAgentMark, onManage, onClose }: {
  anchor: RefObject<HTMLElement | null>;
  agents: readonly WorkspaceAgent[];
  requests?: readonly AgentRequest[];
  control?: AgentsPanelControl | null;
  renderAgentMark?: (agent: ShareAgentMark) => ReactNode;
  onManage: () => void;
  onClose: () => void;
}) {
  const localization = useLocalization();
  const { t } = localization;
  const [failed, setFailed] = useState(false);
  const listed = agents.length > 0 || requests.length > 0;
  return <DesktopTitlebarMenuLayer anchorRef={anchor} open onDismiss={onClose} dismissOnFocusExit={false}
    className="desktop-cloud-workspace-share desktop-cloud-agents-panel" gap={6} preferredWidth={320}
    preferredMaxHeight={560} widthMode="fixed" alignment="center" role="dialog"
    ariaLabel={t("cloud.share.agent.connected")}>
    {requests.length > 0 && control && <ul className="desktop-cloud-agent-list desktop-cloud-agent-requests"
      aria-label={t("cloud.share.agent.request.status")}>
      {requests.map(request => <AgentRequestRow key={request.id} request={request} control={control}
        renderAgentMark={renderAgentMark} onFailed={() => setFailed(true)} onDeciding={() => setFailed(false)} />)}
    </ul>}
    {failed && <p className="desktop-cloud-agents-panel-alert" role="alert">{t("cloud.share.agent.changeFailed")}</p>}
    {agents.length > 0 && <ul className="desktop-cloud-agent-list" aria-label={t("cloud.share.agent.connected")}>
      {agents.map(agent => {
        const state = workspaceAgentStatus(agent, localization);
        return <li key={agent.id} data-cloud-agent-row={agent.id}>
          {agentMark(agent, renderAgentMark)}
          <span className="desktop-cloud-agent-name" dir="auto">{agent.name}</span>
          {state && <span className="desktop-cloud-agent-state">{state}</span>}
        </li>;
      })}
    </ul>}
    {(control || agents.length > 0) && <div className="desktop-cloud-agents-foot" data-alone={!listed || undefined}>
      {control && <CloudWorkspaceAgentInvite compact={listed} session={control.session} apiBaseUrl={control.apiBaseUrl}
        projectId={control.projectId} projectName={control.projectName} waiting={control.waiting}
        onInvited={control.onInvited} renderAgentMark={renderAgentMark} />}
      {agents.length > 0 && <DesktopMenuItem className="desktop-cloud-agents-manage desktop-cloud-agents-row-action"
        role="button" data-cloud-agents-manage=""
        icon={<Settings size={15} strokeWidth={1.75} aria-hidden="true" />}
        label={t("cloud.share.agent.manage")} onClick={onManage} />}
    </div>}
  </DesktopTitlebarMenuLayer>;
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
  const [deciding, setDeciding] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const decide = async (decision: "approve" | "reject") => {
    setDeciding(true);
    onDeciding();
    try {
      await decideAgentRequest(control.session, request.id, decision, control.apiBaseUrl);
      // The row stays, disabled, until the list that no longer holds it arrives.
      control.onChanged();
    } catch {
      if (!mounted.current) return;
      setDeciding(false);
      onFailed();
    }
  };
  return <li data-cloud-agent-request={request.id}>
    <span className="desktop-cloud-agent-waiting-mark">
      {agentMark({ id: request.id, name: request.name, active: false }, renderAgentMark)}
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
