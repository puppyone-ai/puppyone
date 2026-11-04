import { useRef, type ReactNode } from "react";
import { useLocalization } from "@puppyone/localization";
import { DesktopOverlayLayer } from "../components/DesktopOverlayPortal";
import { useAnchoredOverlayPosition } from "../components/useAnchoredOverlayPosition";
import type { AgentRequest } from "../features/cloud/share/agentLinks";
import { workspaceAgentStatus, type WorkspaceAgent } from "../features/cloud/share/useWorkspaceAgents";
import { formatRelativeTime } from "../features/cloud/utils";

const CARD_WIDTH = 288;
/** The mark in the card, larger than in the Header, as a face on a card is. */
export const CARD_MARK_SIZE = 56;
const DATE_FORMAT = { month: "short", day: "numeric" } as const;
const JOINED_LABEL = {
  sign_in: "cloud.share.agent.detail.approved",
  link: "cloud.share.agent.detail.joinedByLink",
} as const;

/** Who a Header mark stands for: an Agent in the project, or one asking to join it. */
export type AgentCardSubject =
  | Readonly<{ kind: "agent"; agent: WorkspaceAgent }>
  | Readonly<{ kind: "request"; request: AgentRequest }>;

/**
 * An Agent at a glance, under its mark in the Header, as a person's card is
 * in Notion: when it last worked, across the top; then the Agent itself, how
 * it got in and how long it may stay. It only reads, so it never takes the
 * pointer or the focus, and the mark's own name already says it in words.
 */
export function CloudWorkspaceAgentCard({ subject, anchor, mark }: {
  subject: AgentCardSubject;
  anchor: HTMLElement;
  /** The Agent drawn as the shell draws it, at the card's size. */
  mark: ReactNode;
}) {
  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;
  const localization = useLocalization();
  const { formatDate, t } = localization;
  const { setOverlayRef, overlayPosition } = useAnchoredOverlayPosition({
    open: true, anchorRef, preferredWidth: CARD_WIDTH, widthMode: "fixed",
    preferredMaxHeight: 220, gap: 6, margin: 8, alignment: "center", placementPreference: "below",
  });
  const person = subject.kind === "agent" ? subject.agent : subject.request;
  const live = subject.kind === "agent" && subject.agent.active;
  const when = subject.kind === "agent"
    ? workspaceAgentStatus(subject.agent, localization)
    : `${t("cloud.share.agent.request.status")} · ${formatRelativeTime(subject.request.requested_at, localization)}`;
  const facts = subject.kind === "agent" ? [
    t(JOINED_LABEL[subject.agent.admission]),
    subject.agent.expires_at
      ? t("cloud.share.agent.detail.ends", { date: formatDate(subject.agent.expires_at, DATE_FORMAT) })
      : t("cloud.share.agent.detail.since", { date: formatDate(subject.agent.connected_at, DATE_FORMAT) }),
  ] : [];
  return <DesktopOverlayLayer>
    <div ref={setOverlayRef} className="desktop-cloud-agent-card" aria-hidden="true"
      data-cloud-agent-card={person.id} data-live={live || undefined}
      style={overlayPosition
        ? { left: overlayPosition.left, top: overlayPosition.top, width: overlayPosition.width }
        : { left: 0, top: 0, width: CARD_WIDTH, visibility: "hidden" }}>
      <div className="desktop-cloud-agent-card-when">{when}</div>
      <div className="desktop-cloud-agent-card-who">
        {mark}
        <div className="desktop-cloud-agent-card-facts">
          <span className="desktop-cloud-agent-card-name" dir="auto">{person.name}</span>
          {facts.map(fact => <span key={fact} className="desktop-cloud-agent-card-fact">{fact}</span>)}
        </div>
      </div>
    </div>
  </DesktopOverlayLayer>;
}
