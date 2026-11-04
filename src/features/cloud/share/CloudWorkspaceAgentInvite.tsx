import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Check, LoaderCircle } from "lucide-react";
import { Button } from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization/react";
import type { DesktopCloudSession } from "../../../lib/cloudApi";
import { writeClipboardText } from "../../../lib/clipboard";
import { agentConnectMessage, createAgentLink, listAgentLinks, type AgentAdmission } from "./agentLinks";
import { CloudWorkspaceAgentInviteDemo } from "./CloudWorkspaceAgentInviteDemo";
import type { ShareAgentMark } from "./CloudWorkspaceAgentsPanel";

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
 * Inviting an Agent: the prompt itself, under a veil with the button that
 * copies it, and what to do with it; for a first Agent, a short loop under it
 * shows how it goes. The link inside is created only by copying, so opening the
 * form mints nothing, and every copy is a new link. The first invite is the
 * Agents card itself; inviting another is its own dialog.
 */
export function CloudWorkspaceAgentInvite({ projectId, projectName, session, apiBaseUrl, another = false,
  initialFocus = false, waiting = false, onInvited, renderAgentMark }: {
  projectId: string;
  projectName: string;
  session: DesktopCloudSession;
  apiBaseUrl: string;
  /** Agents are already here, so the steps are read rather than shown. */
  another?: boolean;
  /** Where a dialog puts focus first: the one thing to do. */
  initialFocus?: boolean;
  /** An invite is out and no Agent has answered it yet. */
  waiting?: boolean;
  /** The Header waits for the answer, so it hears about an invite at once. */
  onInvited?: () => void;
  /** The shell's Agent marks, so the demonstration shows Agents as the Header does. */
  renderAgentMark?: (agent: ShareAgentMark) => ReactNode;
}) {
  const { t } = useLocalization();
  const [admission, setAdmission] = useState<AgentAdmission>("sign_in");
  const [openLinks, setOpenLinks] = useState(false);
  const [status, setStatus] = useState<keyof typeof COPY_LABEL>("idle");
  const mounted = useRef(true);
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
  const prompt = agentConnectMessage(projectName, linkPreview(apiBaseUrl));
  // The illustration shows the steps to a first-timer; someone inviting another reads them.
  const demo = !another;
  return <section className="desktop-cloud-agent-invite" data-another={another || undefined}
    aria-label={t("cloud.share.agent.invite.title")}>
    <h3>{t("cloud.share.agent.invite.lead")}</h3>
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
    {/* The words show it is a prompt; the veil and the button on it say it is copied, not read. */}
    <div className="desktop-cloud-agent-prompt" data-copied={copied || undefined}>
      <p className="desktop-cloud-agent-prompt-text" dir="ltr" aria-label={t("cloud.share.agent.invite.preview")}>{prompt}</p>
      <span className="desktop-cloud-agent-prompt-veil" aria-hidden="true" />
      <Button tone="primary" className="desktop-cloud-agent-share-copy" data-cloud-agent-invite=""
        data-desktop-dialog-initial-focus={initialFocus || undefined} data-copied={copied || undefined} disabled={status === "copying"} onClick={() => void copy()}
        leadingIcon={copied ? <Check size={14} strokeWidth={2.4} aria-hidden="true" /> : undefined}>
        {t(COPY_LABEL[status])}
      </Button>
    </div>
    {/* Right after copying, what to do with it; until an Agent answers, that it is awaited. */}
    {copied && <p className="desktop-cloud-agent-invite-note" data-tone="done" aria-hidden="true">
      <Check size={12} strokeWidth={2.4} aria-hidden="true" />
      {t("cloud.share.agent.invite.pasteNext")}
    </p>}
    {waiting && !copied && <p className="desktop-cloud-agent-invite-note" aria-hidden="true">
      <LoaderCircle className="animate-spin" size={12} strokeWidth={2.2} aria-hidden="true" />
      {t("cloud.share.agent.invite.waiting")}
    </p>}
    {demo
      ? <CloudWorkspaceAgentInviteDemo projectName={projectName} linkPreview={linkPreview(apiBaseUrl)}
        renderAgentMark={renderAgentMark} />
      : <p className="desktop-cloud-agent-invite-hint">{t("cloud.share.agent.invite.hint")}</p>}
    {/* The illustration is not read aloud, so its steps are said in words. */}
    {demo && <p className="desktop-cloud-share-status">{t("cloud.share.agent.invite.hint")}</p>}
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
