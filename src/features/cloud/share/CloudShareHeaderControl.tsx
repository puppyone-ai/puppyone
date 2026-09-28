import { useLocalization } from "@puppyone/localization/react";
import { Cloud } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ProjectCloudContext } from "../project/context/projectCloudContext";
import { CloudSharePopover } from "./CloudSharePopover";
import { CloudShareStatusCard, shareStatusBadge, shareStatusHeadline } from "./CloudShareStatusCard";
import { resolveCloudShareStatus, type PendingShare } from "./shareStatus";
import type { ProjectSharesState } from "./useProjectShares";
import "./share.css";

const HOVER_OPEN_DELAY_MS = 150;
const HOVER_CLOSE_DELAY_MS = 200;

/**
 * The Header cloud control is a status indicator first: glyph, dot, and a
 * one-word label. Hovering reveals the read-only status card and a click pins
 * it. The card's single button is the only action: it opens the Share dialog,
 * or the Cloud panel when the project needs attention.
 */
export function CloudShareHeaderControl({
  projectContext,
  shares,
  signedIn,
  pending,
  onOpenShare,
  onOpenCloud,
}: {
  projectContext: ProjectCloudContext;
  shares: ProjectSharesState;
  signedIn: boolean;
  pending: PendingShare | null;
  onOpenShare: () => void;
  onOpenCloud: () => void;
}) {
  const { t } = useLocalization();
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | null>(null);
  const status = resolveCloudShareStatus({
    context: projectContext,
    shares: shares.shares,
    sharesLoaded: shares.loaded || shares.error,
    signedIn,
    pending,
  });
  const ariaLabel = `${t("cloud.productName")} · ${shareStatusHeadline(status, t)}`;

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);
  const scheduleOpen = useCallback(() => {
    clearTimer();
    timerRef.current = window.setTimeout(() => setOpen(true), HOVER_OPEN_DELAY_MS);
  }, [clearTimer]);
  const scheduleClose = useCallback(() => {
    clearTimer();
    if (pinned) return;
    timerRef.current = window.setTimeout(() => setOpen(false), HOVER_CLOSE_DELAY_MS);
  }, [clearTimer, pinned]);
  const dismiss = useCallback(() => {
    clearTimer();
    setPinned(false);
    setOpen(false);
  }, [clearTimer]);
  useEffect(() => clearTimer, [clearTimer]);

  return (
    <div
      className="desktop-titlebar-share-wrap"
      ref={wrapRef}
      onPointerEnter={scheduleOpen}
      onPointerLeave={scheduleClose}
    >
      <button
        type="button"
        className="desktop-titlebar-action desktop-titlebar-cloud desktop-titlebar-share"
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-share-state={status.kind}
        onClick={() => {
          clearTimer();
          if (pinned) {
            dismiss();
            return;
          }
          setPinned(true);
          setOpen(true);
        }}
      >
        <span className="desktop-titlebar-share-glyph" aria-hidden="true">
          <Cloud size={15} strokeWidth={1.8} />
          <span className="desktop-titlebar-share-dot" />
        </span>
        <span className="desktop-titlebar-share-label" aria-hidden="true">{shareStatusBadge(status, t)}</span>
      </button>

      <CloudSharePopover
        anchorRef={wrapRef}
        ariaLabel={ariaLabel}
        open={open}
        pinned={pinned}
        onDismiss={dismiss}
        onPointerEnter={clearTimer}
        onPointerLeave={scheduleClose}
      >
        <CloudShareStatusCard
          status={status}
          surface="popover"
          onPrimary={() => {
            dismiss();
            if (status.kind === "attention") onOpenCloud();
            else onOpenShare();
          }}
        />
      </CloudSharePopover>
    </div>
  );
}
