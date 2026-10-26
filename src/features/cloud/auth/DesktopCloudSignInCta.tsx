import { ArrowUpRight, LoaderCircle } from "lucide-react";
import { CloudProjectActivation } from "../components/CloudProjectActivation";
import { useLocalization } from "@puppyone/localization/react";
import "./desktop-cloud-sign-in-cta.css";

/** The Desktop handoff to the existing browser sign-in flow. */
export function DesktopCloudSignInCta({ signingIn, error, onSignIn }: {
  signingIn: boolean;
  error: string | null;
  onSignIn: () => void;
}) {
  const { t } = useLocalization();
  return (
    <CloudProjectActivation busy={signingIn}
      supplemental={error ? <p className="desktop-cloud-sign-in-error" role="alert">{error}</p>
        // The browser page is the only way to finish; closing it must not
        // leave the user waiting on a disabled button.
        : signingIn && <p className="desktop-cloud-sign-in-reopen">
          <span>{t("cloud.auth.desktopReopenHint")}</span>
          <button type="button" className="desktop-cloud-sign-in-reopen-action" onClick={onSignIn}>
            {t("cloud.auth.desktopReopen")}
          </button>
        </p>}
      action={
        <button
          className="desktop-dialog-button primary desktop-cloud-sign-in-button"
          data-cloud-sign-in-action="true"
          data-desktop-dialog-initial-focus="true"
          type="button"
          disabled={signingIn}
          onClick={onSignIn}
        >
          {signingIn
            ? <LoaderCircle size={14} className="desktop-dialog-spinner" aria-hidden="true" />
            : <ArrowUpRight size={14} aria-hidden="true" />}
          <span role="status" aria-live="polite">{t(signingIn ? "cloud.auth.desktopWaiting" : "cloud.auth.desktopContinue")}</span>
        </button>
      }
    />
  );
}
