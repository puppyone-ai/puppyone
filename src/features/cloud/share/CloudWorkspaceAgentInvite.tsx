import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Check } from "lucide-react";
import { Button } from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization/react";
import type { DesktopCloudSession } from "../../../lib/cloudApi";
import { writeClipboardText } from "../../../lib/clipboard";
import { AGENT_LINK_PLACEHOLDER, agentConnectMessage, createAgentLink, listAgentLinks, type AgentAdmission } from "./agentLinks";

/** Long enough to read, short enough that the button is ready for a second Agent. */
const COPIED_MS = 3_000;
const ADMISSIONS = ["sign_in", "link"] as const;
const OPTION_TEXT = {
  sign_in: { label: "cloud.share.agent.signIn.label", description: "cloud.share.agent.signIn.description" },
  link: { label: "cloud.share.agent.link.label", description: "cloud.share.agent.link.description" },
} as const;
const COPY_LABEL = {
  idle: "cloud.share.agent.prompt.copy",
  copying: "cloud.common.copying",
  copied: "cloud.share.action.copied",
  failed: "cloud.share.agent.prompt.copy",
  "not-owner": "cloud.share.agent.prompt.copy",
} as const;

/**
 * Sharing with an Agent: the prompt itself, in plain sight, and the button that
 * copies it. The link inside is created only by copying, so opening Share mints
 * nothing, and every copy is a new link.
 */
export function CloudWorkspaceAgentInvite({ projectId, projectName, session, apiBaseUrl, onChanged }: {
  projectId: string;
  projectName: string;
  session: DesktopCloudSession;
  apiBaseUrl: string;
  /** The Header states who is here, so it hears about a change at once rather than on its next poll. */
  onChanged?: () => void;
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
      onChanged?.();
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

  return <section className="desktop-cloud-agent-invite" aria-label={t("cloud.share.agent.title")}>
    <div className="desktop-cloud-share-heading">
      <h3>{t("cloud.share.agent.title")}</h3>
      <p>{t("cloud.share.agent.prompt.hint")}</p>
    </div>
    <p className="desktop-cloud-agent-prompt" dir="ltr" aria-label={t("cloud.share.agent.prompt.label")}>
      {agentConnectMessage(projectName, AGENT_LINK_PLACEHOLDER)}
    </p>
    {/* Who gets in is only a question where a deployment allows open links. */}
    {openLinks && <div className="desktop-cloud-agent-options" role="radiogroup" aria-label={t("cloud.share.agent.title")}>
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
    <Button tone="primary" className="desktop-cloud-agent-share-copy" disabled={status === "copying"}
      leadingIcon={status === "copied" ? <Check size={14} aria-hidden="true" /> : undefined}
      onClick={() => void copy()}>
      {t(COPY_LABEL[status])}
    </Button>
    <span className="desktop-cloud-share-status" role="status">{status === "copied" ? t("cloud.share.agent.copied") : ""}</span>
    {status === "failed" && <p role="alert">{t("cloud.share.agent.failed")}</p>}
    {status === "not-owner" && <p role="alert">{t("cloud.share.agent.notOwner")}</p>}
  </section>;
}
