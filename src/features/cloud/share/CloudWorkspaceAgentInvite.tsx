import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Check, LoaderCircle, Plus } from "lucide-react";
import { Button } from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization/react";
import { DesktopMenuItem } from "../../../components/DesktopMenu";
import type { DesktopCloudSession } from "../../../lib/cloudApi";
import { writeClipboardText } from "../../../lib/clipboard";
import { agentConnectMessage, createAgentLink, listAgentLinks, type AgentAdmission } from "./agentLinks";

/** Long enough to read, short enough that the button is ready for a second Agent. */
const COPIED_MS = 3_000;
const ADMISSIONS = ["sign_in", "link"] as const;
const COPY_LABEL = {
  idle: "cloud.share.agent.invite.copy",
  copying: "cloud.common.copying",
  copied: "cloud.share.action.copied",
  failed: "cloud.share.agent.invite.copy",
  "not-owner": "cloud.share.agent.invite.copy",
} as const;
const OPTION_TEXT = {
  sign_in: { label: "cloud.share.agent.signIn.label", description: "cloud.share.agent.signIn.description" },
  link: { label: "cloud.share.agent.link.label", description: "cloud.share.agent.link.description" },
} as const;

/**
 * Inviting an Agent: the start of the prompt, the button that copies it, and
 * what to do with it. The link inside is created only by copying, so opening
 * the card mints nothing, and every copy is a new link. Once the card lists
 * Agents, the form waits behind one row until it is asked for.
 */
export function CloudWorkspaceAgentInvite({ projectId, projectName, session, apiBaseUrl, compact = false, waiting = false,
  onInvited }: {
  projectId: string;
  projectName: string;
  session: DesktopCloudSession;
  apiBaseUrl: string;
  /** Agents are already listed above it. */
  compact?: boolean;
  /** An invite is out and no Agent has answered it yet. */
  waiting?: boolean;
  /** The Header waits for the answer, so it hears about an invite at once. */
  onInvited?: () => void;
}) {
  const { t } = useLocalization();
  const [admission, setAdmission] = useState<AgentAdmission>("sign_in");
  const [openLinks, setOpenLinks] = useState(false);
  const [status, setStatus] = useState<keyof typeof COPY_LABEL>("idle");
  const [expanded, setExpanded] = useState(false);
  const form = useRef<HTMLElement>(null);
  const mounted = useRef(true);
  const options = useRef<Partial<Record<AgentAdmission, HTMLButtonElement | null>>>({});
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    void listAgentLinks(session, projectId, apiBaseUrl)
      .then(inventory => { if (mounted.current) setOpenLinks(Boolean(inventory.open_links_enabled)); })
      .catch(() => undefined); // Only the choice depends on it; inviting does not.
  }, [apiBaseUrl, projectId, session]);
  // The row that opened the form is gone, so focus moves on to what it opened.
  useEffect(() => {
    if (expanded) form.current?.querySelector<HTMLButtonElement>("[data-cloud-agent-invite]")?.focus();
  }, [expanded]);
  useEffect(() => {
    if (status !== "copied") return undefined;
    const timer = setTimeout(() => setStatus("idle"), COPIED_MS);
    return () => clearTimeout(timer);
  }, [status]);

  const copy = async () => {
    setStatus("copying");
    try {
      const url = await createAgentLink(session, projectId, openLinks ? admission : "sign_in", apiBaseUrl);
      await writeClipboardText(agentConnectMessage(projectName, url));
      if (!mounted.current) return;
      setStatus("copied");
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

  const copied = status === "copied";
  // A row stands in for the form beside the Agents until it is asked for.
  if (compact && !openLinks && !expanded) {
    return <div className="desktop-cloud-agent-invite" data-compact="">
      <DesktopMenuItem className="desktop-cloud-agents-row-action" role="button" data-cloud-agent-invite-open=""
        icon={<Plus size={15} strokeWidth={1.75} aria-hidden="true" />}
        label={t("cloud.share.agent.invite.another")} onClick={() => setExpanded(true)} />
      {waiting && <p className="desktop-cloud-agent-invite-note" role="status">
        <LoaderCircle className="animate-spin" size={12} strokeWidth={2.2} aria-hidden="true" />
        {t("cloud.share.agent.invite.waiting")}
      </p>}
    </div>;
  }
  return <section ref={form} className="desktop-cloud-agent-invite" aria-label={t("cloud.share.agent.invite.title")}>
    <h3>{t("cloud.share.agent.invite.title")}</h3>
    {/* Enough of the prompt to recognize it; the link is made only by copying, so it fades out first. */}
    <p className="desktop-cloud-agent-prompt" dir="ltr" aria-label={t("cloud.share.agent.invite.preview")}>
      <span>{agentConnectMessage(projectName, linkPreview(apiBaseUrl))}</span>
    </p>
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
    <div className="desktop-cloud-agent-invite-actions">
      <Button tone="primary" className="desktop-cloud-agent-share-copy" data-cloud-agent-invite=""
        disabled={status === "copying"} onClick={() => void copy()}
        leadingIcon={copied ? <Check size={14} aria-hidden="true" /> : undefined}>
        {t(COPY_LABEL[status])}
      </Button>
      {waiting && !copied && <span className="desktop-cloud-agent-invite-note" aria-hidden="true">
        <LoaderCircle className="animate-spin" size={12} strokeWidth={2.2} aria-hidden="true" />
        {t("cloud.share.agent.invite.waiting")}
      </span>}
    </div>
    {/* The step after copying, in sight before it is needed. */}
    <p className="desktop-cloud-agent-invite-hint">{t("cloud.share.agent.invite.hint")}</p>
    <span className="desktop-cloud-share-status" role="status">{announcement(copied, waiting, t)}</span>
    {status === "failed" && <p role="alert">{t("cloud.share.agent.failed")}</p>}
    {status === "not-owner" && <p role="alert">{t("cloud.share.agent.notOwner")}</p>}
  </section>;
}

/** Where the link will point, so the prompt reads true up to the part only copying makes. */
function linkPreview(apiBaseUrl: string) {
  try { return `${new URL(apiBaseUrl).origin}/agent/`; } catch { return ""; }
}

function announcement(copied: boolean, waiting: boolean, t: (key: string) => string) {
  if (copied) return t("cloud.share.agent.copied");
  return waiting ? t("cloud.share.agent.invite.waiting") : "";
}
