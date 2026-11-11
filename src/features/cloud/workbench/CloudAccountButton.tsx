import { useLocalization } from "@puppyone/localization";
import { useCloudAuthController } from "../hooks/useCloudAuthController";

/**
 * "Sign in" at the trailing end of the Header while no account is signed in.
 * Signed in, the account is reached from the Header's leading place menu.
 */
export function HeaderSignInButton({ apiBaseUrl }: { apiBaseUrl: string }) {
  const { t } = useLocalization();
  const auth = useCloudAuthController({ cloudApiBaseUrl: apiBaseUrl });
  // Stays available while waiting: asking again reopens the browser page.
  return <button type="button" className="desktop-titlebar-action homepage-cloud-sign-in"
    aria-label={t("cloud.auth.signInToCloud")} onClick={auth.startSignIn}>
    {t("cloud.auth.signIn")}
  </button>;
}
