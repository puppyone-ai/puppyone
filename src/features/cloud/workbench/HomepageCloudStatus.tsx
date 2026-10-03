import { Cloud } from "lucide-react";
import { useLocalization } from "@puppyone/localization";
import { DesktopMenuItem } from "../../../components/DesktopMenu";
import { InlineLoading } from "../../../components/loading";
import { useCloudAuthController } from "../hooks/useCloudAuthController";
import type { AccountCloudWorkspace } from "./useAccountCloudWorkspace";

/** Inline Homepage feedback, not a second catalog or project picker. */
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
  if (controller.opening) return <div className="onboarding-cloud-status" role="status">
    <InlineLoading label={t("onboarding.status.opening")} size="xs" tone="neutral" />
    <button type="button" className="desktop-cloud-row-action" onClick={controller.cancel}>{t("common.action.cancel")}</button>
  </div>;
  if (controller.error || status === "error" || authError) return <div className="onboarding-cloud-status" role="alert">
    <span>{authError ?? t(controller.error ? "cloud.catalog.openFailed" : "cloud.catalog.loadFailed")}</span>
    <button type="button" className="desktop-cloud-row-action" onClick={() => {
      if (authError) auth.startSignIn();
      else if (controller.error) void controller.retry();
      else onRetry();
    }}>{t("cloud.common.retry")}</button>
  </div>;
  if (restoring || status === "loading" || (status === "signed-out" && auth.signingIn)) return <div className="onboarding-cloud-status" role="status">
    <InlineLoading label={t(auth.signingIn ? "cloud.home.waitingForSignIn" : "cloud.home.loading")} size="xs" tone="neutral" />
  </div>;
  if (status === "signed-out") return <DesktopMenuItem role="button" className="onboarding-project-row"
    icon={<Cloud size={14} />} label={t("cloud.auth.signInToCloud")} onClick={auth.startSignIn} />;
  return empty ? <p className="onboarding-cloud-status">{t("cloud.catalog.empty")}</p> : null;
}
