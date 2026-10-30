import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Check, Copy, X } from "lucide-react";
import { Tooltip } from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization/react";
import type { DesktopCloudSession } from "../../../lib/cloudApi";
import { writeClipboardText } from "../../../lib/clipboard";
import { agentConnectMessage, createAgentLink, listAgentLinks, removeConnectedAgent,
  stopSharingWithAgents, type AgentAdmission, type AgentLinkInventory } from "./agentLinks";
import { workspaceAgentStatus, type WorkspaceAgent } from "./useWorkspaceAgents";

/** While the dialog is open, an Agent the owner just allowed appears on its own. */
const REFRESH_MS = 5_000;
/** Long enough to read, short enough that the button is ready for a second Agent. */
const COPIED_MS = 3_000;
const EMPTY: AgentLinkInventory = { links: [], connections: [] };
const ADMISSIONS = ["sign_in", "link"] as const;
const OPTION_TEXT = {
  sign_in: { label: "cloud.share.agent.signIn.label", description: "cloud.share.agent.signIn.description" },
  link: { label: "cloud.share.agent.link.label", description: "cloud.share.agent.link.description" },
} as const;
const COPY_LABEL = {
  idle: "cloud.share.agent.copy",
  copying: "cloud.common.copying",
  copied: "cloud.share.agent.copied",
  failed: "cloud.share.agent.failed",
  "not-owner": "cloud.share.agent.copy",
} as const;

export function CloudWorkspaceAgentShare({ projectId, projectName, session, apiBaseUrl, agents, onChanged }: {
  projectId: string;
  projectName: string;
  session: DesktopCloudSession;
  apiBaseUrl: string;
  agents?: readonly WorkspaceAgent[];
  /** The Header states who is here, so it hears about a change at once rather than on its next poll. */
  onChanged?: () => void;
}) {
  const localization = useLocalization();
  const { formatDate, t } = localization;
  const activity = useMemo(() => new Map(agents?.map(agent => [agent.grant_id, agent])), [agents]);
  const [admission, setAdmission] = useState<AgentAdmission>("sign_in");
  const [status, setStatus] = useState<keyof typeof COPY_LABEL>("idle");
  const [inventory, setInventory] = useState(EMPTY);
  const [changeFailed, setChangeFailed] = useState(false);
  const mounted = useRef(true);
  const options = useRef<Partial<Record<AgentAdmission, HTMLButtonElement | null>>>({});
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const refresh = useCallback(async () => {
    try {
      const next = await listAgentLinks(session, projectId, apiBaseUrl);
      if (mounted.current) setInventory(next);
    } catch { /* The list is a convenience; sharing does not depend on it. */ }
  }, [apiBaseUrl, projectId, session]);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    if (status !== "copied") return undefined;
    const timer = setTimeout(() => setStatus("idle"), COPIED_MS);
    return () => clearTimeout(timer);
  }, [status]);

  const copy = async () => {
    setStatus("copying");
    try {
      const url = await createAgentLink(session, projectId, admission, apiBaseUrl);
      await writeClipboardText(agentConnectMessage(projectName, url));
      if (!mounted.current) return;
      setStatus("copied");
      void refresh();
      onChanged?.();
    } catch (error) {
      if (mounted.current) setStatus((error as { status?: number }).status === 403 ? "not-owner" : "failed");
    }
  };
  const change = async (action: () => Promise<unknown>) => {
    setChangeFailed(false);
    try { await action(); await refresh(); onChanged?.(); }
    catch { if (mounted.current) setChangeFailed(true); }
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
  const { connections, links } = inventory;
  const sharing = links.length > 0 || connections.length > 0;

  return <section className="desktop-cloud-agent-share" aria-label={t("cloud.share.agent.title")}>
    <h3>{t("cloud.share.agent.title")}</h3>
    {/* Both consequences stay on screen: this is a choice about who gets in, so
        what each one means has to be readable before picking it, not after. */}
    <div className="desktop-cloud-agent-options" role="radiogroup" aria-label={t("cloud.share.agent.title")}>
      {ADMISSIONS.map(option => <button key={option} type="button" role="radio"
        ref={element => { options.current[option] = element; }}
        aria-checked={admission === option} tabIndex={admission === option ? 0 : -1}
        data-agent-admission={option} className="desktop-cloud-agent-option"
        onClick={() => choose(option)} onKeyDown={moveChoice}>
        <span className="desktop-cloud-agent-option-mark" aria-hidden="true" />
        <span className="desktop-cloud-agent-option-label">{t(OPTION_TEXT[option].label)}</span>
        <span className="desktop-cloud-agent-option-description">{t(OPTION_TEXT[option].description)}</span>
      </button>)}
    </div>
    <button type="button" className="desktop-dialog-button primary desktop-cloud-agent-share-copy"
      disabled={status === "copying"} onClick={() => void copy()}>
      {status === "copied" ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
      {t(COPY_LABEL[status])}
    </button>
    <span className="desktop-cloud-share-status" role="status">{status === "copied" ? t(COPY_LABEL.copied) : ""}</span>
    {status === "failed" && <span className="desktop-cloud-share-status" role="alert">{t(COPY_LABEL.failed)}</span>}
    {status === "not-owner" && <p role="alert">{t("cloud.share.agent.notOwner")}</p>}
    {sharing && <div className="desktop-cloud-agent-reach">
      <div className="desktop-cloud-agent-reach-header">
        {connections.length > 0 && <h4>{t("cloud.share.agent.connected")}</h4>}
        {links.length > 0 && <span>{t("cloud.share.agent.activeLinks", { count: links.length })}</span>}
        <button type="button" className="desktop-cloud-agent-share-stop"
          onClick={() => void change(() => stopSharingWithAgents(session, projectId, apiBaseUrl))}>
          {t("cloud.share.agent.stop")}
        </button>
      </div>
      {connections.length > 0 && <ul className="desktop-cloud-agent-list">
        {connections.map(agent => {
          const live = activity.get(agent.grant_id);
          const facts = [live && workspaceAgentStatus(live, localization),
            agent.expires_at && t("cloud.share.agent.expires", { date: formatDate(agent.expires_at, { month: "short", day: "numeric" }) })];
          return <li key={agent.id}>
          <span className="desktop-cloud-agent-lamp" data-active={live?.active || undefined} aria-hidden="true" />
          <span className="desktop-cloud-agent-name" dir="auto">{agent.name}</span>
          {facts.some(Boolean) && <span className="desktop-cloud-agent-expiry">{facts.filter(Boolean).join(" · ")}</span>}
          <Tooltip content={t("cloud.share.agent.remove")}>
            <button type="button" aria-label={`${t("cloud.share.agent.remove")} ${agent.name}`}
              onClick={() => void change(() => removeConnectedAgent(session, projectId, agent.grant_id, apiBaseUrl))}>
              <X size={14} aria-hidden="true" />
            </button>
          </Tooltip>
        </li>;
        })}
      </ul>}
    </div>}
    {changeFailed && <p role="alert">{t("cloud.share.agent.changeFailed")}</p>}
  </section>;
}
