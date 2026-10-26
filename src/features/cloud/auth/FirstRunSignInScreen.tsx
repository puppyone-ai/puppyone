import { useLocalization } from "@puppyone/localization";
import type { ResolvedSurfaceAppearance } from "../../appearance/AppearanceRuntime";
import { DesktopWindowChrome } from "../../../components/DesktopWindowChrome";
import { PuppyBrandMark } from "../../../components/brand/PuppyBrandMark";
import { OnboardingTelemetryDisclosure } from "../../../components/onboarding/OnboardingTelemetryDisclosure";
import { InlineLoading } from "../../../components/loading";
import { useCloudAuthController } from "../hooks/useCloudAuthController";
import "./first-run-sign-in.css";

export function FirstRunSignInScreen({ appearance, apiBaseUrl, onContinueLocally }: {
  appearance: ResolvedSurfaceAppearance;
  apiBaseUrl: string;
  onContinueLocally: () => void;
}) {
  const { t } = useLocalization();
  const auth = useCloudAuthController({ cloudApiBaseUrl: apiBaseUrl });
  const resolvedTheme = appearance.appearance.effectiveColorMode;

  return <main className={`onboarding-shell first-run-sign-in-shell ${resolvedTheme === "dark" ? "dark" : ""}`}
    {...appearance.rootProps}>
    <DesktopWindowChrome actions={<button type="button" className="desktop-titlebar-action homepage-cloud-sign-in"
      aria-label={t("cloud.auth.signInToCloud")} onClick={auth.startSignIn}>
      {t("cloud.auth.signIn")}
    </button>} />
    <section className="first-run-sign-in" aria-label={t("cloud.auth.signInToCloud")}>
      <PuppyBrandMark className="first-run-sign-in-mark" tone={resolvedTheme === "dark" ? "dark" : "lite"} />
      <h1>{t("shell.brand.name")}</h1>
      <p className="first-run-sign-in-description">{t("cloud.auth.signInToCloud")}</p>
      <div className="first-run-sign-in-actions">
        <button type="button" className="desktop-dialog-button primary first-run-sign-in-submit"
          // Stays available while waiting: asking again reopens the browser page.
          onClick={auth.startSignIn}>
          {t("cloud.auth.signIn")}
        </button>
        <button type="button" className="desktop-dialog-button first-run-sign-in-skip" onClick={onContinueLocally}>
          {t("onboarding.action.continueLocally")}
        </button>
      </div>
      {auth.signingIn && <div className="first-run-sign-in-feedback" role="status">
        <InlineLoading label={t("cloud.auth.desktopWaiting")} size="xs" tone="neutral" />
      </div>}
      {auth.error && <p className="first-run-sign-in-feedback is-error" role="alert">{auth.error}</p>}
    </section>
    <OnboardingTelemetryDisclosure ready />
  </main>;
}
