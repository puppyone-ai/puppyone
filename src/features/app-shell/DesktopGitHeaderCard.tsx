import type { ReactNode, RefObject } from "react";
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
      <div className="desktop-git-header-card-surface" hidden={surface !== "changes"}>
        {changes}
      </div>
      <div className="desktop-git-header-card-surface" hidden={surface !== "history"}>
        {history}
      </div>
    </DesktopTitlebarMenuLayer>
  );
}
