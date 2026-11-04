import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ChevronRight, X } from "lucide-react";
import { Button, Tooltip } from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization/react";
import { DesktopDialogCloseButton, DesktopDialogRoot, DesktopDialogSurface } from "../../../components/DesktopDialog";
import { DesktopOverlayLayer } from "../../../components/DesktopOverlayPortal";
import type { DesktopCloudSession } from "../../../lib/cloudApi";
import { formatRelativeTime } from "../utils";
import { listAgentLinks, removeConnectedAgent, stopSharingWithAgents, type AgentLinkInventory,
  type AgentRequest } from "./agentLinks";
import { agentMark, type ShareAgentMark } from "./agentMark";
import { AgentFirstInvite, AgentInviteSeat, AgentInviteStatus, AgentInviteSteps, useAgentInvite } from "./CloudWorkspaceAgentInvite";
import { useAgentRequestAnswer } from "./useAgentRequestAnswer";
import { workspaceAgentStatus, type WorkspaceAgent } from "./useWorkspaceAgents";
import "./workspace-share.css";

/** While it is open, a link made or used elsewhere shows up on its own. */
const REFRESH_MS = 5_000;
/** The roster meets each Agent as itself, larger than in the Header. */
const TILE_MARK_SIZE = 48;
const EMPTY: AgentLinkInventory = { links: [], connections: [] };
const ADMISSION_LABEL = {
  sign_in: "cloud.share.agent.signIn.label",
  link: "cloud.share.agent.link.label",
} as const;
const DATE_FORMAT = { month: "short", day: "numeric" } as const;

/** Only the owner may let an Agent in, so only they get the dialog's controls. */
export type AgentsControl = Readonly<{
  session: DesktopCloudSession;
  apiBaseUrl: string;
  projectId: string;
  projectName: string;
  onInvited: () => void;
  /** The Header states who is here, so it hears about a change at once rather than on its next poll. */
  onChanged: () => void;
}>;

/**
 * Everything about a project's Agents, opened straight from the Header: who
 * is here, in one row, each as itself with when it last worked; an Agent
 * asking to join among them, to be let in where it stands; an empty seat with a
 * + at the end of the row that invites the next one; and, folded away at the
 * foot, the links still open.
 */
export function CloudWorkspaceAgentsDialog({ control, agents, requests, renderAgentMark, onClose }: {
  control: AgentsControl;
  agents: readonly WorkspaceAgent[];
  requests: readonly AgentRequest[];
  renderAgentMark?: (agent: ShareAgentMark) => ReactNode;
  onClose: () => void;
}) {
  const { t } = useLocalization();
  const { session, apiBaseUrl, projectId, projectName } = control;
  const [inventory, setInventory] = useState(EMPTY);
  const [failed, setFailed] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const refresh = useCallback(async () => {
    try {
      const next = await listAgentLinks(session, projectId, apiBaseUrl);
      if (mounted.current) setInventory(next);
    } catch { /* What is shown stays until a read succeeds. */ }
  }, [apiBaseUrl, projectId, session]);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);
  /** A change is made, then both the links here and the Header's Agents are read again. */
  const change = async (action: () => Promise<unknown>) => {
    setFailed(false);
    try { await action(); await refresh(); control.onChanged(); return true; }
    catch { if (mounted.current) setFailed(true); return false; }
  };
  const nobody = agents.length === 0 && requests.length === 0;
  const title = t("cloud.share.agent.title");
  // Nobody here yet: the dialog opens on how to invite, with Copy as the first thing to press.
  const [openedEmpty] = useState(nobody);
  const invite = useAgentInvite({ session, apiBaseUrl, projectId, projectName, openFirst: openedEmpty,
    onInvited: control.onInvited });
  const { seatRef, stepsRef, sectionRef, arrowX } = useInviteSteps(invite, agents.length + requests.length);
  return <DesktopOverlayLayer>
    <DesktopDialogRoot onClose={onClose}>
      <DesktopDialogSurface className="desktop-cloud-agents-dialog" width={560} ariaLabel={title}>
        <header className="desktop-dialog-header">
          <div className="desktop-dialog-title-row">
            <h2>{title}</h2>
            <span className="desktop-cloud-agents-dialog-project" dir="auto">{projectName}</span>
          </div>
          <Tooltip content={t("common.action.close")}>
            <DesktopDialogCloseButton label={t("common.action.close")} onClick={onClose} />
          </Tooltip>
        </header>
        <div className="desktop-dialog-body desktop-cloud-agents-dialog-body">
          <section ref={sectionRef} className="desktop-cloud-agents-roster-section" aria-label={t("cloud.share.agent.connected")}>
            {nobody
              ? <AgentFirstInvite invite={invite} seatRef={seatRef} />
              : <ul className="desktop-cloud-agents-roster" data-po-scrollbar="menu">
                {requests.map(request => <AgentAskingTile key={request.id} request={request} control={control}
                  renderAgentMark={renderAgentMark} onDeciding={() => setFailed(false)} onFailed={() => setFailed(true)} />)}
                {/* In the Header's order: whoever is at work first, then the ones at rest. */}
                {[...agents].sort((left, right) => Number(right.active) - Number(left.active)).map(agent =>
                  <AgentTile key={agent.id} agent={agent} renderAgentMark={renderAgentMark}
                    onRemove={() => change(() => removeConnectedAgent(session, projectId, agent.grant_id, apiBaseUrl))} />)}
                <AgentInviteSeat invite={invite} seatRef={seatRef} />
              </ul>}
            {invite.open && <AgentInviteSteps invite={invite} stepsRef={stepsRef} arrowX={arrowX} firstFocus={openedEmpty} />}
            <AgentInviteStatus invite={invite} />
            {failed && <p className="desktop-cloud-agents-alert" role="alert">{t("cloud.share.agent.changeFailed")}</p>}
          </section>
        </div>
        <AgentLinks links={inventory.links} anyone={!nobody || inventory.links.length > 0}
          onRemoveAll={() => change(() => stopSharingWithAgents(session, projectId, apiBaseUrl))} />
      </DesktopDialogSurface>
    </DesktopDialogRoot>
  </DesktopOverlayLayer>;
}

/**
 * One Agent in the row: its mark, its name, and when it last worked. Removing
 * it asks once, on the tile itself, so a slip never takes an Agent out.
 */
function AgentTile({ agent, renderAgentMark, onRemove }: {
  agent: WorkspaceAgent;
  renderAgentMark?: (agent: ShareAgentMark) => ReactNode;
  onRemove: () => Promise<boolean>;
}) {
  const localization = useLocalization();
  const { t } = localization;
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const keep = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (confirming) keep.current?.focus(); }, [confirming]);
  const remove = async () => {
    setRemoving(true);
    // A removed Agent's tile leaves with the list that no longer holds it.
    if (!await onRemove()) { setRemoving(false); setConfirming(false); }
  };
  return <li className="desktop-cloud-agent-tile" data-cloud-agent-row={agent.id} data-active={agent.active || undefined}
    data-confirming={confirming || undefined}>
    <span className="desktop-cloud-agent-portrait">{agentMark({ ...agent, size: TILE_MARK_SIZE }, renderAgentMark)}</span>
    <span className="desktop-cloud-agent-name" dir="auto">{agent.name}</span>
    {confirming
      ? <span className="desktop-cloud-agent-tile-actions">
        <button ref={keep} type="button" className="desktop-cloud-agent-tile-keep" disabled={removing}
          onClick={() => setConfirming(false)}>{t("cloud.share.agent.keep")}</button>
        <Button tone="danger" className="desktop-cloud-agent-tile-confirm" disabled={removing}
          aria-label={`${t("cloud.share.agent.remove")} ${agent.name}`} onClick={() => void remove()}>
          {t("cloud.share.agent.remove")}
        </Button>
      </span>
      : <>
        <span className="desktop-cloud-agent-state" data-live={agent.active || undefined}>{agentRecency(agent, localization)}</span>
        <Tooltip content={`${t("cloud.share.agent.remove")} ${agent.name}`}>
          <button type="button" className="desktop-cloud-agent-tile-remove" data-cloud-agent-remove={agent.id}
            aria-label={`${t("cloud.share.agent.remove")} ${agent.name}`} onClick={() => setConfirming(true)}>
            <X size={12} strokeWidth={2.2} aria-hidden="true" />
          </button>
        </Tooltip>
      </>}
  </li>;
}

/** An Agent asking to join, in the row with the others, answered where it stands. */
function AgentAskingTile({ request, control, renderAgentMark, onDeciding, onFailed }: {
  request: AgentRequest;
  control: AgentsControl;
  renderAgentMark?: (agent: ShareAgentMark) => ReactNode;
  onDeciding: () => void;
  onFailed: () => void;
}) {
  const { t } = useLocalization();
  const { deciding, answer } = useAgentRequestAnswer({ session: control.session, apiBaseUrl: control.apiBaseUrl,
    onChanged: control.onChanged, onDeciding, onFailed });
  return <li className="desktop-cloud-agent-tile" data-cloud-agent-request={request.id} data-asking="">
    <span className="desktop-cloud-agent-portrait desktop-cloud-agent-waiting-mark">
      {agentMark({ id: request.id, name: request.name, avatar: request.avatar, active: false, size: TILE_MARK_SIZE },
        renderAgentMark)}
    </span>
    <span className="desktop-cloud-agent-name" dir="auto">{request.name}</span>
    <span className="desktop-cloud-agent-state">{t("cloud.share.agent.request.status")}</span>
    <span className="desktop-cloud-agent-tile-actions">
      <button type="button" className="desktop-cloud-agent-request-deny" disabled={deciding}
        aria-label={`${t("cloud.share.agent.request.deny")} ${request.name}`} onClick={() => void answer(request.id, "reject")}>
        {t("cloud.share.agent.request.deny")}
      </button>
      <Button tone="primary" className="desktop-cloud-agent-request-allow" disabled={deciding}
        aria-label={`${t("cloud.share.agent.request.allow")} ${request.name}`} onClick={() => void answer(request.id, "approve")}>
        {t("cloud.share.agent.request.allow")}
      </Button>
    </span>
  </li>;
}

/**
 * The invite links still open, folded away at the foot because they are
 * looked at rarely. Removing everything asks once, since it ends every Agent's
 * access and every link together.
 */
function AgentLinks({ links, anyone, onRemoveAll }: {
  links: AgentLinkInventory["links"];
  /** Whether there is anyone or anything for Remove all to end. */
  anyone: boolean;
  onRemoveAll: () => Promise<boolean>;
}) {
  const localization = useLocalization();
  const { formatDate, t } = localization;
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const listId = useId();
  const removeAll = async () => {
    setRemoving(true);
    await onRemoveAll();
    setRemoving(false);
    setConfirming(false);
  };
  return <footer className="desktop-cloud-agents-dialog-foot">
    <button type="button" className="desktop-cloud-agents-links-toggle" aria-expanded={open} aria-controls={listId}
      onClick={() => setOpen(value => !value)}>
      <ChevronRight className="desktop-cloud-agents-links-chevron" size={14} strokeWidth={2} aria-hidden="true" />
      {t("cloud.share.agent.links.manage")}
      <span className="desktop-cloud-agents-links-count">{t("cloud.share.agent.links.count", { count: links.length })}</span>
    </button>
    {open && <div id={listId} className="desktop-cloud-agents-links">
      {links.length === 0
        ? <p className="desktop-cloud-agents-links-none">{t("cloud.share.agent.links.none")}</p>
        : <ul aria-label={t("cloud.share.agent.links")}>{links.map(link => <li key={link.id} data-cloud-agent-link={link.id}>
          <span className="desktop-cloud-agents-link-who">{t(ADMISSION_LABEL[link.admission])}</span>
          {[link.created_at ? t("cloud.share.agent.links.made", { time: formatRelativeTime(link.created_at, localization) }) : null,
            t("cloud.share.agent.linkExpires", { date: formatDate(link.expires_at, DATE_FORMAT) })]
            .filter(Boolean).map(fact => <span key={fact} className="desktop-cloud-agents-link-fact">{fact}</span>)}
        </li>)}</ul>}
      {/* The service ends links and connections together, so the action says both. */}
      {anyone && (confirming
        ? <p className="desktop-cloud-agents-remove-all" data-confirming="">
          <span>{t("cloud.share.agent.removeAllConfirm")}</span>
          <button type="button" className="desktop-cloud-agent-tile-keep" disabled={removing}
            onClick={() => setConfirming(false)}>{t("cloud.share.agent.keep")}</button>
          <Button tone="danger" className="desktop-cloud-agent-tile-confirm" disabled={removing}
            onClick={() => void removeAll()}>{t("cloud.share.agent.removeAll")}</Button>
        </p>
        : <p className="desktop-cloud-agents-remove-all">
          <button type="button" className="desktop-cloud-agent-share-stop" onClick={() => setConfirming(true)}>
            {t("cloud.share.agent.removeAll")}
          </button>
        </p>)}
    </div>}
  </footer>;
}

/**
 * The steps under the seat that was pressed. They point at it, fold away on a
 * press anywhere else, and give way as soon as an Agent turns up in the row.
 */
function useInviteSteps(invite: ReturnType<typeof useAgentInvite>, present: number) {
  const seatRef = useRef<HTMLButtonElement>(null);
  const stepsRef = useRef<HTMLDivElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const [arrowX, setArrowX] = useState<number | null>(null);
  const shown = invite.open;
  const { close: dismiss } = invite;
  useLayoutEffect(() => {
    const seat = seatRef.current?.getBoundingClientRect();
    const section = sectionRef.current;
    const box = section?.getBoundingClientRect();
    // Measured in the section's own pixels, so a dialog still scaling in as it opens does not skew it.
    const scale = box && section?.offsetWidth ? box.width / section.offsetWidth : 1;
    setArrowX(shown && seat && box ? (seat.left + seat.width / 2 - box.left) / (scale || 1) : null);
  }, [shown]);
  useEffect(() => {
    if (!shown) return undefined;
    const elsewhere = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (target && (seatRef.current?.contains(target) || stepsRef.current?.contains(target))) return;
      dismiss();
    };
    document.addEventListener("pointerdown", elsewhere, true);
    return () => document.removeEventListener("pointerdown", elsewhere, true);
  }, [dismiss, shown]);
  const seen = useRef(present);
  useEffect(() => {
    if (present > seen.current) dismiss();
    seen.current = present;
  }, [dismiss, present]);
  return { seatRef, stepsRef, sectionRef, arrowX };
}

/**
 * The tile already names the Agent, so under it is only when it last worked;
 * one at work now says so, in the success colour.
 */
function agentRecency(agent: WorkspaceAgent, localization: ReturnType<typeof useLocalization>) {
  if (agent.active || !agent.activityKnown || !agent.lastActiveAt) return workspaceAgentStatus(agent, localization);
  return formatRelativeTime(agent.lastActiveAt, localization);
}
