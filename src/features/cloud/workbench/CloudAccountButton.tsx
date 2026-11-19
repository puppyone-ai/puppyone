import { useLocalization } from "@puppyone/localization";
import { useWindowNavigation } from "../../../components/WindowNavigation";
import { CloudSignInDialog, openCloudSignInDialog } from "../auth";

/**
 * "Sign in" at the trailing end of the Header while no account is signed in.
 * Signed in, the account is reached from the Header's leading place menu.
 */
export function HeaderSignInButton({ apiBaseUrl }: { apiBaseUrl: string }) {
  const { t } = useLocalization();
  const hasNavigationAccount = Boolean(useWindowNavigation()?.account);
  return <>
    <button type="button" className="desktop-titlebar-action homepage-cloud-sign-in"
      aria-label={t("cloud.auth.signInToCloud")} onClick={() => openCloudSignInDialog(apiBaseUrl)}>
      {t("cloud.auth.signIn")}
    </button>
    {!hasNavigationAccount && <CloudSignInDialog />}
  </>;
}
