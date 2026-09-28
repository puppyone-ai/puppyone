import { useLocalization } from "@puppyone/localization/react";
import { Cloud } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ProjectCloudContext } from "../project/context/projectCloudContext";
import { CloudProjectLocationCard, projectLocationBadge } from "./CloudProjectLocationCard";
import { CloudSharePopover } from "./CloudSharePopover";
import { resolveProjectLocationStatus } from "./projectLocationStatus";
import "./share.css";

const HOVER_OPEN_DELAY_MS = 150;
const HOVER_CLOSE_DELAY_MS = 200;

/**
 * The Header cloud control reports where the current project is available.
 * Authentication and sharing details live in their own Cloud surfaces.
 */
export function CloudShareHeaderControl({
  projectContext,
  signedIn,
  onShare,
}: {
  projectContext: ProjectCloudContext;
  signedIn: boolean;
  onShare: () => void;
}) {
  const { t } = useLocalization();
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | null>(null);
  const status = resolveProjectLocationStatus(projectContext, signedIn);
  const locationLabel = projectLocationBadge(status, t);
  const ariaLabel = `${t("cloud.share.location.title")} · ${locationLabel}`;

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
  const handleShare = useCallback(() => {
    dismiss();
    onShare();
  }, [dismiss, onShare]);
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
        data-project-location={status.kind}
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
        <span className="desktop-titlebar-share-label" aria-hidden="true">{locationLabel}</span>
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
        <CloudProjectLocationCard status={status} onShare={handleShare} />
      </CloudSharePopover>
    </div>
  );
}
