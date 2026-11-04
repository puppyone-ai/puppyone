import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Check } from "lucide-react";
import { Button } from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization/react";
import type { DesktopCloudSession } from "../../../lib/cloudApi";
import { writeClipboardText } from "../../../lib/clipboard";
import { agentConnectMessage, createAgentLink, listAgentLinks, type AgentAdmission } from "./agentLinks";

/** Long enough to read, short enough that the button is ready for a second Agent. */
const COPIED_MS = 3_000;
const ADMISSIONS = ["sign_in", "link"] as const;
/** The part of the link only copying makes, shown as what it is: not there yet. */
const UNMINTED = "••••••";
type CopyStatus = "idle" | "copying" | "copied" | "failed" | "not-owner";
const COPY_LABEL: Record<CopyStatus, string> = {
  idle: "cloud.share.agent.invite.copy",
  copying: "cloud.common.copying",
  copied: "cloud.share.action.copied",
  failed: "cloud.share.agent.invite.copy",
  "not-owner": "cloud.share.agent.invite.copy",
};
const OPTION_TEXT = {
  sign_in: { label: "cloud.share.agent.signIn.label", description: "cloud.share.agent.signIn.description" },
  link: { label: "cloud.share.agent.link.label", description: "cloud.share.agent.link.description" },
} as const;

/**
 * Inviting an Agent, said once and kept quiet: one sentence, the prompt it
 * names, and the button on the prompt that copies it. Nothing waits here for
 * the Agent; when it asks to join or comes in, it is among the Agents above.
 * The link inside is created only by copying, so opening this mints nothing,
 * and every copy is a new link.
 */
export function CloudWorkspaceAgentInvite({ projectId, projectName, session, apiBaseUrl, initialFocus = false, onInvited }: {
  projectId: string;
  projectName: string;
  session: DesktopCloudSession;
  apiBaseUrl: string;
  /** Where a dialog puts focus first: the one thing to do. */
  initialFocus?: boolean;
  /** The Header waits for the answer, so it hears about an invite at once. */
  onInvited?: () => void;
}) {
  const { t } = useLocalization();
  const [admission, setAdmission] = useState<AgentAdmission>("sign_in");
  const [openLinks, setOpenLinks] = useState(false);
  const [status, setStatus] = useState<CopyStatus>("idle");
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
  return <section className="desktop-cloud-agent-invite" aria-label={t("cloud.share.agent.invite.title")}>
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
    {/* The words show it is a prompt; the button on it says it is copied, not read. */}
    <div className="desktop-cloud-agent-prompt" data-copied={copied || undefined}>
      <p className="desktop-cloud-agent-prompt-text" dir="ltr" aria-label={t("cloud.share.agent.invite.preview")}>
        {agentConnectMessage(projectName, `${linkPreview(apiBaseUrl)}${UNMINTED}`)}
      </p>
      <span className="desktop-cloud-agent-prompt-veil" aria-hidden="true" />
      <Button tone="primary" className="desktop-cloud-agent-share-copy" data-cloud-agent-invite=""
        data-desktop-dialog-initial-focus={initialFocus || undefined} data-copied={copied || undefined}
        disabled={status === "copying"} onClick={() => void copy()}
        leadingIcon={copied ? <Check size={14} strokeWidth={2.4} aria-hidden="true" /> : undefined}>
        {t(COPY_LABEL[status])}
      </Button>
    </div>
    <span className="desktop-cloud-share-status" role="status">{copied ? t("cloud.share.agent.copied") : ""}</span>
    {status === "failed" && <p role="alert">{t("cloud.share.agent.failed")}</p>}
    {status === "not-owner" && <p role="alert">{t("cloud.share.agent.notOwner")}</p>}
  </section>;
}

/** Where the link will point, so the prompt reads true up to the part only copying makes. */
function linkPreview(apiBaseUrl: string) {
  try { return `${new URL(apiBaseUrl).origin}/agent/`; } catch { return ""; }
}
