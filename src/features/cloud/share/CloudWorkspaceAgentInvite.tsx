import { useCallback, useEffect, useRef, useState, type AnimationEvent, type CSSProperties, type RefObject } from "react";
import { Check, Copy, Plus } from "lucide-react";
import { AgentBrandImage, Button, Tooltip, getAgentBrand, type AgentBrandId } from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization/react";
import type { DesktopCloudSession } from "../../../lib/cloudApi";
import { writeClipboardText } from "../../../lib/clipboard";
import { useDesktopPlatformCapabilities } from "../../../platform";
import { agentConnectMessage, createAgentLink } from "./agentLinks";

/**
 * Agents that can follow an invite. It asks the Agent to make its own key and
 * connect, so only Agents that run commands can; a chat in a browser cannot.
 */
export const INVITABLE_AGENTS: readonly AgentBrandId[] = [
  "claude", "codex", "cursor", "gemini", "github-copilot", "opencode", "hermes", "devin",
];
/** The agents the drawing shows in turn, one on each pass. */
const DRAWN_AGENTS: readonly AgentBrandId[] = ["claude", "codex", "cursor", "gemini"];
/** How much of an invite's secret is shown; the rest is masked, as it is the key to the project. */
const SHOWN_SECRET = 8;
/** The part of the link only copying makes, shown as what it is: not made yet. */
const UNMADE = "••••••";

type CopyStatus = "idle" | "copying" | "copied" | "failed" | "not-owner";
const COPY_LABEL: Record<CopyStatus, string> = {
  idle: "cloud.share.action.copy",
  copying: "cloud.common.copying",
  copied: "cloud.share.action.copied",
  failed: "cloud.share.action.copy",
  "not-owner": "cloud.share.action.copy",
};

export type AgentInvite = Readonly<{
  /** The steps are showing under the seat. */
  open: boolean;
  status: CopyStatus;
  /** The prompt as shown: the link not made yet, then the one made, its secret masked past its start. */
  prompt: string;
  toggle: () => void;
  close: () => void;
  copy: () => Promise<void>;
}>;

/**
 * Inviting an Agent. The seat only shows what to copy; nothing is made until
 * the person presses Copy, and every press makes a new invite, each letting
 * one Agent in after the owner allows it.
 */
export function useAgentInvite({ session, apiBaseUrl, projectId, projectName, openFirst, onInvited }: {
  session: DesktopCloudSession;
  apiBaseUrl: string;
  projectId: string;
  projectName: string;
  /** Nobody is here yet, so inviting is open from the start. */
  openFirst: boolean;
  /** The Header waits for the answer, so it hears about an invite at once. */
  onInvited?: () => void;
}): AgentInvite {
  const [open, setOpen] = useState(openFirst);
  const [status, setStatus] = useState<CopyStatus>("idle");
  const [made, setMade] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const copy = async () => {
    setStatus("copying");
    try {
      const url = await createAgentLink(session, projectId, "sign_in", apiBaseUrl);
      await writeClipboardText(agentConnectMessage(projectName, url));
      if (!mounted.current) return;
      setMade(maskSecret(url));
      setStatus("copied");
      onInvited?.();
    } catch (error) {
      if (mounted.current) setStatus((error as { status?: number }).status === 403 ? "not-owner" : "failed");
    }
  };
  // Opened again, the steps start over from what to copy.
  const close = useCallback(() => {
    setOpen(false);
    setStatus(current => current === "copying" ? current : "idle");
    setMade(null);
  }, []);
  const toggle = () => { if (open) close(); else setOpen(true); };
  const prompt = agentConnectMessage(projectName, made ?? `${linkPreview(apiBaseUrl)}${UNMADE}`);
  return { open, status, prompt, toggle, close, copy };
}

/** The empty seat at the end of the row: the same + as the Header's, and pressing it shows how to invite. */
export function AgentInviteSeat({ invite, seatRef }: { invite: AgentInvite; seatRef: RefObject<HTMLButtonElement> }) {
  const { t } = useLocalization();
  return <li className="desktop-cloud-agent-tile desktop-cloud-agent-invite-seat" data-open={invite.open || undefined}>
    <button ref={seatRef} type="button" className="desktop-cloud-agent-seat-button" data-cloud-agent-invite-seat=""
      aria-expanded={invite.open} onClick={invite.toggle}>
      <span className="desktop-cloud-agent-seat" aria-hidden="true"><Plus size={20} strokeWidth={1.75} /></span>
      <span className="desktop-cloud-agent-name">{t("cloud.share.agent.invite.seat")}</span>
    </button>
  </li>;
}

/** With nobody here yet, the seat is the whole page, with one line on what it does. */
export function AgentFirstInvite({ invite, seatRef }: { invite: AgentInvite; seatRef: RefObject<HTMLButtonElement> }) {
  const { t } = useLocalization();
  return <div className="desktop-cloud-agents-first">
    <button ref={seatRef} type="button" className="desktop-cloud-agent-seat desktop-cloud-agent-seat-large"
      data-cloud-agent-invite-seat="" aria-label={t("cloud.share.agent.invite.seat")} aria-expanded={invite.open}
      onClick={invite.toggle}>
      <Plus size={28} strokeWidth={1.5} aria-hidden="true" />
    </button>
    <div className="desktop-cloud-agents-first-text">
      <h3>{t("cloud.share.agent.invite.first")}</h3>
      <p>{t("cloud.share.agent.invite.firstDescription")}</p>
    </div>
  </div>;
}

/**
 * How to invite, one step at a time. First only the prompt and the button that
 * copies it; once it is copied, the one thing left to do in one sentence, with
 * a drawing of it beside it that plays like a GIF and asks for nothing.
 */
export function AgentInviteSteps({ invite, stepsRef, arrowX, firstFocus }: {
  invite: AgentInvite;
  stepsRef: RefObject<HTMLDivElement>;
  /** Where the seat is, so the steps point at what was pressed. */
  arrowX: number | null;
  /** The dialog opened on these steps, so its own first focus is Copy. */
  firstFocus: boolean;
}) {
  const { t } = useLocalization();
  const copied = invite.status === "copied";
  // Opened from the seat, Copy is the next thing to press.
  useEffect(() => {
    if (!firstFocus) stepsRef.current?.querySelector<HTMLButtonElement>(".desktop-cloud-agent-share-copy")?.focus();
  }, [firstFocus, stepsRef]);
  return <div ref={stepsRef} className="desktop-cloud-agent-invite-steps"
    style={arrowX === null ? undefined : { "--invite-arrow-x": `${arrowX}px` } as CSSProperties}>
    <ol>
      <li data-invite-step={1} data-done={copied || undefined}>
        <span className="desktop-cloud-agent-invite-step-number" aria-hidden="true">
          {copied ? <Check size={12} strokeWidth={2.6} /> : 1}
        </span>
        <span className="desktop-cloud-agent-invite-step-text">
          {t("cloud.share.agent.invite.step.copy")}
          <span className="desktop-cloud-agent-invite-prompt-box">
            <span className="desktop-cloud-agent-invite-prompt" dir="ltr">{invite.prompt}</span>
            <Button tone="primary" className="desktop-cloud-agent-share-copy" data-copied={copied || undefined}
              data-desktop-dialog-initial-focus={firstFocus ? "true" : undefined} disabled={invite.status === "copying"}
              leadingIcon={copied
                ? <Check size={14} strokeWidth={2.4} aria-hidden="true" />
                : <Copy size={13} strokeWidth={2} aria-hidden="true" />}
              onClick={() => void invite.copy()}>
              {t(COPY_LABEL[invite.status])}
            </Button>
          </span>
        </span>
      </li>
      {copied && <li data-invite-step={2}>
        <span className="desktop-cloud-agent-invite-step-number" aria-hidden="true">{2}</span>
        <span className="desktop-cloud-agent-invite-step-paste">
          <span className="desktop-cloud-agent-invite-step-text">
            {t("cloud.share.agent.invite.step.paste")}
            <span className="desktop-cloud-agent-invite-logos">
              {INVITABLE_AGENTS.map(id => <Tooltip key={id} content={getAgentBrand(id)?.displayName}>
                <span className="desktop-cloud-agent-invite-logo" data-agent-brand={id}>
                  <AgentBrandImage brandId={id} />
                </span>
              </Tooltip>)}
            </span>
          </span>
          <AgentPasteDrawing />
        </span>
      </li>}
    </ol>
  </div>;
}

/**
 * Pasting, drawn rather than built: a copied prompt drops into an agent's chat
 * with the paste keys, becomes its message, and the agent answers with a tick.
 * Nothing in it is a control or a word to read, so it cannot be mistaken for
 * something to press; it loops like a GIF, showing another agent each pass,
 * and anyone who asked for less motion sees only the answered chat.
 */
function AgentPasteDrawing() {
  const { t } = useLocalization();
  const platform = useDesktopPlatformCapabilities();
  const [pass, setPass] = useState(0);
  const agent = DRAWN_AGENTS[pass % DRAWN_AGENTS.length];
  // Every part runs on the drawing's clock, so its own pass is the one that counts.
  const next = (event: AnimationEvent<HTMLElement>) => {
    if (event.target === event.currentTarget) setPass(current => current + 1);
  };
  return <span className="desktop-cloud-agent-paste-art" aria-hidden="true" data-drawn-agent={agent}
    onAnimationIteration={next}>
    <span className="desktop-cloud-agent-paste-card">
      <span className="desktop-cloud-agent-paste-head">
        <span className="desktop-cloud-agent-paste-avatar"><AgentBrandImage brandId={agent} /></span>
        <span className="desktop-cloud-agent-paste-line" data-length="short" />
      </span>
      <span className="desktop-cloud-agent-paste-out">
        <span className="desktop-cloud-agent-paste-line" />
        <span className="desktop-cloud-agent-paste-line" data-length="short" />
      </span>
      <span className="desktop-cloud-agent-paste-in">
        <span className="desktop-cloud-agent-paste-dots"><i /><i /><i /></span>
        <span className="desktop-cloud-agent-paste-tick"><Check size={12} strokeWidth={3} /></span>
      </span>
    </span>
    <span className="desktop-cloud-agent-paste-sheet">
      <span className="desktop-cloud-agent-paste-line" />
      <span className="desktop-cloud-agent-paste-line" />
      <span className="desktop-cloud-agent-paste-line" data-length="short" />
    </span>
    <kbd className="desktop-cloud-agent-paste-key">
      {t(platform?.platform === "macos" ? "cloud.share.agent.invite.scene.pasteMac" : "cloud.share.agent.invite.scene.pasteOther")}
    </kbd>
  </span>;
}

/**
 * The invite's alerts and its one announcement. The drawing is a picture, so
 * what to do after copying is said in words.
 */
export function AgentInviteStatus({ invite }: { invite: AgentInvite }) {
  const { t } = useLocalization();
  return <>
    <span className="desktop-cloud-share-status" role="status">
      {invite.status === "copied" ? t("cloud.share.agent.invite.step.paste") : ""}
    </span>
    {invite.status === "failed" && <p role="alert">{t("cloud.share.agent.failed")}</p>}
    {invite.status === "not-owner" && <p role="alert">{t("cloud.share.agent.notOwner")}</p>}
  </>;
}

/** The link as shown: its last segment, the secret, keeps only its start. */
function maskSecret(url: string) {
  const cut = url.lastIndexOf("/") + 1;
  const secret = url.slice(cut);
  return secret.length > SHOWN_SECRET ? `${url.slice(0, cut)}${secret.slice(0, SHOWN_SECRET)}${UNMADE}` : url;
}

/** Where the link will point, so the prompt reads true up to the part only copying makes. */
function linkPreview(apiBaseUrl: string) {
  try { return `${new URL(apiBaseUrl).origin}/agent/`; } catch { return ""; }
}
