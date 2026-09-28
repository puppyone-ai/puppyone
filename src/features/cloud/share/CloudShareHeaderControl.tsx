import { useLocalization } from "@puppyone/localization/react";
import { Cloud } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import type { ProjectCloudContext } from "../project/context/projectCloudContext";
import { CloudProjectLocationCard, projectLocationBadge } from "./CloudProjectLocationCard";
import { CloudSharePopover } from "./CloudSharePopover";
import { resolveProjectLocationStatus } from "./projectLocationStatus";
import "./share.css";

/**
 * The Header cloud control reports where the current project is available.
 * Its project-location menu opens only after an explicit click.
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
  const status = resolveProjectLocationStatus(projectContext, signedIn);
  const locationLabel = projectLocationBadge(status, t);
  const ariaLabel = `${t("cloud.share.location.title")} · ${locationLabel}`;

  const dismiss = useCallback(() => {
    setOpen(false);
  }, []);
  const handleShare = useCallback(() => {
    dismiss();
    onShare();
  }, [dismiss, onShare]);
  return (
    <div className="desktop-titlebar-share-wrap" ref={wrapRef}>
      <button
        type="button"
        className="desktop-titlebar-action desktop-titlebar-cloud desktop-titlebar-share"
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-project-location={status.kind}
        onClick={() => setOpen((current) => !current)}
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
        onDismiss={dismiss}
      >
        <CloudProjectLocationCard status={status} onShare={handleShare} />
      </CloudSharePopover>
    </div>
  );
}
