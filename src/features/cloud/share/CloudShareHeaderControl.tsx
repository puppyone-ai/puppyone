import { useLocalization } from "@puppyone/localization/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ProjectCloudContext } from "../project/context/projectCloudContext";
import {
  CloudProjectLocationCard,
  ProjectLocationGlyph,
  projectLocationBadge,
} from "./CloudProjectLocationCard";
import { CloudSharePopover } from "./CloudSharePopover";
import { resolveProjectLocationStatus } from "./projectLocationStatus";
import "./share.css";

/**
 * The Header cloud control reports where the current project is available.
 * Hover previews that location; clicking enters the full Cloud / Share flow.
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
  const wrapRef = useRef<HTMLDivElement>(null);
  const dismissTimerRef = useRef<number | null>(null);
  const suppressPreviewUntilLeaveRef = useRef(false);
  const status = resolveProjectLocationStatus(projectContext, signedIn);
  const locationLabel = projectLocationBadge(status, t);
  const ariaLabel = `${t("cloud.share.location.title")} · ${locationLabel}`;

  const dismiss = useCallback(() => {
    if (dismissTimerRef.current !== null) {
      window.clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
    setOpen(false);
  }, []);
  const showPreview = useCallback(() => {
    if (suppressPreviewUntilLeaveRef.current) return;
    if (dismissTimerRef.current !== null) {
      window.clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
    setOpen(true);
  }, []);
  const scheduleDismiss = useCallback(() => {
    suppressPreviewUntilLeaveRef.current = false;
    if (dismissTimerRef.current !== null) window.clearTimeout(dismissTimerRef.current);
    dismissTimerRef.current = window.setTimeout(() => {
      dismissTimerRef.current = null;
      setOpen(false);
    }, 120);
  }, []);
  const handleShare = useCallback(() => {
    suppressPreviewUntilLeaveRef.current = true;
    dismiss();
    onShare();
  }, [dismiss, onShare]);

  useEffect(() => () => {
    if (dismissTimerRef.current !== null) window.clearTimeout(dismissTimerRef.current);
  }, []);

  return (
    <div
      className="desktop-titlebar-share-wrap"
      ref={wrapRef}
      onPointerEnter={showPreview}
      onPointerLeave={scheduleDismiss}
    >
      <button
        type="button"
        className="desktop-titlebar-action desktop-titlebar-cloud desktop-titlebar-share"
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-project-location={status.kind}
        onClick={handleShare}
        onFocus={showPreview}
      >
        <span className="desktop-titlebar-share-glyph" aria-hidden="true">
          <ProjectLocationGlyph status={status} className="desktop-titlebar-share-status-icon" />
          <span className="desktop-titlebar-share-dot" />
        </span>
        <span className="desktop-titlebar-share-label" aria-hidden="true">{locationLabel}</span>
      </button>

      <CloudSharePopover
        anchorRef={wrapRef}
        ariaLabel={ariaLabel}
        open={open}
        onDismiss={dismiss}
        onPointerEnter={showPreview}
        onPointerLeave={scheduleDismiss}
      >
        <CloudProjectLocationCard status={status} onShare={handleShare} />
      </CloudSharePopover>
    </div>
  );
}
