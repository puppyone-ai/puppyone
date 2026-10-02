import { ArrowUpRight, Cloud, LoaderCircle } from "lucide-react";
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
    <section className="desktop-cloud-sign-in-cta" aria-busy={signingIn}>
      <div className="desktop-cloud-sign-in-mark" aria-hidden="true">
        <Cloud size={24} strokeWidth={1.6} />
      </div>
      <div className="desktop-cloud-sign-in-copy">
        <h2>{t("cloud.auth.desktopTitle")}</h2>
        <p>{t("cloud.auth.desktopDescription")}</p>
      </div>
      <div className="desktop-cloud-sign-in-actions">
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
        <p className="desktop-cloud-sign-in-hint" aria-live="polite">
          {t(signingIn ? "cloud.auth.desktopWaitingHint" : "cloud.auth.desktopBrowserHint")}
        </p>
      </div>
      {error && (
        <p className="desktop-cloud-sign-in-error" role="alert">{error}</p>
      )}
    </section>
  );
}
