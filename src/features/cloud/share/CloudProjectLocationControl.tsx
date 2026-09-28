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
 * Project-context control that reports where the current project's files are
 * available. Hover previews the location; clicking opens Project management.
 */
export function CloudProjectLocationControl({
  projectContext,
  signedIn,
  onOpenProject,
}: {
  projectContext: ProjectCloudContext;
  signedIn: boolean;
  onOpenProject: () => void;
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
  const handleOpenProject = useCallback(() => {
    suppressPreviewUntilLeaveRef.current = true;
    dismiss();
    onOpenProject();
  }, [dismiss, onOpenProject]);

  useEffect(() => () => {
    if (dismissTimerRef.current !== null) window.clearTimeout(dismissTimerRef.current);
  }, []);

  return (
    <div
      className="desktop-titlebar-project-location-wrap"
      ref={wrapRef}
      onPointerEnter={showPreview}
      onPointerLeave={scheduleDismiss}
    >
      <button
        type="button"
        className="desktop-titlebar-context-icon-button desktop-titlebar-project-location"
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-project-location={status.kind}
        onClick={handleOpenProject}
      >
        <span className="desktop-titlebar-project-location-glyph" aria-hidden="true">
          <ProjectLocationGlyph status={status} className="desktop-titlebar-project-location-status-icon" />
          <span className="desktop-titlebar-project-location-dot" />
        </span>
      </button>

      <CloudSharePopover
        anchorRef={wrapRef}
        ariaLabel={ariaLabel}
        open={open}
        onDismiss={dismiss}
        onPointerEnter={showPreview}
        onPointerLeave={scheduleDismiss}
      >
        <CloudProjectLocationCard status={status} />
      </CloudSharePopover>
    </div>
  );
}
