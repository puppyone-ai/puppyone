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
      hint={t(signingIn ? "cloud.auth.desktopWaitingHint" : "cloud.auth.desktopBrowserHint")}
      supplemental={error && <p className="desktop-cloud-sign-in-error" role="alert">{error}</p>}
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
          <span>{t(signingIn ? "cloud.auth.desktopWaiting" : "cloud.auth.desktopContinue")}</span>
        </button>
      }
    />
  );
}
