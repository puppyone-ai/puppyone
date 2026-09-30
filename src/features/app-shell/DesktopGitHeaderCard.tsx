import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { useLocalization } from "@puppyone/localization";
import { DesktopTitlebarMenuLayer } from "./DesktopTitlebarMenuLayer";

export const GIT_HEADER_CARD_ID = "desktop-git-header-card";

export function DesktopGitHeaderCard({
  anchorRef,
  open,
  surface,
  onDismiss,
  changes,
  history,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  surface: "changes" | "history";
  onDismiss: () => void;
  changes: ReactNode;
  history: ReactNode;
}) {
  const { t } = useLocalization();
  const changesRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  const previousSurface = useRef(surface);
  useEffect(() => {
    if (open && previousSurface.current !== surface) {
      const activeSurface = surface === "changes" ? changesRef.current : historyRef.current;
      activeSurface?.querySelector<HTMLElement>(".desktop-git-view-header button:not([disabled])")
        ?.focus({ preventScroll: true });
    }
    previousSurface.current = surface;
  }, [open, surface]);
  return (
    <DesktopTitlebarMenuLayer
      anchorRef={anchorRef}
      open={open}
      onDismiss={onDismiss}
      className="desktop-git-header-card"
      alignment="center"
      preferredWidth={360}
      preferredMaxHeight={560}
      role="dialog"
      id={GIT_HEADER_CARD_ID}
      ariaLabel={t("source-control.label.changes")}
    >
      <div ref={changesRef} className="desktop-git-header-card-surface" hidden={surface !== "changes"}>
        {changes}
      </div>
      <div ref={historyRef} className="desktop-git-header-card-surface" hidden={surface !== "history"}>
        {history}
      </div>
    </DesktopTitlebarMenuLayer>
  );
}
