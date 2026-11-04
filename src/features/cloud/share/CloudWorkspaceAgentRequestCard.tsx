import { useId, useState, type ReactNode, type RefObject } from "react";
import { Button } from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization/react";
import { DesktopOverlayLayer } from "../../../components/DesktopOverlayPortal";
import { useAnchoredOverlayPosition } from "../../../components/useAnchoredOverlayPosition";
import type { DesktopCloudSession } from "../../../lib/cloudApi";
import { formatRelativeTime } from "../utils";
import type { AgentRequest } from "./agentLinks";
import { agentMark, type ShareAgentMark } from "./agentMark";
import { useAgentRequestAnswer } from "./useAgentRequestAnswer";
import "./workspace-share.css";

/** The same size and surface as an Agent's hover card, but this one asks for an answer. */
const CARD_WIDTH = 288;
const CARD_MARK_SIZE = 56;

/**
 * The oldest request, automatically below the Header until it is answered.
 * There is no dismiss action, outside-click handler, Escape handler or hover
 * lifetime. The server's next inventory removes an answered/expired request
 * and advances the queue. It does not take the editor's focus on arrival.
 */
export function CloudWorkspaceAgentRequestCard({ request, count, anchorRef, denyRef, session, apiBaseUrl,
  projectName, onChanged, renderAgentMark }: {
  request: AgentRequest;
  count: number;
  anchorRef: RefObject<HTMLElement | null>;
  /** Pressing a Header mark brings the decision into keyboard reach, without making it. */
  denyRef: RefObject<HTMLButtonElement>;
  session: DesktopCloudSession;
  apiBaseUrl: string;
  projectName: string;
  onChanged: () => void;
  renderAgentMark?: (agent: ShareAgentMark) => ReactNode;
}) {
  const localization = useLocalization();
  const { t } = localization;
  const descriptionId = useId();
  const [failed, setFailed] = useState(false);
  const { deciding, answer } = useAgentRequestAnswer({ session, apiBaseUrl, onChanged,
    onDeciding: () => setFailed(false), onFailed: () => setFailed(true) });
  const { setOverlayRef, overlayPosition } = useAnchoredOverlayPosition({
    open: true, anchorRef, preferredWidth: CARD_WIDTH, widthMode: "fixed",
    preferredMaxHeight: 440, gap: 6, margin: 8, alignment: "end", placementPreference: "below",
  });
  return <DesktopOverlayLayer>
    <div ref={setOverlayRef} className="desktop-cloud-agent-card desktop-cloud-agent-request-card"
      data-cloud-agent-request-card={request.id} role="region"
      aria-label={`${request.name} · ${t("cloud.share.agent.request.status")}`} aria-describedby={descriptionId}
      aria-busy={deciding || undefined} data-window-no-drag="true"
      style={overlayPosition
        ? { left: overlayPosition.left, top: overlayPosition.top, width: overlayPosition.width, maxHeight: overlayPosition.maxHeight }
        : { left: 0, top: 0, width: CARD_WIDTH, visibility: "hidden" }}>
      <div className="desktop-cloud-agent-card-when" role="status">
        {t("cloud.share.agent.request.status")} · {formatRelativeTime(request.requested_at, localization)}
        {count > 1 && <span className="desktop-cloud-agent-request-count">{t("cloud.share.agent.request.count", { count })}</span>}
      </div>
      <div className="desktop-cloud-agent-card-who">
        {agentMark({ ...request, active: false, size: CARD_MARK_SIZE }, renderAgentMark)}
        <div className="desktop-cloud-agent-card-facts">
          <span className="desktop-cloud-agent-card-name" dir="auto">{request.name}</span>
          <span className="desktop-cloud-agent-card-fact" dir="auto">{projectName}</span>
        </div>
      </div>
      <p id={descriptionId} className="desktop-cloud-agent-request-access">{t("cloud.share.agent.request.access")}</p>
      {failed && <p className="desktop-cloud-agent-request-error" role="alert">{t("cloud.share.agent.changeFailed")}</p>}
      <div className="desktop-cloud-agent-request-actions">
        <button ref={denyRef} type="button" className="po-button po-button--neutral" data-agent-decision="reject" disabled={deciding}
          aria-label={`${t("cloud.share.agent.request.deny")} ${request.name}`} onClick={() => void answer(request.id, "reject")}>
          {t("cloud.share.agent.request.deny")}
        </button>
        <Button tone="primary" data-agent-decision="approve" disabled={deciding}
          aria-label={`${t("cloud.share.agent.request.allow")} ${request.name}`} onClick={() => void answer(request.id, "approve")}>
          {t("cloud.share.agent.request.allow")}
        </Button>
      </div>
    </div>
  </DesktopOverlayLayer>;
}
