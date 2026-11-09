import { useLocalization } from "@puppyone/localization";
import { useCloudAuthController } from "../hooks/useCloudAuthController";
import type { DesktopCloudSession } from "../../../lib/cloudApi";

/**
 * The account in the Header: "Sign in" when signed out, otherwise the account's
 * initial, which opens Settings → Account, where the plan and the AI balance
 * are topped up. The same control on the Homepage and inside every project, so
 * the way to pay is always one click from wherever someone is working.
 */
export function CloudAccountButton({ session, onSignIn, onOpenAccount }: {
  session: DesktopCloudSession | null;
  onSignIn: () => void;
  onOpenAccount: () => void;
}) {
  const { t } = useLocalization();
  if (session) {
    return <button type="button" className="desktop-titlebar-action homepage-cloud-avatar"
      aria-label={`${t("settings.sidebar.account")}: ${session.user_email}`} onClick={onOpenAccount}>
      <span aria-hidden="true">{Array.from(session.user_email.trim())[0]?.toLocaleUpperCase() || "P"}</span>
    </button>;
  }
  // Stays available while waiting: asking again reopens the browser page.
  return <button type="button" className="desktop-titlebar-action homepage-cloud-sign-in"
    aria-label={t("cloud.auth.signInToCloud")} onClick={onSignIn}>
    {t("cloud.auth.signIn")}
  </button>;
}

/** The project Header's account control, with its own sign-in flow. */
export function ProjectHeaderAccount({ session, apiBaseUrl, onOpenAccount }: {
  session: DesktopCloudSession | null;
  apiBaseUrl: string;
  onOpenAccount: () => void;
}) {
  const auth = useCloudAuthController({ cloudApiBaseUrl: apiBaseUrl });
  return <CloudAccountButton session={session} onSignIn={auth.startSignIn} onOpenAccount={onOpenAccount} />;
}
