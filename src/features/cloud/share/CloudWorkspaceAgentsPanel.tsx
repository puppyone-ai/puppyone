import type { ReactNode, RefObject } from "react";
import { Settings } from "lucide-react";
import { useLocalization } from "@puppyone/localization/react";
import { DesktopMenuItem } from "../../../components/DesktopMenu";
import { DesktopTitlebarMenuLayer } from "../../../components/DesktopTitlebarMenuLayer";
import { workspaceAgentStatus, type WorkspaceAgent } from "./useWorkspaceAgents";
import "./workspace-share.css";

/** What the list tells the shell about an Agent, to be drawn as the Header draws it. */
export type ShareAgentMark = Readonly<{ id: string; name: string; active: boolean }>;

/** Draws one Agent: the shell's mark, or a lamp where the shell lends none. */
export function agentMark(agent: WorkspaceAgent, renderAgentMark?: (agent: ShareAgentMark) => ReactNode) {
  return renderAgentMark?.({ id: agent.id, name: agent.name, active: agent.active })
    ?? <span className="desktop-cloud-agent-lamp" data-active={agent.active || undefined} aria-hidden="true" />;
}

/**
 * A glance at who is here: a mark, a name and when each was last here. Nothing
 * can be changed from it; that is what Manage agents is for.
 */
export function CloudWorkspaceAgentsPanel({ anchor, agents, renderAgentMark, onManage, onClose }: {
  anchor: RefObject<HTMLElement | null>;
  agents: readonly WorkspaceAgent[];
  renderAgentMark?: (agent: ShareAgentMark) => ReactNode;
  onManage: () => void;
  onClose: () => void;
}) {
  const localization = useLocalization();
  const { t } = localization;
  return <DesktopTitlebarMenuLayer anchorRef={anchor} open onDismiss={onClose} dismissOnFocusExit={false}
    className="desktop-cloud-workspace-share desktop-cloud-agents-panel" gap={6} preferredWidth={300}
    preferredMaxHeight={560} widthMode="fixed" alignment="end" role="dialog"
    ariaLabel={t("cloud.share.agent.connected")}>
    <ul className="desktop-cloud-agent-list" aria-label={t("cloud.share.agent.connected")}>
      {agents.map(agent => {
        const state = workspaceAgentStatus(agent, localization);
        return <li key={agent.id} data-cloud-agent-row={agent.id}>
          {agentMark(agent, renderAgentMark)}
          <span className="desktop-cloud-agent-name" dir="auto">{agent.name}</span>
          {state && <span className="desktop-cloud-agent-state">{state}</span>}
        </li>;
      })}
    </ul>
    <div className="desktop-cloud-agents-foot">
      <DesktopMenuItem className="desktop-cloud-agents-manage" role="button" data-cloud-agents-manage=""
        icon={<Settings size={15} strokeWidth={1.75} aria-hidden="true" />}
        label={t("cloud.share.agent.manage")} onClick={onManage} />
    </div>
  </DesktopTitlebarMenuLayer>;
}
