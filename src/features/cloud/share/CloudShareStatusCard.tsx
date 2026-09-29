import { ArrowRight } from "lucide-react";
import type { MessageFormatter } from "@puppyone/localization/core";
import { useLocalization } from "@puppyone/localization/react";
import { formatCloudMessage } from "../cloudPresentation";
import { formatRelativeTime } from "../utils";
import { shareTargetLabelKey } from "./shareTargets";
import type { CloudShareStatus } from "./shareStatus";

/**
 * The Cloud Homepage answer to "which Agents can read this folder right now?".
 * It never configures anything: a status line, current readers, and a single
 * button. Configuration lives in the Share dialog.
 */
export function CloudShareStatusCard({
  status,
  surface,
  onPrimary,
}: {
  status: CloudShareStatus;
  surface: "popover" | "page";
  onPrimary?: () => void;
}) {
  const localization = useLocalization();
  const { t } = localization;
  const hint = shareStatusHint(status, t);
  const managing = status.kind === "shared" || status.kind === "waiting";
  const showReaders = managing && status.readers.length > 0;
  const primaryLabel = status.kind === "attention"
    ? t("cloud.share.status.action.fix")
    : managing
      ? t("cloud.share.status.action.manage")
      : t("cloud.share.status.action.share");

  return (
    <div className={`desktop-share-status desktop-share-status--${surface}`} data-share-state={status.kind}>
      <div className="desktop-share-status-head">
        <span className="desktop-share-status-dot" aria-hidden="true" />
        <span className="desktop-share-status-copy">
          <strong dir="auto">{shareStatusHeadline(status, t)}</strong>
          {hint && <small>{hint}</small>}
        </span>
      </div>

      {showReaders && (
        <ul className="desktop-share-status-readers" aria-label={t("cloud.share.readers.listLabel")}>
          {status.readers.map((share) => {
            const waiting = status.pending?.endpointId === share.id;
            return (
              <li className="desktop-share-status-reader" key={share.id} data-waiting={waiting || undefined}>
                <span className="desktop-share-status-reader-dot" data-live={Boolean(share.lastSeenAt)} aria-hidden="true" />
                <strong dir="auto">{share.name}</strong>
                <small>
                  {share.path ? <bdi>{share.path}</bdi> : t("cloud.share.readers.wholeProject")}
                  {" · "}
                  {t(share.readonly ? "cloud.share.scope.readOnly" : "cloud.share.scope.readWrite")}
                  {" · "}
                  {waiting
                    ? t("cloud.share.readers.waiting")
                    : share.lastSeenAt
                      ? t("cloud.share.readers.lastUsed", { time: formatRelativeTime(share.lastSeenAt, localization) })
                      : t("cloud.share.readers.neverUsed")}
                </small>
              </li>
            );
          })}
        </ul>
      )}

      {onPrimary && (
        <button type="button" className="desktop-share-status-primary" onClick={onPrimary}>
          <span>{primaryLabel}</span>
          <ArrowRight size={14} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

function pendingTargetLabel(status: CloudShareStatus, t: MessageFormatter): string {
  return status.pending ? t(shareTargetLabelKey(status.pending.targetId)) : "";
}

export function shareStatusHeadline(status: CloudShareStatus, t: MessageFormatter): string {
  switch (status.kind) {
    case "local":
      return t("cloud.share.status.local");
    case "signed-out":
      return t("cloud.share.status.signedOut");
    case "resolving":
      return t("cloud.share.status.resolving");
    case "published":
      return t("cloud.share.status.published");
    case "shared":
      return t("cloud.share.status.shared", { count: status.readers.length });
    case "waiting":
      return t("cloud.share.status.waiting", { target: pendingTargetLabel(status, t) });
    case "attention":
      return t("cloud.share.status.attention");
  }
}

/** The one or two words next to the Header cloud glyph. */
export function shareStatusBadge(status: CloudShareStatus, t: MessageFormatter): string {
  switch (status.kind) {
    case "local":
      return t("cloud.share.badge.local");
    case "signed-out":
      return t("cloud.share.badge.signedOut");
    case "resolving":
      return t("cloud.share.badge.resolving");
    case "published":
      return t("cloud.share.badge.published");
    case "shared":
      return t("cloud.share.badge.shared", { count: status.readers.length });
    case "waiting":
      return t("cloud.share.badge.waiting", { target: pendingTargetLabel(status, t) });
    case "attention":
      return t("cloud.share.badge.attention");
  }
}

function shareStatusHint(status: CloudShareStatus, t: MessageFormatter): string | null {
  switch (status.kind) {
    case "local":
      return t("cloud.share.status.localHint");
    case "signed-out":
      return t("cloud.share.status.signedOutHint");
    case "published":
      return t("cloud.share.status.publishedHint");
    case "shared":
      return t("cloud.share.status.sharedHint");
    case "waiting":
      return t("cloud.share.status.waitingHint", { target: pendingTargetLabel(status, t) });
    case "attention":
      return status.message ? formatCloudMessage(status.message, t) : t("cloud.share.status.attentionHint");
    case "resolving":
      return null;
  }
}
