import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { Check, Plus, X } from "lucide-react";
import { Tooltip } from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization/react";
import { DesktopMenuItem } from "../../../components/DesktopMenu";
import { DesktopTitlebarMenuLayer } from "../../../components/DesktopTitlebarMenuLayer";
import type { DesktopCloudSession } from "../../../lib/cloudApi";
import { writeClipboardText } from "../../../lib/clipboard";
import { agentConnectMessage, createAgentLink, listAgentLinks, removeConnectedAgent,
  type AgentAdmission, type AgentLinkInventory } from "./agentLinks";
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
/** The row says what happened in its own place, and only then what to do next. */
const INVITE_LABEL = {
  idle: "cloud.share.agent.title",
  copying: "cloud.common.copying",
  copied: "cloud.share.agent.copied",
  failed: "cloud.share.agent.title",
  "not-owner": "cloud.share.agent.title",
} as const;

/** What the list tells the shell about an Agent, to be drawn as the Header draws it. */
export type ShareAgentMark = Readonly<{ id: string; name: string; active: boolean }>;

/**
 * Who is in this project: a mark, a name and when it was last here. Inviting
 * another is the last row, because adding to a list belongs with the list.
 */
export function CloudWorkspaceAgentsPanel({ anchor, projectId, projectName, session, apiBaseUrl, agents,
  renderAgentMark, onChanged, onClose }: {
  anchor: RefObject<HTMLElement | null>;
  projectId: string;
  projectName: string;
  session: DesktopCloudSession;
  apiBaseUrl: string;
  agents?: readonly WorkspaceAgent[];
  renderAgentMark?: (agent: ShareAgentMark) => ReactNode;
  /** The Header states who is here, so it hears about a change at once rather than on its next poll. */
  onChanged?: () => void;
  onClose: () => void;
}) {
  const localization = useLocalization();
  const { t } = localization;
  const activity = useMemo(() => new Map(agents?.map(agent => [agent.grant_id, agent])), [agents]);
  const [admission, setAdmission] = useState<AgentAdmission>("sign_in");
  const [status, setStatus] = useState<keyof typeof INVITE_LABEL>("idle");
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
  const remove = async (grantId: string) => {
    setChangeFailed(false);
    try { await removeConnectedAgent(session, projectId, grantId, apiBaseUrl); await refresh(); onChanged?.(); }
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
  const { connections } = inventory;

  return <DesktopTitlebarMenuLayer anchorRef={anchor} open onDismiss={onClose} dismissOnFocusExit={false}
    className="desktop-cloud-workspace-share desktop-cloud-agents-panel" gap={6} preferredWidth={300}
    preferredMaxHeight={560} widthMode="fixed" alignment="end" role="dialog"
    ariaLabel={t("cloud.share.agent.connected")}>
    {connections.length > 0 && <ul className="desktop-cloud-agent-list" aria-label={t("cloud.share.agent.connected")}>
      {connections.map(agent => {
        const live = activity.get(agent.grant_id);
        const state = live ? workspaceAgentStatus(live, localization) : null;
        return <li key={agent.id} data-cloud-agent-row={agent.id}>
          {renderAgentMark?.({ id: agent.id, name: agent.name, active: Boolean(live?.active) })
            ?? <span className="desktop-cloud-agent-lamp" data-active={live?.active || undefined} aria-hidden="true" />}
          <span className="desktop-cloud-agent-name" dir="auto">{agent.name}</span>
          {state && <span className="desktop-cloud-agent-state">{state}</span>}
          {/* Removing is rare and reached for, so it never sits in the list as words. */}
          <Tooltip content={t("cloud.share.agent.remove")}>
            <button type="button" className="desktop-cloud-agent-remove"
              aria-label={`${t("cloud.share.agent.remove")} ${agent.name}`} onClick={() => void remove(agent.grant_id)}>
              <X size={14} aria-hidden="true" />
            </button>
          </Tooltip>
        </li>;
      })}
    </ul>}
    {changeFailed && <p role="alert">{t("cloud.share.agent.changeFailed")}</p>}
    <section className="desktop-cloud-agent-invite" aria-label={t("cloud.share.agent.title")}>
      <DesktopMenuItem className="desktop-cloud-agent-invite-row" role="button" data-cloud-agent-invite=""
        aria-disabled={status === "copying" || undefined}
        icon={status === "copied" ? <Check size={15} aria-hidden="true" /> : <Plus size={15} aria-hidden="true" />}
        label={t(INVITE_LABEL[status])} onClick={() => { if (status !== "copying") void copy(); }} />
      {/* Who gets in is only a question where a deployment allows open links. */}
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
  </DesktopTitlebarMenuLayer>;
}
