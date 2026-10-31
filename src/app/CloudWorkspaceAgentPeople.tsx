import { Tooltip } from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization/react";
import { ReachMemberMark } from "../features/app-shell/project-reach";
import type { CloudWorkspacePeople } from "../features/cloud/workbench/CloudWorkspaceHeaderTools";
import type { ShareAgentMark } from "../features/cloud/share/CloudWorkspaceAgentsPanel";
import { workspaceAgentStatus } from "../features/cloud/share/useWorkspaceAgents";

/** Enough faces to recognize the room; the rest are a count. */
const VISIBLE_AGENT_LIMIT = 3;

/**
 * The Agents in a hosted workspace, each its own button: pressing one asks about
 * that Agent. Whoever is at work comes first, as the only live fact in the row.
 */
export function CloudWorkspaceAgentPeople({ agents, open, expandedAgentId, onOpen }: CloudWorkspacePeople) {
  const localization = useLocalization();
  const { t } = localization;
  const ordered = [...agents].sort((left, right) => Number(right.active) - Number(left.active));
  const visible = ordered.slice(0, VISIBLE_AGENT_LIMIT);
  const overflow = ordered.length - visible.length;
  return <div className="desktop-titlebar-cloud-agents" role="group" aria-label={t("cloud.share.agent.connected")}>
    {visible.map(agent => {
      const label = [agent.name, workspaceAgentStatus(agent, localization)].filter(Boolean).join(" · ");
      return <Tooltip key={agent.id} content={label}>
        <button type="button" className="desktop-titlebar-cloud-agent" data-cloud-workspace-agent={agent.id}
          aria-label={label} aria-haspopup="dialog" aria-expanded={open && expandedAgentId === agent.id}
          onClick={() => onOpen(agent.id)}>
          <CloudWorkspaceAgentMark id={agent.id} name={agent.name} active={agent.active} />
        </button>
      </Tooltip>;
    })}
    {overflow > 0 && <Tooltip content={t("cloud.share.agent.connected")}>
      <button type="button" className="desktop-titlebar-cloud-agent" data-cloud-workspace-agent-more=""
        aria-label={t("cloud.share.agent.connected")} aria-haspopup="dialog"
        aria-expanded={open && expandedAgentId === null} onClick={() => onOpen(null)}>
        <span className="desktop-project-reach-count">{t("shell.projectReach.more", { count: overflow })}</span>
      </button>
    </Tooltip>}
  </div>;
}

/** The same mark in the Agents panel as in the Header, so an Agent looks like itself in both. */
export function CloudWorkspaceAgentMark({ id, name, active }: ShareAgentMark) {
  return <ReachMemberMark size={22} member={{ id, name, audience: "machine", lastSeenAt: null,
    activity: active ? { kind: "working", label: name } : null }} />;
}
