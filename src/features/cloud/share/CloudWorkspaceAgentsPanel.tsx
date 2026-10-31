import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { Check } from "lucide-react";
import { Button, DisclosureIcon } from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization/react";
import { DesktopTitlebarMenuLayer } from "../../../components/DesktopTitlebarMenuLayer";
import type { DesktopCloudSession } from "../../../lib/cloudApi";
import { writeClipboardText } from "../../../lib/clipboard";
import { agentConnectMessage, createAgentLink, listAgentLinks, removeConnectedAgent,
  stopSharingWithAgents, type AgentAdmission, type AgentLinkInventory, type ConnectedAgent } from "./agentLinks";
import { workspaceAgentStatus, type WorkspaceAgent } from "./useWorkspaceAgents";
import "./workspace-share.css";

/** While the panel is open, an Agent the owner just allowed appears on its own. */
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
  copied: "cloud.share.action.copied",
  failed: "cloud.share.agent.copy",
  "not-owner": "cloud.share.agent.copy",
} as const;
const JOINED_LABEL = {
  sign_in: "cloud.share.agent.detail.approved",
  link: "cloud.share.agent.detail.joinedByLink",
} as const;
const DATE_FORMAT = { month: "short", day: "numeric" } as const;

/** What the list tells the shell about an Agent, to be drawn as the Header draws it. */
export type ShareAgentMark = Readonly<{ id: string; name: string; active: boolean }>;

/**
 * Who is in this project, opened from an Agent's mark in the Header. The Agent
 * pressed is unfolded, and connecting another one is the last thing here,
 * because adding to a list belongs with the list.
 */
export function CloudWorkspaceAgentsPanel({ anchor, projectId, projectName, session, apiBaseUrl, agents,
  expandedAgentId, onExpandAgent, renderAgentMark, onChanged, onClose }: {
  anchor: RefObject<HTMLElement | null>;
  projectId: string;
  projectName: string;
  session: DesktopCloudSession;
  apiBaseUrl: string;
  agents?: readonly WorkspaceAgent[];
  expandedAgentId: string | null;
  onExpandAgent: (agentId: string | null) => void;
  renderAgentMark?: (agent: ShareAgentMark) => ReactNode;
  /** The Header states who is here, so it hears about a change at once rather than on its next poll. */
  onChanged?: () => void;
  onClose: () => void;
}) {
  const localization = useLocalization();
  const { t } = localization;
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
    } catch { /* The list is a convenience; connecting does not depend on it. */ }
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
      const url = await createAgentLink(session, projectId,
        inventory.open_links_enabled ? admission : "sign_in", apiBaseUrl);
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

  return <DesktopTitlebarMenuLayer anchorRef={anchor} open onDismiss={onClose} dismissOnFocusExit={false}
    className="desktop-cloud-workspace-share desktop-cloud-agents-panel" gap={6} preferredWidth={360}
    preferredMaxHeight={560} widthMode="fixed" alignment="end" role="dialog"
    ariaLabel={t("cloud.share.agent.connected")}>
    {connections.length > 0 && <section className="desktop-cloud-agents-list" aria-label={t("cloud.share.agent.connected")}>
      <h3>{t("cloud.share.agent.connected")}</h3>
      <ul className="desktop-cloud-agent-list">
        {connections.map(agent => {
          const live = activity.get(agent.grant_id);
          const state = live ? workspaceAgentStatus(live, localization) : null;
          const expanded = expandedAgentId === agent.id;
          return <li key={agent.id} data-cloud-agent-row={agent.id}>
            <button type="button" className="desktop-cloud-agent-row" aria-expanded={expanded}
              onClick={() => onExpandAgent(expanded ? null : agent.id)}>
              {renderAgentMark?.({ id: agent.id, name: agent.name, active: Boolean(live?.active) })
                ?? <span className="desktop-cloud-agent-lamp" data-active={live?.active || undefined} aria-hidden="true" />}
              <span className="desktop-cloud-agent-name" dir="auto">{agent.name}</span>
              {state && <span className="desktop-cloud-agent-state">{state}</span>}
              <DisclosureIcon expanded={expanded} aria-hidden="true" />
            </button>
            {expanded && <AgentDetail agent={agent} onRemove={() => void change(() =>
              removeConnectedAgent(session, projectId, agent.grant_id, apiBaseUrl))} />}
          </li>;
        })}
      </ul>
    </section>}
    {changeFailed && <p role="alert">{t("cloud.share.agent.changeFailed")}</p>}
    <section className="desktop-cloud-agent-share" aria-label={t("cloud.share.agent.title")}>
      <div className="desktop-cloud-share-offer">
        <div className="desktop-cloud-share-offer-text">
          <h3>{t("cloud.share.agent.title")}</h3>
          {!inventory.open_links_enabled && <p className="desktop-cloud-agent-note">{t("cloud.share.agent.note")}</p>}
        </div>
        <Button tone="primary" className="desktop-cloud-agent-share-copy" disabled={status === "copying"}
          leadingIcon={status === "copied" ? <Check size={14} aria-hidden="true" /> : undefined}
          onClick={() => void copy()}>
          {t(COPY_LABEL[status])}
        </Button>
      </div>
      {/* Both consequences stay on screen: this is a choice about who gets in, so
          what each one means has to be readable before picking it, not after.
          With open links closed there is no choice, so nothing asks for one. */}
      {inventory.open_links_enabled && <div className="desktop-cloud-agent-options" role="radiogroup" aria-label={t("cloud.share.agent.title")}>
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
      <span className="desktop-cloud-share-status" role="status">{status === "copied" ? t("cloud.share.agent.copied") : ""}</span>
      {status === "failed" && <p role="alert">{t("cloud.share.agent.failed")}</p>}
      {status === "not-owner" && <p role="alert">{t("cloud.share.agent.notOwner")}</p>}
    </section>
    {/* One Agent already has its own Remove; this earns a line once it says more than that. */}
    {(links.length > 0 || connections.length > 1) && <div className="desktop-cloud-agent-foot">
      {links.length > 0 && <span>{t("cloud.share.agent.activeLinks", { count: links.length })}</span>}
      <button type="button" className="desktop-cloud-agent-share-stop" aria-label={t("cloud.share.agent.stopLabel")}
        onClick={() => void change(() => stopSharingWithAgents(session, projectId, apiBaseUrl))}>
        {t("cloud.share.agent.stop")}
      </button>
    </div>}
  </DesktopTitlebarMenuLayer>;
}

/** The facts about one Agent, and the one thing that can be done to it. */
function AgentDetail({ agent, onRemove }: { agent: ConnectedAgent; onRemove: () => void }) {
  const { formatDate, t } = useLocalization();
  return <div className="desktop-cloud-agent-detail">
    <dl>
      <div>
        <dt>{t("cloud.share.agent.detail.connected")}</dt>
        <dd>{formatDate(agent.connected_at, DATE_FORMAT)} · {t(JOINED_LABEL[agent.admission])}</dd>
      </div>
      {agent.expires_at && <div>
        <dt>{t("cloud.share.agent.detail.ends")}</dt>
        <dd>{formatDate(agent.expires_at, DATE_FORMAT)}</dd>
      </div>}
    </dl>
    <button type="button" className="desktop-cloud-agent-remove" onClick={onRemove}>
      {t("cloud.share.agent.remove")}
    </button>
  </div>;
}
