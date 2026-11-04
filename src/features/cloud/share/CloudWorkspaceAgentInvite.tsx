import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { Check, Plus } from "lucide-react";
import { AgentBrandImage, Button, Tooltip, getAgentBrand, type AgentBrandId } from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization/react";
import type { DesktopCloudSession } from "../../../lib/cloudApi";
import { writeClipboardText } from "../../../lib/clipboard";
import { agentConnectMessage, createAgentLink } from "./agentLinks";

/**
 * Agents that can follow an invite. It asks the Agent to make its own key and
 * connect, so only Agents that run commands can; a chat in a browser cannot.
 */
export const INVITABLE_AGENTS: readonly AgentBrandId[] = [
  "claude", "codex", "cursor", "gemini", "github-copilot", "opencode", "hermes", "devin",
];

type InviteStatus = "idle" | "copying" | "copied" | "failed" | "not-owner";
export type AgentInvite = Readonly<{
  status: InviteStatus;
  copy: () => Promise<void>;
  /** Folds the steps away; the invite stays copied. */
  dismiss: () => void;
}>;

/**
 * Inviting an Agent: one press makes an invite and copies it. Every press is
 * a new invite, and each lets one Agent in, after the owner allows it. The link
 * inside is made only by pressing, so opening the dialog makes nothing.
 */
export function useAgentInvite({ session, apiBaseUrl, projectId, projectName, onInvited }: {
  session: DesktopCloudSession;
  apiBaseUrl: string;
  projectId: string;
  projectName: string;
  /** The Header waits for the answer, so it hears about an invite at once. */
  onInvited?: () => void;
}): AgentInvite {
  const [status, setStatus] = useState<InviteStatus>("idle");
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const copy = async () => {
    setStatus("copying");
    try {
      const url = await createAgentLink(session, projectId, "sign_in", apiBaseUrl);
      await writeClipboardText(agentConnectMessage(projectName, url));
      if (!mounted.current) return;
      setStatus("copied");
      onInvited?.();
    } catch (error) {
      if (mounted.current) setStatus((error as { status?: number }).status === 403 ? "not-owner" : "failed");
    }
  };
  const dismiss = useCallback(() => setStatus(current => current === "copied" ? "idle" : current), []);
  return { status, copy, dismiss };
}

/** The empty seat at the end of the row: the same + as the Header's, and pressing it invites. */
export function AgentInviteSeat({ invite, seatRef }: { invite: AgentInvite; seatRef: RefObject<HTMLButtonElement> }) {
  const { t } = useLocalization();
  const copied = invite.status === "copied";
  return <li className="desktop-cloud-agent-tile desktop-cloud-agent-invite-seat" data-copied={copied || undefined}>
    <button ref={seatRef} type="button" className="desktop-cloud-agent-seat-button" data-cloud-agent-invite=""
      disabled={invite.status === "copying"} aria-expanded={copied} onClick={() => void invite.copy()}>
      <span className="desktop-cloud-agent-seat" aria-hidden="true">
        {copied ? <Check size={18} strokeWidth={2.2} /> : <Plus size={20} strokeWidth={1.75} />}
      </span>
      <span className="desktop-cloud-agent-name">{t(copied ? "cloud.share.action.copied" : "cloud.share.agent.invite.seat")}</span>
    </button>
  </li>;
}

/** With nobody here yet, the seat is the whole page, with one line on what it does. */
export function AgentFirstInvite({ invite, seatRef }: { invite: AgentInvite; seatRef: RefObject<HTMLButtonElement> }) {
  const { t } = useLocalization();
  const copied = invite.status === "copied";
  const label = t(copied ? "cloud.share.action.copied" : "cloud.share.agent.invite.copyInvite");
  return <div className="desktop-cloud-agents-first" data-copied={copied || undefined}>
    <button ref={seatRef} type="button" tabIndex={-1} className="desktop-cloud-agent-seat desktop-cloud-agent-seat-large"
      aria-label={label} disabled={invite.status === "copying"} onClick={() => void invite.copy()}>
      {copied ? <Check size={24} strokeWidth={2.2} aria-hidden="true" /> : <Plus size={28} strokeWidth={1.5} aria-hidden="true" />}
    </button>
    <div className="desktop-cloud-agents-first-text">
      <h3>{t("cloud.share.agent.invite.first")}</h3>
      <p>{t("cloud.share.agent.invite.firstDescription")}</p>
      <Button tone="primary" className="desktop-cloud-agent-share-copy" data-cloud-agent-invite=""
        data-desktop-dialog-initial-focus="true" data-copied={copied || undefined} disabled={invite.status === "copying"}
        leadingIcon={copied ? <Check size={14} strokeWidth={2.4} aria-hidden="true" /> : undefined}
        onClick={() => void invite.copy()}>
        {label}
      </Button>
    </div>
  </div>;
}

/**
 * What happens after pressing the seat, in three lines and nothing else: it
 * is copied, paste it to your agent (these are the ones that can come), and
 * it asks to join here for you to allow.
 */
export function AgentInviteSteps({ stepsRef, arrowX }: {
  stepsRef: RefObject<HTMLDivElement>;
  /** Where the seat is, so the steps point at what was pressed. */
  arrowX: number | null;
}) {
  const { t } = useLocalization();
  const steps = ["cloud.share.agent.invite.step.copied", "cloud.share.agent.invite.step.paste", "cloud.share.agent.invite.step.allow"];
  return <div ref={stepsRef} className="desktop-cloud-agent-invite-steps"
    style={arrowX === null ? undefined : { "--invite-arrow-x": `${arrowX}px` } as CSSProperties}>
    <ol>
      {steps.map((step, index) => <li key={step} data-invite-step={index + 1}>
        <span className="desktop-cloud-agent-invite-step-number" aria-hidden="true">
          {index === 0 ? <Check size={12} strokeWidth={2.6} /> : index + 1}
        </span>
        <span className="desktop-cloud-agent-invite-step-text">
          {t(step)}
          {index === 1 && <span className="desktop-cloud-agent-invite-logos">
            {INVITABLE_AGENTS.map(id => <Tooltip key={id} content={getAgentBrand(id)?.displayName}>
              <span className="desktop-cloud-agent-invite-logo" data-agent-brand={id}>
                <AgentBrandImage brandId={id} />
              </span>
            </Tooltip>)}
          </span>}
        </span>
      </li>)}
    </ol>
  </div>;
}

/**
 * The invite's alerts and its one announcement, shared by the seat and the
 * first invite. The steps are read as a picture, so copying is said in words.
 */
export function AgentInviteStatus({ invite }: { invite: AgentInvite }) {
  const { t } = useLocalization();
  return <>
    <span className="desktop-cloud-share-status" role="status">{invite.status === "copied" ? t("cloud.share.agent.copied") : ""}</span>
    {invite.status === "failed" && <p role="alert">{t("cloud.share.agent.failed")}</p>}
    {invite.status === "not-owner" && <p role="alert">{t("cloud.share.agent.notOwner")}</p>}
  </>;
}
