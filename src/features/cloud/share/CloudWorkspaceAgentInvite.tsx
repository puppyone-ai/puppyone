import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { Check, Plus } from "lucide-react";
import { AgentBrandImage, Button, Tooltip, getAgentBrand, type AgentBrandId } from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization/react";
import type { DesktopCloudSession } from "../../../lib/cloudApi";
import { writeClipboardText } from "../../../lib/clipboard";
import { useDesktopPlatformCapabilities } from "../../../platform";
import { agentConnectMessage, createAgentLink } from "./agentLinks";
import { agentMark, type ShareAgentMark } from "./agentMark";

/**
 * Agents that can follow an invite. It asks the Agent to make its own key and
 * connect, so only Agents that run commands can; a chat in a browser cannot.
 */
export const INVITABLE_AGENTS: readonly AgentBrandId[] = [
  "claude", "codex", "cursor", "gemini", "github-copilot", "opencode", "hermes", "devin",
];

type InviteStatus = "idle" | "copying" | "copied" | "failed" | "not-owner";
/** How much of an invite's secret is shown; the rest is masked, as it is the key to the project. */
const SHOWN_SECRET = 8;
export type AgentInvite = Readonly<{
  status: InviteStatus;
  /** What was copied, as shown: the invite's secret masked past its start. */
  prompt: string | null;
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
  const [prompt, setPrompt] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const copy = async () => {
    setStatus("copying");
    try {
      const url = await createAgentLink(session, projectId, "sign_in", apiBaseUrl);
      await writeClipboardText(agentConnectMessage(projectName, url));
      if (!mounted.current) return;
      setPrompt(agentConnectMessage(projectName, maskSecret(url)));
      setStatus("copied");
      onInvited?.();
    } catch (error) {
      if (mounted.current) setStatus((error as { status?: number }).status === 403 ? "not-owner" : "failed");
    }
  };
  const dismiss = useCallback(() => setStatus(current => current === "copied" ? "idle" : current), []);
  return { status, prompt, copy, dismiss };
}

/** The link as shown: its last segment, the secret, keeps only its start. */
function maskSecret(url: string) {
  const cut = url.lastIndexOf("/") + 1;
  const secret = url.slice(cut);
  return secret.length > SHOWN_SECRET ? `${url.slice(0, cut)}${secret.slice(0, SHOWN_SECRET)}••••••` : url;
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
 * What happens after pressing the seat, in three steps, each with what it
 * means right under it: the prompt that was copied, as it reads; a short scene
 * of it pasted into an agent's chat and the agent asking to join, with the
 * agents that can come; and allowing it here.
 */
export function AgentInviteSteps({ stepsRef, arrowX, prompt, projectName, renderAgentMark }: {
  stepsRef: RefObject<HTMLDivElement>;
  /** Where the seat is, so the steps point at what was pressed. */
  arrowX: number | null;
  prompt: string | null;
  projectName: string;
  renderAgentMark?: (agent: ShareAgentMark) => ReactNode;
}) {
  const { t } = useLocalization();
  return <div ref={stepsRef} className="desktop-cloud-agent-invite-steps"
    style={arrowX === null ? undefined : { "--invite-arrow-x": `${arrowX}px` } as CSSProperties}>
    <ol>
      <li data-invite-step={1}>
        <span className="desktop-cloud-agent-invite-step-number" aria-hidden="true"><Check size={12} strokeWidth={2.6} /></span>
        <span className="desktop-cloud-agent-invite-step-text">
          {t("cloud.share.agent.invite.step.copied")}
          {prompt && <span className="desktop-cloud-agent-invite-prompt" dir="ltr">{prompt}</span>}
        </span>
      </li>
      <li data-invite-step={2}>
        <span className="desktop-cloud-agent-invite-step-number" aria-hidden="true">{2}</span>
        <span className="desktop-cloud-agent-invite-step-text">
          {t("cloud.share.agent.invite.step.paste")}
          <AgentPasteScene projectName={projectName} prompt={prompt} renderAgentMark={renderAgentMark} />
          <span className="desktop-cloud-agent-invite-logos">
            {INVITABLE_AGENTS.map(id => <Tooltip key={id} content={getAgentBrand(id)?.displayName}>
              <span className="desktop-cloud-agent-invite-logo" data-agent-brand={id}>
                <AgentBrandImage brandId={id} />
              </span>
            </Tooltip>)}
          </span>
        </span>
      </li>
      <li data-invite-step={3}>
        <span className="desktop-cloud-agent-invite-step-number" aria-hidden="true">{3}</span>
        <span className="desktop-cloud-agent-invite-step-text">{t("cloud.share.agent.invite.step.allow")}</span>
      </li>
    </ol>
  </div>;
}

/**
 * Pasting, shown once rather than told: in an agent's chat the prompt is
 * pasted, sent, and the agent answers that it asked to join. It plays as the
 * steps appear and rests on its last frame; it is a picture, not read aloud.
 */
function AgentPasteScene({ projectName, prompt, renderAgentMark }: {
  projectName: string;
  prompt: string | null;
  renderAgentMark?: (agent: ShareAgentMark) => ReactNode;
}) {
  const { t } = useLocalization();
  const platform = useDesktopPlatformCapabilities();
  return <span className="desktop-cloud-agent-paste-scene" aria-hidden="true">
    <span className="desktop-cloud-agent-paste-thread">
      <span className="desktop-cloud-agent-paste-sent" dir="ltr">{prompt}</span>
      <span className="desktop-cloud-agent-paste-reply">
        {/* An agent of no brand: the one the person uses, whichever it is. Its name only picks a calm colour. */}
        {agentMark({ id: "scene-agent", name: "scene-agent", avatar: "other", active: true, size: 20 }, renderAgentMark)}
        <span className="desktop-cloud-agent-paste-bubble">
          <span className="desktop-cloud-agent-paste-dots"><i /><i /><i /></span>
          <span className="desktop-cloud-agent-paste-asked">
            <Check size={11} strokeWidth={2.6} />
            {t("cloud.share.agent.invite.scene.asked", { project: projectName })}
          </span>
        </span>
      </span>
    </span>
    <span className="desktop-cloud-agent-paste-input">
      <span className="desktop-cloud-agent-paste-placeholder">{t("cloud.share.agent.invite.scene.message")}</span>
      <span className="desktop-cloud-agent-paste-typed" dir="ltr">{prompt}</span>
      <kbd className="desktop-cloud-agent-paste-key">{t(platform?.platform === "macos" ? "cloud.share.agent.invite.scene.pasteMac" : "cloud.share.agent.invite.scene.pasteOther")}</kbd>
    </span>
  </span>;
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
