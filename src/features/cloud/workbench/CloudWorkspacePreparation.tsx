import { RefreshCw } from "lucide-react";
import { useLocalization } from "@puppyone/localization";
import { CloudIcon } from "../../../components/icons/CloudIcon";
import { formatCloudMessage } from "../cloudPresentation";
import type { CloudWorkspaceSwitch } from "./useCloudWorkspaceSwitch";

/** Presentation for the requested destination; no provider or editor ownership. */
export function CloudWorkspacePreparation({ controller }: { controller: CloudWorkspaceSwitch }) {
  const { t } = useLocalization();
  return <section className="desktop-cloud-preparation" aria-label={t("cloud.productName")}
    aria-busy={!controller.error}>
    <div className="desktop-cloud-preparation-rail" aria-hidden="true">
      {[0, 1, 2, 3, 4].map(index => <span key={index} />)}
    </div>
    <div className="desktop-cloud-preparation-main">
      <CloudIcon size={32} className="desktop-cloud-preparation-mark" />
      <strong>{t("cloud.productName")}</strong>
      {controller.error ? <>
        <p role="alert">{formatCloudMessage(controller.error, t)}</p>
        <button type="button" className="desktop-cloud-row-action" onClick={controller.retry}>
          <RefreshCw size={13} /><span>{t("cloud.common.retry")}</span>
        </button>
      </> : <p role="status">{t("cloud.loading.project")}</p>}
    </div>
  </section>;
}
