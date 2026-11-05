import { useEffect, useRef, useState, type PointerEvent } from "react";
import { disableTooltipHints } from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization";
import { AgentAvatarMark } from "../components/brand/AgentAvatarMark";
import type { CloudWorkspacePeople } from "../features/cloud/workbench/CloudWorkspaceHeaderTools";
import type { ShareAgentMark } from "../features/cloud/share/agentMark";
import { workspaceAgentStatus } from "../features/cloud/share/useWorkspaceAgents";
import { CARD_MARK_SIZE, CloudWorkspaceAgentCard, type AgentCardSubject } from "./CloudWorkspaceAgentCard";

/** Enough faces to recognize the room; the rest are a count. */
const VISIBLE_AGENT_LIMIT = 3;
/** A Header mark is its button's own circle, so pressing it never draws a ring around a smaller one. */
const HEADER_MARK_SIZE = "var(--po-control-size-compact)";
/** Long enough that passing over the Header shows nothing; the card then follows the pointer at once. */
const CARD_DELAY_MS = 350;

type PersonMark = Readonly<{
  id: string;
  name: string;
  avatar?: string | null;
  active: boolean;
  waiting: boolean;
  status: string | null;
  subject: AgentCardSubject;
}>;
type Hover = Readonly<{ mark: PersonMark; anchor: HTMLElement }>;

/**
 * The Agents in a hosted workspace. Only what is live stands on its own: an
 * Agent asking to join, which only the owner can move on, then whoever is at
 * work, each its own button at the front of the row. The Agents at rest are one
 * stack after a gap, because nothing about them asks to be read apart. Resting
 * the pointer on any one of them shows its card; pressing one opens the Agents
 * dialog, or brings an unanswered request's persistent card into keyboard reach.
 */
export function CloudWorkspaceAgentPeople({ agents, requests, open, pressedAgentId, onOpen }: CloudWorkspacePeople) {
  const localization = useLocalization();
  const { t } = localization;
  const card = useAgentCard(open || requests.length > 0);
  const asking: PersonMark[] = requests.map(request => ({ id: request.id, name: request.name, avatar: request.avatar,
    active: false, waiting: true, status: t("cloud.share.agent.request.status"), subject: { kind: "request", request } }));
  const toMark = (agent: (typeof agents)[number]): PersonMark => ({ id: agent.id, name: agent.name,
    avatar: agent.avatar, active: agent.active, waiting: false, status: workspaceAgentStatus(agent, localization),
    subject: { kind: "agent", agent } });
  const live = [...asking, ...agents.filter(agent => agent.active).map(toMark)];
  const shown = live.slice(0, VISIBLE_AGENT_LIMIT);
  const resting = [...live.slice(VISIBLE_AGENT_LIMIT), ...agents.filter(agent => !agent.active).map(toMark)];
  const press = (agentId: string | null) => { card.hide(); onOpen(agentId); };
  return <div className="desktop-titlebar-cloud-agents" role="group" aria-label={t("cloud.share.agent.connected")}
    ref={element => { if (element) disableTooltipHints(element); }}>
    {shown.map(agent => {
      const label = [agent.name, agent.status].filter(Boolean).join(" · ");
      return <button key={agent.id} type="button" className="desktop-titlebar-cloud-agent" data-cloud-workspace-agent={agent.id}
        data-waiting={agent.waiting || undefined}
        aria-label={label} aria-haspopup={requests.length ? undefined : "dialog"}
        aria-expanded={requests.length ? undefined : open && pressedAgentId === agent.id}
        onPointerEnter={event => card.show(agent, event.currentTarget)} onPointerLeave={card.hide}
        onClick={() => press(agent.id)}>
        <CloudWorkspaceAgentMark id={agent.id} name={agent.name} avatar={agent.avatar} active={agent.active}
          size={HEADER_MARK_SIZE} />
      </button>;
    })}
    {resting.length > 0 && <RestingAgents agents={resting} expanded={requests.length ? undefined : open && pressedAgentId === null}
      onHover={card.show} onLeave={card.hide} onOpen={() => press(null)} />}
    {card.hovered && <CloudWorkspaceAgentCard key={card.hovered.mark.id} subject={card.hovered.mark.subject}
      anchor={card.hovered.anchor}
      mark={<CloudWorkspaceAgentMark id={card.hovered.mark.id} name={card.hovered.mark.name}
        avatar={card.hovered.mark.avatar} active={card.hovered.mark.active} size={CARD_MARK_SIZE} />} />}
  </div>;
}

/**
 * The Agents at rest, stacked like a pile of tokens with the first in front,
 * and a count past three. Each face in the pile still shows its own card.
 */
function RestingAgents({ agents, expanded, onHover, onLeave, onOpen }: {
  agents: readonly PersonMark[];
  expanded: boolean | undefined;
  onHover: (mark: PersonMark, anchor: HTMLElement) => void;
  onLeave: () => void;
  onOpen: () => void;
}) {
  const { t, formatList } = useLocalization();
  const stacked = agents.slice(0, VISIBLE_AGENT_LIMIT);
  const overflow = agents.length - stacked.length;
  const label = formatList(agents.map(agent => agent.name));
  // The face under the pointer, found among the pile's marks in their order.
  const follow = (event: PointerEvent<HTMLButtonElement>) => {
    const face = event.target instanceof Element ? event.target.closest<HTMLElement>(".desktop-project-reach-mark") : null;
    const index = face ? [...event.currentTarget.querySelectorAll(".desktop-project-reach-mark")].indexOf(face) : -1;
    if (face && stacked[index]) onHover(stacked[index], face);
    else onLeave();
  };
  return <button type="button" className="desktop-titlebar-cloud-agent desktop-titlebar-cloud-agent-stack"
    data-cloud-workspace-agent-stack="" aria-label={label} aria-haspopup={expanded === undefined ? undefined : "dialog"} aria-expanded={expanded}
    onPointerMove={follow} onPointerLeave={onLeave} onClick={onOpen}>
    {stacked.map(agent => <CloudWorkspaceAgentMark key={agent.id} id={agent.id} name={agent.name}
      avatar={agent.avatar} active={false} size={HEADER_MARK_SIZE} />)}
    {overflow > 0 && <span className="desktop-titlebar-cloud-agent-count">
      {t("shell.projectReach.more", { count: overflow })}
    </span>}
  </button>;
}

/**
 * Which mark's card is showing. It waits a moment before the first card, so
 * passing over the Header shows nothing, then follows the pointer from face to
 * face at once; it gives way to an open Agents dialog or a request awaiting a decision.
 */
function useAgentCard(suppressed: boolean) {
  const [hovered, setHovered] = useState<Hover | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shown = useRef(false);
  shown.current = hovered !== null;
  const cancel = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  useEffect(() => cancel, []);
  useEffect(() => { if (suppressed) { cancel(); setHovered(null); } }, [suppressed]);
  const show = (mark: PersonMark, anchor: HTMLElement) => {
    if (suppressed) return;
    cancel();
    if (shown.current) { setHovered(current => current?.mark.id === mark.id && current.anchor === anchor ? current : { mark, anchor }); return; }
    timer.current = setTimeout(() => setHovered({ mark, anchor }), CARD_DELAY_MS);
  };
  const hide = () => { cancel(); setHovered(null); };
  return { hovered, show, hide };
}

/** The same mark in the Agents dialog and its card as in the Header, so an Agent looks like itself in all of them. */
export function CloudWorkspaceAgentMark({ name, avatar, active, size = 22 }: Omit<ShareAgentMark, "size"> & {
  /** Pixels, or a length such as a control token when the mark is its button. */
  size?: number | string;
}) {
  return <AgentAvatarMark name={name} size={size} avatar={avatar} active={active} />;
}
