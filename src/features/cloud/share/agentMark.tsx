import type { ReactNode } from "react";

/**
 * What the share feature tells the shell about an Agent, to be drawn as the
 * Header draws it. A host may ask for its own size; anywhere else the shell's
 * size holds. Its own module, so the Agents card, the invite and Manage agents
 * can all draw an Agent without importing each other.
 */
export type ShareAgentMark = Readonly<{
  id: string;
  name: string;
  active: boolean;
  /** The picture the Agent chose when it connected, if any. */
  avatar?: string | null;
  size?: number;
}>;

/** Draws one Agent: the shell's mark, or a lamp where the shell lends none. */
export function agentMark(agent: ShareAgentMark, renderAgentMark?: (agent: ShareAgentMark) => ReactNode) {
  return renderAgentMark?.({ id: agent.id, name: agent.name, active: agent.active, avatar: agent.avatar,
    size: agent.size })
    ?? <span className="desktop-cloud-agent-lamp" data-active={agent.active || undefined} aria-hidden="true" />;
}
