import { LogIn } from "lucide-react";
import { useLocalization } from "@puppyone/localization/react";
import "./cloud-auth-card.css";

export function CloudAuthCard({
  signingIn,
  error,
  onSignIn,
}: {
  signingIn: boolean;
  error: string | null;
  onSignIn: () => void;
}) {
  const { t } = useLocalization();

  return (
    <div className="desktop-cloud-auth-card">
      <button
        className="desktop-cloud-auth-submit"
        type="button"
        disabled={signingIn}
        onClick={onSignIn}
      >
        <LogIn size={15} />
        <span>{t(signingIn ? "cloud.auth.signingIn" : "cloud.auth.signInToCloud")}</span>
      </button>

      {error && (
        <div className="desktop-cloud-auth-feedback">
          <div className="error">{error}</div>
        </div>
      )}
      <p className="desktop-cloud-auth-terms">{t("cloud.auth.terms")}</p>
    </div>
  );
}

export function CloudProductMark() {
  return (
    <svg className="desktop-cloud-product-mark" viewBox="0 0 160 100" aria-hidden="true" focusable="false">
      <path
        className="desktop-cloud-product-mark-cloud"
        d="M43.8 76.5h72.6c14.4 0 26.1-11.1 26.1-24.8 0-13.6-11.4-24.6-25.6-24.9C111.2 13.8 98.1 5.5 83.5 7.1 67.3 8.8 54.2 21.1 51.2 37.2h-6.8c-15.5 0-27.9 11.1-27.9 24.6 0 9.6 9.3 14.7 27.3 14.7Z"
      />
    </svg>
  );
}
