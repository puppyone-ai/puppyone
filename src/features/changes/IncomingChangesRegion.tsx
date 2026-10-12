import { useLocalization } from "@puppyone/localization";
import type { LocaleFormatters } from "@puppyone/localization/core";
import type { ReactNode } from "react";
import type { IncomingChangeFile, IncomingChangeReceipt } from "./incomingChangeReceipt";
import type { IncomingChangeReview } from "./useIncomingChangeReview";

export type IncomingChangesRegionProps = Readonly<{
  review: IncomingChangeReview;
  disabled: boolean;
  /** Opens one incoming file in the diff surface this sidebar already owns. */
  onReview: (file: IncomingChangeFile) => void;
}>;

/**
 * Changes made on another workbench arrive as a receipt, not as an edit: the
 * files on this Mac stay untouched until the user applies them, and setting the
 * receipt aside only hides it. That promise is the whole reason this surface
 * replaces a direction counter with a sentence.
 */
export function IncomingChangesRegion({ review, disabled, onReview }: IncomingChangesRegionProps) {
  const { t } = useLocalization();
  if (review.state === "inactive" || review.state === "none" || !review.receipt) return null;
  const { receipt } = review;

  if (review.state === "set-aside") {
    return (
      <Region>
        <p className="desktop-incoming-changes-summary">
          {t("source-control.reach.incoming.setAsideNotice", { count: receipt.changeCount })}
        </p>
        <div className="desktop-incoming-changes-actions">
          <button
            className="desktop-incoming-changes-restore"
            type="button"
            onClick={review.restore}
          >
            {t("source-control.reach.incoming.reviewAgain")}
          </button>
        </div>
      </Region>
    );
  }

  return (
    <Region blocked={receipt.blocked}>
      <IncomingChangeHeading receipt={receipt} />
      <IncomingChangeFiles receipt={receipt} onReview={onReview} />
      {receipt.blocked && (
        <p className="desktop-incoming-changes-decision">
          {t("source-control.reach.incoming.needsDecision")}
        </p>
      )}
      {review.applyFailed && (
        <p className="desktop-incoming-changes-failure">
          {t("source-control.reach.incoming.applyFailed")}
        </p>
      )}
      <div className="desktop-incoming-changes-actions">
        <button
          className="desktop-incoming-changes-apply"
          type="button"
          aria-busy={review.applying || undefined}
          disabled={disabled || review.applying || !receipt.canApply}
          title={t(receipt.blocked
            ? "source-control.reach.incoming.applyBlocked"
            : "source-control.reach.incoming.applyTitle")}
          onClick={review.apply}
        >
          {review.applying
            ? t("source-control.reach.incoming.applying")
            : t("source-control.reach.incoming.apply")}
        </button>
        <button
          className="desktop-incoming-changes-set-aside"
          type="button"
          disabled={review.applying}
          title={t("source-control.reach.incoming.setAsideTitle")}
          onClick={review.setAside}
        >
          {t("source-control.reach.incoming.setAside")}
        </button>
      </div>
    </Region>
  );
}

function Region({ blocked = false, children }: Readonly<{
  blocked?: boolean;
  children: ReactNode;
}>) {
  const { t } = useLocalization();
  return (
    <div className="desktop-git-sync-priority-region">
      <aside
        className="desktop-incoming-changes"
        aria-label={t("source-control.reach.incoming.label")}
        data-blocked={blocked ? "true" : undefined}
        role="status"
        aria-live="polite"
      >
        {children}
      </aside>
    </div>
  );
}

function IncomingChangeHeading({ receipt }: Readonly<{ receipt: IncomingChangeReceipt }>) {
  const { t, formatDate, formatRelativeTime } = useLocalization();
  const when = formatChangeTime(receipt.changedAt, { formatDate, formatRelativeTime });
  return (
    <>
      <p className="desktop-incoming-changes-summary">
        {receipt.source
          ? t("source-control.reach.incoming.summary", {
            author: receipt.source,
            count: receipt.changeCount,
          })
          : t("source-control.reach.incoming.summaryAnonymous", { count: receipt.changeCount })}
      </p>
      <p className="desktop-incoming-changes-promise">
        {t("source-control.reach.incoming.untouched")}
      </p>
      {when && receipt.changedAt && (
        <time className="desktop-incoming-changes-time" dateTime={receipt.changedAt}>{when}</time>
      )}
      {receipt.localWorkWaiting && (
        <p className="desktop-incoming-changes-local">
          {t("source-control.reach.incoming.localWork")}
        </p>
      )}
    </>
  );
}

function IncomingChangeFiles({ receipt, onReview }: Readonly<{
  receipt: IncomingChangeReceipt;
  onReview: (file: IncomingChangeFile) => void;
}>) {
  const { t } = useLocalization();
  if (receipt.files.length === 0) return null;
  return (
    <ul className="desktop-incoming-changes-files">
      {receipt.files.map((file) => (
        <li key={file.path}>
          <button
            className="desktop-incoming-changes-file"
            type="button"
            title={t("source-control.reach.incoming.reviewFile", { path: file.path })}
            onClick={() => onReview(file)}
          >
            <span className="desktop-incoming-changes-file-letter" aria-hidden="true">{file.letter}</span>
            <span className="desktop-incoming-changes-file-path">{file.path}</span>
          </button>
        </li>
      ))}
      {receipt.additionalFiles > 0 && (
        <li className="desktop-incoming-changes-more">
          {t("source-control.reach.incoming.moreFiles", { count: receipt.additionalFiles })}
        </li>
      )}
    </ul>
  );
}

/**
 * Freshness is the point of the timestamp, so recent work reads as an age and
 * older work as a date. The Cloud surfaces format their own timestamps; sharing
 * that helper would couple this panel to a domain it must not depend on.
 */
export function formatChangeTime(
  iso: string | null,
  { formatDate, formatRelativeTime }: Pick<LocaleFormatters, "formatDate" | "formatRelativeTime">,
): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const elapsed = date.getTime() - Date.now();
  const absolute = Math.abs(elapsed);
  if (absolute < 60_000) return formatRelativeTime(0, "minute", { numeric: "auto" });
  if (absolute < 3_600_000) return formatRelativeTime(Math.round(elapsed / 60_000), "minute", { numeric: "auto" });
  if (absolute < 86_400_000) return formatRelativeTime(Math.round(elapsed / 3_600_000), "hour", { numeric: "auto" });
  if (absolute < 604_800_000) return formatRelativeTime(Math.round(elapsed / 86_400_000), "day", { numeric: "auto" });
  return formatDate(date, { month: "short", day: "numeric" });
}
