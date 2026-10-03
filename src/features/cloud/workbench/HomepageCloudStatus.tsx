import { Cloud } from "lucide-react";
import { useLocalization } from "@puppyone/localization";
import { InlineLoading } from "../../../components/loading";
import { useCloudAuthController } from "../hooks/useCloudAuthController";
import type { AccountCloudWorkspace } from "./useAccountCloudWorkspace";

/** Global Homepage account affordance. It must never masquerade as a Project row. */
export function HomepageCloudStatus({ status, restoring, empty = false, apiBaseUrl, controller, onRetry }: {
  status: "signed-out" | "loading" | "ready" | "error";
  restoring: boolean;
  empty?: boolean;
  apiBaseUrl: string;
  controller: AccountCloudWorkspace;
  onRetry: () => void;
}) {
  const { t } = useLocalization();
  const auth = useCloudAuthController({ cloudApiBaseUrl: apiBaseUrl });
  const authError = status === "signed-out" ? auth.error : null;
  if (controller.opening) return <div className="homepage-cloud-account" role="status">
    <InlineLoading label={t("onboarding.status.opening")} size="xs" tone="neutral" />
    <button type="button" className="desktop-cloud-row-action" onClick={controller.cancel}>{t("common.action.cancel")}</button>
  </div>;
  if (controller.error || status === "error" || authError) return <div className="homepage-cloud-account is-error" role="alert">
    <span>{authError ?? t(controller.error ? "cloud.catalog.openFailed" : "cloud.catalog.loadFailed")}</span>
    <button type="button" className="desktop-cloud-row-action" onClick={() => {
      if (authError) auth.startSignIn();
      else if (controller.error) void controller.retry();
      else onRetry();
    }}>{t("cloud.common.retry")}</button>
  </div>;
  if (restoring || status === "loading" || (status === "signed-out" && auth.signingIn)) return <div className="homepage-cloud-account" role="status">
    <InlineLoading label={t(auth.signingIn ? "cloud.home.waitingForSignIn" : "cloud.home.loading")} size="xs" tone="neutral" />
  </div>;
  if (status === "signed-out") return <button type="button" className="homepage-cloud-account homepage-cloud-sign-in"
    aria-label={t("cloud.auth.signInToCloud")} onClick={auth.startSignIn}>
    <Cloud size={14} aria-hidden="true" /><span>{t("cloud.auth.signIn")}</span>
  </button>;
  return empty ? <p className="homepage-cloud-account">{t("cloud.catalog.empty")}</p> : null;
}
