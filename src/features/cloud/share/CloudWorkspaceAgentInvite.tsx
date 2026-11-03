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
const OPTION_TEXT = {
  sign_in: { label: "cloud.share.agent.signIn.label", description: "cloud.share.agent.signIn.description" },
  link: { label: "cloud.share.agent.link.label", description: "cloud.share.agent.link.description" },
} as const;

/**
 * Inviting an Agent: one button that copies a line to paste into it. The link
 * inside is created only by copying, so opening the card mints nothing, and
 * every copy is a new link. Once the card lists Agents, inviting another is a
 * row among them rather than an introduction.
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
  const [status, setStatus] = useState<"idle" | "copying" | "copied" | "failed" | "not-owner">("idle");
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
  const row = compact && !openLinks;
  // What happens next is one line under the button: paste it, then wait for the Agent.
  // A row already says it was copied in its own words, so it only adds the wait.
  const note = inviteNote(copied, waiting, row);
  // A screen reader hears that it was copied even where the row says so instead of the note.
  const announced = copied ? "cloud.share.agent.copied" : note;
  const after = <>
    {note && <p className="desktop-cloud-agent-invite-note" aria-hidden="true">
      {!copied && <LoaderCircle className="animate-spin" size={12} strokeWidth={2.2} aria-hidden="true" />}
      {t(note)}
    </p>}
    <span className="desktop-cloud-share-status" role="status">{announced ? t(announced) : ""}</span>
    {status === "failed" && <p role="alert">{t("cloud.share.agent.failed")}</p>}
    {status === "not-owner" && <p role="alert">{t("cloud.share.agent.notOwner")}</p>}
  </>;

  // Who gets in is only a question where a deployment allows open links, so it keeps the full form.
  if (row) {
    return <div className="desktop-cloud-agent-invite" data-compact="">
      <DesktopMenuItem className="desktop-cloud-agents-row-action" role="button" data-cloud-agent-invite=""
        disabled={status === "copying"}
        icon={copied ? <Check size={15} strokeWidth={1.75} aria-hidden="true" /> : <Plus size={15} strokeWidth={1.75} aria-hidden="true" />}
        label={t(copied ? "cloud.share.agent.copied" : "cloud.share.agent.invite.another")}
        onClick={() => void copy()} />
      {after}
    </div>;
  }
  return <section className="desktop-cloud-agent-invite" aria-label={t("cloud.share.agent.invite.title")}>
    <div className="desktop-cloud-share-heading">
      <h3>{t("cloud.share.agent.invite.title")}</h3>
      <p>{t("cloud.share.agent.invite.description")}</p>
    </div>
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
    <Button tone="primary" className="desktop-cloud-agent-share-copy" data-cloud-agent-invite=""
      disabled={status === "copying"} onClick={() => void copy()}>
      {/* The line under it says what was copied and what to do, so the button keeps its word and width. */}
      {t(status === "copying" ? "cloud.common.copying" : "cloud.share.agent.invite.copy")}
    </Button>
    {after}
  </section>;
}

function inviteNote(copied: boolean, waiting: boolean, row: boolean) {
  if (copied) return row ? null : "cloud.share.agent.copied";
  return waiting ? "cloud.share.agent.invite.waiting" : null;
}
