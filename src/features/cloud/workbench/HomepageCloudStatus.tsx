import { useLocalization } from "@puppyone/localization";
import type { ReactNode } from "react";
import { InlineLoading } from "../../../components/loading";
import { useCloudAuthController } from "../hooks/useCloudAuthController";
import type { DesktopCloudSession } from "../../../lib/cloudApi";
import type { AccountCloudWorkspace } from "./useAccountCloudWorkspace";

/** Global Homepage account affordance. It must never masquerade as a Project row. */
export function HomepageCloudStatus({ status, restoring, empty = false, apiBaseUrl, controller, session, onOpenAccount, onRetry }: {
  status: "signed-out" | "loading" | "ready" | "error";
  restoring: boolean;
  empty?: boolean;
  apiBaseUrl: string;
  controller: AccountCloudWorkspace;
  session: DesktopCloudSession | null;
  onOpenAccount: () => void;
  onRetry: () => void;
}) {
  const { t } = useLocalization();
  const auth = useCloudAuthController({ cloudApiBaseUrl: apiBaseUrl });
  const authError = status === "signed-out" ? auth.error : null;
  let feedback: ReactNode = null;
  // Project-opening progress and cancellation belong to the Homepage overlay.
  if (controller.opening) feedback = null;
  else if (controller.error || status === "error" || authError) feedback = <div className="homepage-cloud-feedback is-error" role="alert">
    <span>{authError ?? t(controller.error ? "cloud.catalog.openFailed" : "cloud.catalog.loadFailed")}</span>
    <button type="button" className="desktop-cloud-row-action" onClick={() => {
      if (authError) auth.startSignIn();
      else if (controller.error) void controller.retry();
      else onRetry();
    }}>{t("cloud.common.retry")}</button>
  </div>;
  else if (restoring || status === "loading" || (!session && auth.signingIn)) feedback = <div className="homepage-cloud-feedback" role="status">
    <InlineLoading label={t(auth.signingIn ? "cloud.home.waitingForSignIn" : "cloud.home.loading")} size="xs" tone="neutral" />
  </div>;
  else if (empty && session) feedback = <span className="homepage-cloud-feedback">{t("cloud.catalog.empty")}</span>;

  return <div className="homepage-cloud-account">
    {feedback}
    {!restoring && (session ? <button type="button" className="desktop-titlebar-action homepage-cloud-avatar"
      aria-label={`${t("settings.sidebar.account")}: ${session.user_email}`} onClick={onOpenAccount}>
      <span aria-hidden="true">{Array.from(session.user_email.trim())[0]?.toLocaleUpperCase() || "P"}</span>
    </button> : <button type="button" className="desktop-titlebar-action homepage-cloud-sign-in"
      aria-label={t("cloud.auth.signInToCloud")} disabled={auth.signingIn} onClick={auth.startSignIn}>
      {t("cloud.auth.signIn")}
    </button>)}
  </div>;
}
