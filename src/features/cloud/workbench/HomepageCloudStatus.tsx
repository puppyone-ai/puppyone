import { useLocalization } from "@puppyone/localization";
import type { ReactNode } from "react";
import { InlineLoading } from "../../../components/loading";
import { useCloudAuthController } from "../hooks/useCloudAuthController";
import type { DesktopCloudSession } from "../../../lib/cloudApi";
import type { AccountCloudWorkspace } from "./useAccountCloudWorkspace";
import { formatCloudMessage } from "../cloudPresentation";
import { CloudAccountButton } from "./CloudAccountButton";

function HomepageCloudFailure({ controller, authError, onSignIn, onOpenAccount, onRetry }: {
  controller: AccountCloudWorkspace;
  authError: string | null;
  onSignIn: () => void;
  onOpenAccount: () => void;
  onRetry: () => void;
}) {
  const { t } = useLocalization();
  const message = controller.failure ? formatCloudMessage(controller.failure.message, t)
    : t(controller.error ? "cloud.catalog.openFailed" : "cloud.catalog.loadFailed");
  return <div className="homepage-cloud-feedback is-error" role="alert">
    <span>{authError ?? message}</span>
    {(authError || controller.failure?.action !== "none") && <button type="button" className="desktop-cloud-row-action" onClick={() => {
      if (authError) onSignIn();
      else if (controller.failure?.action === "account") onOpenAccount();
      else if (controller.error) void controller.retry();
      else onRetry();
    }}>{t(!authError && controller.failure?.action === "account" ? "settings.sidebar.account" : "cloud.common.retry")}</button>}
  </div>;
}

/** Global Homepage account affordance. It must never masquerade as a Project row. */
export function HomepageCloudStatus({ status, restoring, empty = false, apiBaseUrl, controller, session, onOpenAccount, onRetry, showAccountButton = true }: {
  status: "signed-out" | "loading" | "ready" | "error";
  restoring: boolean;
  empty?: boolean;
  apiBaseUrl: string;
  controller: AccountCloudWorkspace;
  session: DesktopCloudSession | null;
  onOpenAccount: () => void;
  onRetry: () => void;
  showAccountButton?: boolean;
}) {
  const { t } = useLocalization();
  const auth = useCloudAuthController({ cloudApiBaseUrl: apiBaseUrl });
  const authError = status === "signed-out" ? auth.error : null;
  let feedback: ReactNode = null;
  // Project-opening progress and cancellation belong to the Homepage overlay.
  if (controller.opening) feedback = null;
  else if (controller.error || status === "error" || authError) feedback = <HomepageCloudFailure controller={controller}
    authError={authError} onSignIn={auth.startSignIn} onOpenAccount={onOpenAccount} onRetry={onRetry} />;
  else if (restoring || status === "loading" || (!session && auth.signingIn)) feedback = <div className="homepage-cloud-feedback" role="status">
    <InlineLoading label={t(auth.signingIn ? "cloud.home.waitingForSignIn" : "cloud.home.loading")} size="xs" tone="neutral" />
  </div>;
  else if (empty && session) feedback = <span className="homepage-cloud-feedback">{t("cloud.catalog.empty")}</span>;

  return <div className="homepage-cloud-account">
    {feedback}
    {showAccountButton && !restoring && <CloudAccountButton session={session} onSignIn={auth.startSignIn} onOpenAccount={onOpenAccount} />}
  </div>;
}
