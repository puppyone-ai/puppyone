import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Check } from "lucide-react";
import { Button } from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization/react";
import type { DesktopCloudSession } from "../../../lib/cloudApi";
import { writeClipboardText } from "../../../lib/clipboard";
import { agentConnectMessage, createAgentLink, listAgentLinks, type AgentAdmission, type AgentRequest } from "./agentLinks";
import { agentMark, type ShareAgentMark } from "./agentMark";
import { useAgentRequestAnswer } from "./useAgentRequestAnswer";
import type { WorkspaceAgent } from "./useWorkspaceAgents";

/** Long enough to read, short enough that the button is ready for a second Agent. */
const COPIED_MS = 3_000;
const ADMISSIONS = ["sign_in", "link"] as const;
/** The part of the link only copying makes, shown as what it is: not there yet. */
const UNMINTED = "••••••";
const DOOR_MARK_SIZE = 24;
/** Whoever stands at an empty door: an Agent with no name or brand yet, asleep until one is awaited. */
const SOMEONE = { id: "agent-door", name: "agent-door", avatar: "other" } as const;
type CopyStatus = "idle" | "copying" | "copied" | "failed" | "not-owner";
const COPY_LABEL: Record<CopyStatus, string> = {
  idle: "cloud.share.agent.ticket.copy",
  copying: "cloud.common.copying",
  copied: "cloud.share.action.copied",
  failed: "cloud.share.agent.ticket.copy",
  "not-owner": "cloud.share.agent.ticket.copy",
};
const AGAIN_LABEL: Record<CopyStatus, string> = { ...COPY_LABEL, idle: "cloud.share.agent.ticket.copyAgain",
  failed: "cloud.share.agent.ticket.copyAgain", "not-owner": "cloud.share.agent.ticket.copyAgain" };
const OPTION_TEXT = {
  sign_in: { label: "cloud.share.agent.signIn.label", description: "cloud.share.agent.signIn.description" },
  link: { label: "cloud.share.agent.link.label", description: "cloud.share.agent.link.description" },
} as const;

/** Who comes to the door where the invite is a dialog of its own; the Agents card lists them itself. */
export type AgentInviteDoor = Readonly<{
  agents: readonly WorkspaceAgent[];
  requests: readonly AgentRequest[];
  onChanged: () => void;
}>;

/**
 * Inviting an Agent, as handing it a ticket: admit one agent to this project.
 * The prompt is printed on the ticket and the stub copies it; copying tears
 * the stub off, and the ticket says it is handed out and what to do with it.
 * Under it is the door the Agent comes to: empty, then awaited, then the Agent
 * at it to be let in, then in. The link inside is created only by copying, so
 * opening the ticket mints nothing, and every copy is a new link.
 */
export function CloudWorkspaceAgentInvite({ projectId, projectName, session, apiBaseUrl,
  initialFocus = false, waiting = false, onInvited, renderAgentMark, door = null }: {
  projectId: string;
  projectName: string;
  session: DesktopCloudSession;
  apiBaseUrl: string;
  /** Where a dialog puts focus first: the one thing to do. */
  initialFocus?: boolean;
  /** An invite is out and no Agent has answered it yet. */
  waiting?: boolean;
  /** The Header waits for the answer, so it hears about an invite at once. */
  onInvited?: () => void;
  /** The shell's Agent marks, so the door shows Agents as the Header does. */
  renderAgentMark?: (agent: ShareAgentMark) => ReactNode;
  door?: AgentInviteDoor | null;
}) {
  const { t } = useLocalization();
  const hintId = useId();
  const [admission, setAdmission] = useState<AgentAdmission>("sign_in");
  const [openLinks, setOpenLinks] = useState(false);
  const [status, setStatus] = useState<CopyStatus>("idle");
  /** The Agents already here when the ticket was handed out; anyone else has come in since. */
  const [handedOut, setHandedOut] = useState<ReadonlySet<string> | null>(null);
  const mounted = useRef(true);
  const stub = useRef<HTMLDivElement>(null);
  const again = useRef<HTMLButtonElement>(null);
  const focusAgain = useRef(false);
  const options = useRef<Partial<Record<AgentAdmission, HTMLButtonElement | null>>>({});
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    void listAgentLinks(session, projectId, apiBaseUrl)
      .then(inventory => { if (mounted.current) setOpenLinks(Boolean(inventory.open_links_enabled)); })
      .catch(() => undefined); // Only the choice depends on it; inviting does not.
  }, [apiBaseUrl, projectId, session]);
  useEffect(() => {
    if (status !== "copied") return undefined;
    const timer = setTimeout(() => setStatus("idle"), COPIED_MS);
    return () => clearTimeout(timer);
  }, [status]);
  // The stub's button tears off with the stub, so its focus moves to copying again.
  useEffect(() => {
    if (!handedOut || !focusAgain.current) return;
    focusAgain.current = false;
    again.current?.focus();
  }, [handedOut]);

  const copy = async () => {
    const fromStub = Boolean(stub.current?.contains(document.activeElement));
    setStatus("copying");
    try {
      const url = await createAgentLink(session, projectId, openLinks ? admission : "sign_in", apiBaseUrl);
      await writeClipboardText(agentConnectMessage(projectName, url));
      if (!mounted.current) return;
      setStatus("copied");
      if (!handedOut) {
        focusAgain.current = fromStub;
        setHandedOut(new Set((door?.agents ?? []).map(agent => agent.id)));
      }
      onInvited?.();
    } catch (error) {
      if (mounted.current) setStatus((error as { status?: number }).status === 403 ? "not-owner" : "failed");
    }
  };
  const choose = (next: AgentAdmission) => { setAdmission(next); setStatus("idle"); };
  const moveChoice = (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const next = ADMISSIONS[(ADMISSIONS.indexOf(admission) + step + ADMISSIONS.length) % ADMISSIONS.length];
    choose(next);
    options.current[next]?.focus();
  };

  const admitted = openLinks ? admission : "sign_in";
  const requests = door?.requests ?? [];
  const newcomers = handedOut ? (door?.agents ?? []).filter(agent => !handedOut.has(agent.id)) : [];
  return <section className="desktop-cloud-agent-invite" aria-label={t("cloud.share.agent.invite.title")}
    aria-describedby={hintId}>
    {openLinks && <div className="desktop-cloud-agent-options" role="radiogroup" aria-label={t("cloud.share.agent.invite.title")}>
      {ADMISSIONS.map(option => <button key={option} type="button" role="radio"
        ref={element => { options.current[option] = element; }}
        aria-checked={admission === option} tabIndex={admission === option ? 0 : -1}
        data-agent-admission={option} className="desktop-cloud-agent-option"
        onClick={() => choose(option)} onKeyDown={moveChoice}>
        <span className="desktop-cloud-agent-option-mark" aria-hidden="true" />
        <span className="desktop-cloud-agent-option-label">{t(OPTION_TEXT[option].label)}</span>
        <span className="desktop-cloud-agent-option-description">{t(OPTION_TEXT[option].description)}</span>
      </button>)}
    </div>}
    <div className="desktop-cloud-agent-ticket" data-handed-out={handedOut ? "" : undefined} data-admission={admitted}>
      <div className="desktop-cloud-agent-ticket-body">
        <span className="desktop-cloud-agent-ticket-eyebrow">
          {handedOut && <Check size={12} strokeWidth={2.6} aria-hidden="true" />}
          {t(handedOut ? "cloud.share.agent.ticket.handedOut" : "cloud.share.agent.ticket.admit")}
        </span>
        <span className="desktop-cloud-agent-ticket-title" dir="auto">{projectName}</span>
        <span className="desktop-cloud-agent-ticket-meta">
          {t(handedOut ? "cloud.share.agent.invite.pasteNext" : OPTION_TEXT[admitted].label)}
        </span>
        {/* It reads true up to the link, which only copying makes. */}
        {!handedOut && <p className="desktop-cloud-agent-prompt-text" dir="ltr" aria-label={t("cloud.share.agent.invite.preview")}>
          {agentConnectMessage(projectName, `${linkPreview(apiBaseUrl)}${UNMINTED}`)}
        </p>}
        {handedOut && <button ref={again} type="button" className="desktop-cloud-agent-ticket-again"
          data-copied={status === "copied" || undefined} disabled={status === "copying"} onClick={() => void copy()}>
          {status === "copied" && <Check size={12} strokeWidth={2.6} aria-hidden="true" />}
          {t(AGAIN_LABEL[status])}
        </button>}
      </div>
      {/* The stub copies the ticket, and tears off once it has. */}
      <div ref={stub} className="desktop-cloud-agent-ticket-stub" aria-hidden={handedOut ? true : undefined}>
        <Button tone="primary" className="desktop-cloud-agent-share-copy" data-cloud-agent-invite=""
          data-desktop-dialog-initial-focus={(initialFocus && !handedOut) || undefined}
          disabled={status === "copying" || Boolean(handedOut)} onClick={() => void copy()}>
          {t(handedOut ? COPY_LABEL.idle : COPY_LABEL[status])}
        </Button>
        <span className="desktop-cloud-agent-ticket-give">{t("cloud.share.agent.ticket.give")}</span>
      </div>
    </div>
    <AgentDoor waiting={waiting} requests={requests} newcomers={newcomers} session={session} apiBaseUrl={apiBaseUrl}
      onChanged={door?.onChanged} renderAgentMark={renderAgentMark} />
    {/* The ticket and the door are read as pictures, so what to do is also said in words. */}
    <p id={hintId} className="desktop-cloud-share-status">{t("cloud.share.agent.invite.hint")}</p>
    <span className="desktop-cloud-share-status" role="status">
      {announcement({ copied: status === "copied", waiting, request: requests[0], newcomer: newcomers[0], t })}
    </span>
    {status === "failed" && <p role="alert">{t("cloud.share.agent.failed")}</p>}
    {status === "not-owner" && <p role="alert">{t("cloud.share.agent.notOwner")}</p>}
  </section>;
}

/**
 * The door the Agent comes to: whoever asks to come in, to be let in or
 * turned away right here; whoever came in since the ticket was handed out;
 * otherwise nobody, asleep, or awake while an Agent is awaited.
 */
function AgentDoor({ waiting, requests, newcomers, session, apiBaseUrl, onChanged, renderAgentMark }: {
  waiting: boolean;
  requests: readonly AgentRequest[];
  newcomers: readonly WorkspaceAgent[];
  session: DesktopCloudSession;
  apiBaseUrl: string;
  onChanged?: () => void;
  renderAgentMark?: (agent: ShareAgentMark) => ReactNode;
}) {
  const { t } = useLocalization();
  const [failed, setFailed] = useState(false);
  if (requests.length > 0 && onChanged) {
    return <div className="desktop-cloud-agent-door">
      <ul className="desktop-cloud-agent-door-list" aria-label={t("cloud.share.agent.door.knocking")}>
        {requests.map(request => <AgentAtTheDoor key={request.id} request={request} session={session}
          apiBaseUrl={apiBaseUrl} onChanged={onChanged} renderAgentMark={renderAgentMark}
          onDeciding={() => setFailed(false)} onFailed={() => setFailed(true)} />)}
      </ul>
      {failed && <p role="alert">{t("cloud.share.agent.changeFailed")}</p>}
    </div>;
  }
  if (newcomers.length > 0) {
    return <ul className="desktop-cloud-agent-door desktop-cloud-agent-door-list" aria-label={t("cloud.share.agent.connected")}>
      {newcomers.map(agent => <li key={agent.id} className="desktop-cloud-agent-door-row" data-door="joined">
        {agentMark({ id: agent.id, name: agent.name, avatar: agent.avatar, active: true, size: DOOR_MARK_SIZE }, renderAgentMark)}
        <span className="desktop-cloud-agent-door-text">
          <span className="desktop-cloud-agent-name" dir="auto">{agent.name}</span>
          <span className="desktop-cloud-agent-door-state">{t("cloud.share.agent.door.joined")}</span>
        </span>
      </li>)}
    </ul>;
  }
  return <div className="desktop-cloud-agent-door">
    <div className="desktop-cloud-agent-door-row" data-door={waiting ? "waiting" : "empty"}>
      {agentMark({ ...SOMEONE, active: waiting, size: DOOR_MARK_SIZE }, renderAgentMark)}
      <span className="desktop-cloud-agent-door-state">
        {t(waiting ? "cloud.share.agent.invite.waiting" : "cloud.share.agent.door.empty")}
      </span>
    </div>
  </div>;
}

/** An Agent asking to come in: its own mark behind a dashed edge, its name, and the answer. */
function AgentAtTheDoor({ request, session, apiBaseUrl, onChanged, onDeciding, onFailed, renderAgentMark }: {
  request: AgentRequest;
  session: DesktopCloudSession;
  apiBaseUrl: string;
  onChanged: () => void;
  onDeciding: () => void;
  onFailed: () => void;
  renderAgentMark?: (agent: ShareAgentMark) => ReactNode;
}) {
  const { t } = useLocalization();
  const { deciding, answer } = useAgentRequestAnswer({ session, apiBaseUrl, onChanged, onDeciding, onFailed });
  return <li className="desktop-cloud-agent-door-row" data-door="knocking" data-cloud-agent-request={request.id}>
    <span className="desktop-cloud-agent-waiting-mark">
      {agentMark({ id: request.id, name: request.name, avatar: request.avatar, active: false, size: DOOR_MARK_SIZE },
        renderAgentMark)}
    </span>
    <span className="desktop-cloud-agent-door-text">
      <span className="desktop-cloud-agent-name" dir="auto">{request.name}</span>
      <span className="desktop-cloud-agent-door-state">{t("cloud.share.agent.door.knocking")}</span>
    </span>
    <span className="desktop-cloud-agent-request-actions">
      <button type="button" className="desktop-cloud-agent-request-deny" disabled={deciding}
        aria-label={`${t("cloud.share.agent.request.deny")} ${request.name}`} onClick={() => void answer(request.id, "reject")}>
        {t("cloud.share.agent.request.deny")}
      </button>
      <Button tone="primary" className="desktop-cloud-agent-request-allow" disabled={deciding}
        aria-label={`${t("cloud.share.agent.door.letIn")} ${request.name}`} onClick={() => void answer(request.id, "approve")}>
        {t("cloud.share.agent.door.letIn")}
      </Button>
    </span>
  </li>;
}

/** Where the link will point, so the prompt reads true up to the part only copying makes. */
function linkPreview(apiBaseUrl: string) {
  try { return `${new URL(apiBaseUrl).origin}/agent/`; } catch { return ""; }
}

function announcement({ copied, waiting, request, newcomer, t }: {
  copied: boolean;
  waiting: boolean;
  request?: AgentRequest;
  newcomer?: WorkspaceAgent;
  t: (key: string) => string;
}) {
  if (request) return `${request.name}, ${t("cloud.share.agent.door.knocking")}`;
  if (newcomer) return `${newcomer.name}, ${t("cloud.share.agent.door.joined")}`;
  if (copied) return t("cloud.share.agent.copied");
  return waiting ? t("cloud.share.agent.invite.waiting") : "";
}
