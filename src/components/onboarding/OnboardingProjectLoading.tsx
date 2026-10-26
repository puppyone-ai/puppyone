import { useEffect, useRef } from "react";
import { useLocalization } from "@puppyone/localization";
import { LoadingMark } from "@puppyone/shared-ui";

/** Native folder selection keeps its own feedback until a project is selected. */
export function isHomepageProjectOpening(openingPath: string | null, cloudOpening: boolean) {
  return cloudOpening || Boolean(openingPath && openingPath !== "__new__");
}

/** Page-level feedback while the selected project's opening request is pending. */
export function OnboardingProjectLoading({ open, cloudOpening, onCancel }: {
  open: boolean;
  cloudOpening: boolean;
  onCancel?: () => void;
}) {
  return open ? <ProjectLoadingOverlay onCancel={cloudOpening ? onCancel : undefined} /> : null;
}

function ProjectLoadingOverlay({ onCancel }: { onCancel?: () => void }) {
  const { t } = useLocalization();
  const overlayRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef(document.activeElement);

  useEffect(() => {
    const previousFocus = previousFocusRef.current;
    overlayRef.current?.focus({ preventScroll: true });
    return () => {
      if (!(previousFocus instanceof HTMLElement)) return;
      queueMicrotask(() => {
        if (previousFocus.isConnected && document.activeElement === document.body) {
          previousFocus.focus({ preventScroll: true });
        }
      });
    };
  }, []);

  return <div ref={overlayRef} className="onboarding-project-loading" role="status"
    aria-live="polite" aria-atomic="true" tabIndex={-1}
    aria-label={t("onboarding.status.loadingProject")}
    onKeyDown={(event) => {
      if (event.key === "Escape" && onCancel) {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      }
    }}>
    <div className="onboarding-project-loading-content">
      <LoadingMark layout="area" size="md" tone="neutral" ariaHidden />
      <p>{t("onboarding.status.loadingProject")}</p>
      {onCancel && <button type="button" className="desktop-dialog-button"
        onClick={onCancel}>{t("common.action.cancel")}</button>}
    </div>
  </div>;
}
