import { Tooltip } from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization";
import { ReachMemberMark } from "../features/app-shell/project-reach";
import type { CloudWorkspacePeople } from "../features/cloud/workbench/CloudWorkspaceHeaderTools";
import type { ShareAgentMark } from "../features/cloud/share/agentMark";
import { workspaceAgentStatus } from "../features/cloud/share/useWorkspaceAgents";

/** Enough faces to recognize the room; the rest are a count. */
const VISIBLE_AGENT_LIMIT = 3;
/** A Header mark is its button's own circle, so pressing it never draws a ring around a smaller one. */
const HEADER_MARK_SIZE = "var(--po-control-size-compact)";

type PersonMark = Readonly<{
  id: string;
  name: string;
  avatar?: string | null;
  active: boolean;
  waiting: boolean;
  status: string | null;
}>;

/**
 * The Agents in a hosted workspace. Only what is live stands on its own: an
 * Agent asking to join, which only the owner can move on, then whoever is at
 * work, each its own button at the front of the row. The Agents at rest are one
 * stack after a gap, pressed as one, because nothing about them asks to be read
 * apart. Any of them opens the same list.
 */
export function CloudWorkspaceAgentPeople({ agents, requests, open, pressedAgentId, onOpen }: CloudWorkspacePeople) {
  const localization = useLocalization();
  const { t } = localization;
  const asking: PersonMark[] = requests.map(request => ({ id: request.id, name: request.name, avatar: request.avatar,
    active: false, waiting: true, status: t("cloud.share.agent.request.status") }));
  const toMark = (agent: (typeof agents)[number]): PersonMark => ({ id: agent.id, name: agent.name,
    avatar: agent.avatar, active: agent.active, waiting: false, status: workspaceAgentStatus(agent, localization) });
  const live = [...asking, ...agents.filter(agent => agent.active).map(toMark)];
  const shown = live.slice(0, VISIBLE_AGENT_LIMIT);
  const resting = [...live.slice(VISIBLE_AGENT_LIMIT), ...agents.filter(agent => !agent.active).map(toMark)];
  return <div className="desktop-titlebar-cloud-agents" role="group" aria-label={t("cloud.share.agent.connected")}>
    {shown.map(agent => {
      const label = [agent.name, agent.status].filter(Boolean).join(" · ");
      return <Tooltip key={agent.id} content={label}>
        <button type="button" className="desktop-titlebar-cloud-agent" data-cloud-workspace-agent={agent.id}
          data-waiting={agent.waiting || undefined}
          aria-label={label} aria-haspopup="dialog" aria-expanded={open && pressedAgentId === agent.id}
          onClick={() => onOpen(agent.id)}>
          <CloudWorkspaceAgentMark id={agent.id} name={agent.name} avatar={agent.avatar} active={agent.active}
            size={HEADER_MARK_SIZE} />
        </button>
      </Tooltip>;
    })}
    {resting.length > 0 && <RestingAgents agents={resting} expanded={open && pressedAgentId === null}
      onOpen={() => onOpen(null)} />}
  </div>;
}

/** The Agents at rest, stacked like a pile of tokens with the first in front, and a count past three. */
function RestingAgents({ agents, expanded, onOpen }: {
  agents: readonly PersonMark[];
  expanded: boolean;
  onOpen: () => void;
}) {
  const { t, formatList } = useLocalization();
  const stacked = agents.slice(0, VISIBLE_AGENT_LIMIT);
  const overflow = agents.length - stacked.length;
  const label = formatList(agents.map(agent => agent.name));
  return <Tooltip content={label}>
    <button type="button" className="desktop-titlebar-cloud-agent desktop-titlebar-cloud-agent-stack"
      data-cloud-workspace-agent-stack="" aria-label={label} aria-haspopup="dialog" aria-expanded={expanded}
      onClick={onOpen}>
      {stacked.map(agent => <CloudWorkspaceAgentMark key={agent.id} id={agent.id} name={agent.name}
        avatar={agent.avatar} active={false} size={HEADER_MARK_SIZE} />)}
      {overflow > 0 && <span className="desktop-titlebar-cloud-agent-count">
        {t("shell.projectReach.more", { count: overflow })}
      </span>}
    </button>
  </Tooltip>;
}

/** The same mark in the Agents panel as in the Header, so an Agent looks like itself in both. */
export function CloudWorkspaceAgentMark({ id, name, avatar, active, size = 22 }: Omit<ShareAgentMark, "size"> & {
  /** Pixels, or a length such as a control token when the mark is its button. */
  size?: number | string;
}) {
  return <ReachMemberMark size={size} avatar={avatar} member={{ id, name, audience: "machine", lastSeenAt: null,
    activity: active ? { kind: "working", label: name } : null }} />;
}
