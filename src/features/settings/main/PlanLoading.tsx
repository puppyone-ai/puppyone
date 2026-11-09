import { PlaceholderLayer } from "@puppyone/shared-ui";
import type { LocalizationContextValue } from "@puppyone/localization";
import { SettingsSubsection } from "../components";
import { PlanUsageBar } from "./PlanUsageBar";

/** The signed-in page keeps its reading order while its first snapshot loads. */
export function PlanLoading({ localization }: { localization: LocalizationContextValue }) {
  const { t } = localization;
  return (
    <div className="desktop-plan-loading po-placeholder-surface" role="status" aria-label={t("settings.plan.loading")} aria-busy="true">
      <div className="desktop-plan-overview">
        <SettingsSubsection title={t("settings.plan.currentLabel")}>
          <div className="desktop-settings-row desktop-plan-summary" aria-hidden="true">
            <div className="desktop-plan-summary-main">
              <span className="desktop-plan-placeholder name" data-placeholder-shape="" />
              <span className="desktop-plan-placeholder detail" data-placeholder-shape="" />
            </div>
          </div>
        </SettingsSubsection>
        <div className="desktop-plan-usage">
          {["settings.plan.hoursLabel", "settings.plan.storageLabel"].map((label) => (
            <div className="desktop-plan-usage-item" key={label}>
              <PlanUsageBar percent={null} kind={label === "settings.plan.hoursLabel" ? "hours" : "storage"} />
              <div className="desktop-plan-usage-heading">
                <span>{t(label)}</span>
                <span className="desktop-plan-usage-value desktop-plan-placeholder reading" data-placeholder-shape="" aria-hidden="true">— / —</span>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="desktop-plan-comparison">
        <SettingsSubsection title={t("settings.plan.chooseTitle")}>
          <div className="desktop-plan-grid" aria-hidden="true">
            {[0, 1].map((index) => (
              <div className="desktop-plan-card" key={index}>
                <div className="desktop-plan-card-head">
                  <span className="desktop-plan-placeholder name" data-placeholder-shape="" />
                  <span className="desktop-plan-placeholder price" data-placeholder-shape="" />
                </div>
                <div className="desktop-plan-spec">
                  {[0, 1, 2, 3].map((row) => <span className="desktop-plan-placeholder spec" key={row} data-placeholder-shape="" />)}
                </div>
                <div className="desktop-plan-card-action"><span className="desktop-plan-placeholder action" data-placeholder-shape="" /></div>
              </div>
            ))}
          </div>
        </SettingsSubsection>
      </div>
      <PlaceholderLayer />
    </div>
  );
}
