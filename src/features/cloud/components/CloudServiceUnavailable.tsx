import { useLocalization } from "@puppyone/localization/react";
import { Plug } from "lucide-react";
import "./service-unavailable.css";

/** Failed requests must never look like an empty, writable service. */
export function CloudServiceUnavailable({ title, onRetry }: { title: string; onRetry: () => void }) {
  const { t } = useLocalization();
  return <section className="desktop-cloud-service-unavailable" role="alert">
    <Plug size={24} aria-hidden="true" />
    <h1>{t("cloud.workspaceTools.unavailable", { service: title })}</h1>
    <button className="desktop-cloud-service-retry" type="button" onClick={onRetry}>{t("common.action.retry")}</button>
  </section>;
}
