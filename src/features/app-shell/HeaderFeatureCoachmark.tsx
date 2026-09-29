import { useEffect, useId, useRef, type CSSProperties, type ReactNode } from "react";
import { useLocalization } from "@puppyone/localization";
import { Button } from "@puppyone/shared-ui";
import { DesktopMenuSurface } from "../../components/DesktopMenu";
import { DesktopOverlayLayer } from "./DesktopOverlayPortal";
import { AgentEntryIcon } from "./AgentEntryIcon";
import { useAnchoredOverlayPosition } from "./useAnchoredOverlayPosition";
import { VersionControlIcon } from "../source-control/VersionControlIcon";
import type { HeaderCoachmarkId } from "./headerCoachmarks";

const COACHMARK_WIDTH = 320;
const COACHMARK_MAX_HEIGHT = 240;

export function HeaderFeatureCoachmark({
  children,
  feature,
  onDismiss,
  onPrimary,
  open,
}: {
  children: ReactNode;
  feature: HeaderCoachmarkId;
  onDismiss: () => void;
  onPrimary: () => void;
  open: boolean;
}) {
  const { t } = useLocalization();
  const FeatureIcon = feature === "agent" ? AgentEntryIcon : VersionControlIcon;
  const anchorRef = useRef<HTMLSpanElement>(null);
  const titleId = useId();
  const bodyId = useId();
  const { overlayRef, setOverlayRef, overlayPosition } = useAnchoredOverlayPosition({
    open,
    anchorRef,
    preferredWidth: COACHMARK_WIDTH,
    preferredMaxHeight: COACHMARK_MAX_HEIGHT,
    gap: 10,
    margin: 8,
    alignment: "end",
    placementPreference: "below",
  });

  useEffect(() => {
    if (!open) return undefined;
    const isInside = (target: EventTarget | null) => target instanceof Node && Boolean(
      anchorRef.current?.contains(target) || overlayRef.current?.contains(target),
    );
    const dismissOnPointerDown = (event: PointerEvent) => {
      if (!isInside(event.target)) onDismiss();
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      onDismiss();
      anchorRef.current?.querySelector<HTMLElement>("button")?.focus();
    };
    document.addEventListener("pointerdown", dismissOnPointerDown, true);
    document.addEventListener("keydown", dismissOnEscape, true);
    return () => {
      document.removeEventListener("pointerdown", dismissOnPointerDown, true);
      document.removeEventListener("keydown", dismissOnEscape, true);
    };
  }, [anchorRef, onDismiss, open, overlayRef]);

  const style: CSSProperties = overlayPosition
    ? {
        left: overlayPosition.left,
        top: overlayPosition.top,
        width: overlayPosition.width,
        maxHeight: overlayPosition.maxHeight,
      }
    : {
        left: 0,
        top: 0,
        width: COACHMARK_WIDTH,
        maxHeight: COACHMARK_MAX_HEIGHT,
        visibility: "hidden",
        pointerEvents: "none",
      };

  return (
    <span
      ref={anchorRef}
      className="desktop-header-coachmark-anchor"
      data-coachmark-active={open || undefined}
      data-coachmark-feature={feature}
    >
      {children}
      {open && (
        <DesktopOverlayLayer>
          <DesktopMenuSurface
            ref={setOverlayRef}
            role="dialog"
            aria-labelledby={titleId}
            aria-describedby={bodyId}
            className="desktop-titlebar-menu desktop-titlebar-menu-overlay desktop-header-coachmark"
            data-coachmark-feature={feature}
            typographySurface="header"
            style={style}
          >
            <div className="desktop-header-coachmark-intro">
              <span className="desktop-header-coachmark-glyph" aria-hidden="true">
                <FeatureIcon size={17} strokeWidth={1.9} />
              </span>
              <div className="desktop-header-coachmark-copy">
                <strong id={titleId}>{t(`shell.coachmark.${feature}.title`)}</strong>
                <p id={bodyId}>{t(`shell.coachmark.${feature}.body`)}</p>
              </div>
            </div>
            <div className="desktop-header-coachmark-actions">
              <Button tone="neutral" className="desktop-header-coachmark-button" onClick={onDismiss}>
                {t(`shell.coachmark.${feature}.dismiss`)}
              </Button>
              <Button tone="primary" className="desktop-header-coachmark-button" onClick={onPrimary}>
                {t(`shell.coachmark.${feature}.primary`)}
              </Button>
            </div>
          </DesktopMenuSurface>
        </DesktopOverlayLayer>
      )}
    </span>
  );
}
