import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Tooltip } from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization/react";
import { DesktopDialogCloseButton, DesktopDialogRoot, DesktopDialogSurface } from "../../../components/DesktopDialog";
import { DesktopOverlayLayer } from "../../../components/DesktopOverlayPortal";
import type { DesktopCloudSession } from "../../../lib/cloudApi";
import { listAgentLinks, removeConnectedAgent, stopSharingWithAgents, type AgentLinkInventory, type ConnectedAgent } from "./agentLinks";
import { agentMark, type ShareAgentMark } from "./CloudWorkspaceAgentsPanel";
import { workspaceAgentStatus, type WorkspaceAgent } from "./useWorkspaceAgents";
import "./workspace-share.css";

/** While it is open, an Agent the owner just allowed appears on its own. */
const REFRESH_MS = 5_000;
const EMPTY: AgentLinkInventory = { links: [], connections: [] };
const JOINED_LABEL = {
  sign_in: "cloud.share.agent.detail.approved",
  link: "cloud.share.agent.detail.joinedByLink",
} as const;
const DATE_FORMAT = { month: "short", day: "numeric" } as const;

/** Everything that can be changed about who is in a project, in one place. */
export function CloudWorkspaceAgentsDialog({ projectId, session, apiBaseUrl, agents, renderAgentMark, onChanged, onClose }: {
  projectId: string;
  session: DesktopCloudSession;
  apiBaseUrl: string;
  agents: readonly WorkspaceAgent[];
  renderAgentMark?: (agent: ShareAgentMark) => ReactNode;
  /** The Header states who is here, so it hears about a change at once rather than on its next poll. */
  onChanged?: () => void;
  onClose: () => void;
}) {
  const localization = useLocalization();
  const { formatDate, t } = localization;
  const [inventory, setInventory] = useState(EMPTY);
  const [changeFailed, setChangeFailed] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const refresh = useCallback(async () => {
    try {
      const next = await listAgentLinks(session, projectId, apiBaseUrl);
      if (mounted.current) setInventory(next);
    } catch { /* What is shown stays until a read succeeds. */ }
  }, [apiBaseUrl, projectId, session]);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);
  const change = async (action: () => Promise<unknown>) => {
    setChangeFailed(false);
    try { await action(); await refresh(); onChanged?.(); }
    catch { if (mounted.current) setChangeFailed(true); }
  };
  const { connections, links } = inventory;
  const live = new Map(agents.map(agent => [agent.grant_id, agent]));
  const facts = (agent: ConnectedAgent) => {
    const known = live.get(agent.grant_id);
    return [known ? workspaceAgentStatus(known, localization) : null, t(JOINED_LABEL[agent.admission]),
      agent.expires_at ? t("cloud.share.agent.detail.ends", { date: formatDate(agent.expires_at, DATE_FORMAT) }) : null,
    ].filter(Boolean).join(" · ");
  };
  return <DesktopOverlayLayer>
    <DesktopDialogRoot onClose={onClose}>
      <DesktopDialogSurface className="desktop-cloud-agents-dialog" width={520} ariaLabel={t("cloud.share.agent.manage")}>
        <header className="desktop-dialog-header">
          <div className="desktop-dialog-title-row">
            <h2>{t("cloud.share.agent.manage")}</h2>
          </div>
          <Tooltip content={t("common.action.close")}>
            <DesktopDialogCloseButton label={t("common.action.close")} onClick={onClose} />
          </Tooltip>
        </header>
        <div className="desktop-dialog-body desktop-cloud-agents-dialog-body">
          {connections.length === 0
            ? <p className="desktop-cloud-agents-empty">{t("cloud.share.agent.empty")}</p>
            : <ul className="desktop-cloud-agents-manage-list">
              {connections.map(agent => <li key={agent.id} data-cloud-agent-managed={agent.id}>
                {agentMark(live.get(agent.grant_id)
                  ?? { ...agent, active: false, lastActiveAt: null, activityKnown: false }, renderAgentMark)}
                <span className="desktop-cloud-agents-manage-text">
                  <span className="desktop-cloud-agent-name" dir="auto">{agent.name}</span>
                  <span className="desktop-cloud-agents-manage-facts">{facts(agent)}</span>
                </span>
                <button type="button" className="desktop-dialog-button desktop-cloud-agents-remove"
                  aria-label={`${t("cloud.share.agent.remove")} ${agent.name}`}
                  onClick={() => void change(() => removeConnectedAgent(session, projectId, agent.grant_id, apiBaseUrl))}>
                  {t("cloud.share.agent.remove")}
                </button>
              </li>)}
            </ul>}
          {links.length > 0 && <section className="desktop-cloud-agents-links" aria-label={t("cloud.share.agent.links")}>
            <h3>{t("cloud.share.agent.links")}</h3>
            <ul>{links.map(link => <li key={link.id}>
              {t("cloud.share.agent.linkExpires", { date: formatDate(link.expires_at, DATE_FORMAT) })}
            </li>)}</ul>
          </section>}
          {changeFailed && <p role="alert">{t("cloud.share.agent.changeFailed")}</p>}
          {/* The service ends links and connections together, so the button says both. */}
          {(links.length > 0 || connections.length > 1) && <footer className="desktop-cloud-agents-dialog-foot">
            <button type="button" className="desktop-cloud-agent-share-stop"
              onClick={() => void change(() => stopSharingWithAgents(session, projectId, apiBaseUrl))}>
              {t("cloud.share.agent.removeAll")}
            </button>
          </footer>}
        </div>
      </DesktopDialogSurface>
    </DesktopDialogRoot>
  </DesktopOverlayLayer>;
}
