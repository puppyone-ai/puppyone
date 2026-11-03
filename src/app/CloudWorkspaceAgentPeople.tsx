import { Tooltip } from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization/react";
import { ReachMemberMark } from "../features/app-shell/project-reach";
import type { CloudWorkspacePeople } from "../features/cloud/workbench/CloudWorkspaceHeaderTools";
import type { ShareAgentMark } from "../features/cloud/share/CloudWorkspaceAgentsPanel";
import { workspaceAgentStatus } from "../features/cloud/share/useWorkspaceAgents";

/** Enough faces to recognize the room; the rest are a count. */
const VISIBLE_AGENT_LIMIT = 3;

/**
 * The Agents in a hosted workspace, each its own button, and any of them opens
 * the list. An Agent asking to join comes first, since only the owner can move
 * it on; then whoever is at work, as the only live fact in the row.
 */
export function CloudWorkspaceAgentPeople({ agents, requests, open, pressedAgentId, onOpen }: CloudWorkspacePeople) {
  const localization = useLocalization();
  const { t } = localization;
  const ordered = [
    ...requests.map(request => ({ id: request.id, name: request.name, active: false, waiting: true,
      status: t("cloud.share.agent.request.status") })),
    ...[...agents].sort((left, right) => Number(right.active) - Number(left.active))
      .map(agent => ({ id: agent.id, name: agent.name, active: agent.active, waiting: false,
        status: workspaceAgentStatus(agent, localization) })),
  ];
  const visible = ordered.slice(0, VISIBLE_AGENT_LIMIT);
  const overflow = ordered.length - visible.length;
  return <div className="desktop-titlebar-cloud-agents" role="group" aria-label={t("cloud.share.agent.connected")}>
    {visible.map(agent => {
      const label = [agent.name, agent.status].filter(Boolean).join(" · ");
      return <Tooltip key={agent.id} content={label}>
        <button type="button" className="desktop-titlebar-cloud-agent" data-cloud-workspace-agent={agent.id}
          data-waiting={agent.waiting || undefined}
          aria-label={label} aria-haspopup="dialog" aria-expanded={open && pressedAgentId === agent.id}
          onClick={() => onOpen(agent.id)}>
          <CloudWorkspaceAgentMark id={agent.id} name={agent.name} active={agent.active} />
        </button>
      </Tooltip>;
    })}
    {overflow > 0 && <Tooltip content={t("cloud.share.agent.connected")}>
      <button type="button" className="desktop-titlebar-cloud-agent" data-cloud-workspace-agent-more=""
        aria-label={t("cloud.share.agent.connected")} aria-haspopup="dialog"
        aria-expanded={open && pressedAgentId === null} onClick={() => onOpen(null)}>
        <span className="desktop-project-reach-count">{t("shell.projectReach.more", { count: overflow })}</span>
      </button>
    </Tooltip>}
  </div>;
}

/** The same mark in the Agents panel as in the Header, so an Agent looks like itself in both. */
export function CloudWorkspaceAgentMark({ id, name, active, size = 22 }: ShareAgentMark) {
  return <ReachMemberMark size={size} member={{ id, name, audience: "machine", lastSeenAt: null,
    activity: active ? { kind: "working", label: name } : null }} />;
}
