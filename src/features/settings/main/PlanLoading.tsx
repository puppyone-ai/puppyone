import type { CSSProperties } from "react";
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
        <SettingsSubsection>
          <div className="desktop-settings-row desktop-plan-summary" aria-hidden="true">
            <span>{t("settings.plan.currentLabel")}</span>
            <div className="desktop-plan-summary-main">
              <span className="desktop-plan-placeholder name" data-placeholder-shape="" />
              <span className="desktop-plan-placeholder detail" data-placeholder-shape="" />
            </div>
          </div>
        </SettingsSubsection>
        <div className="desktop-plan-usage">
          <div className="desktop-plan-usage-item">
            <span className="desktop-plan-usage-heading">{t("settings.plan.hoursLabel")}</span>
            <div className="desktop-plan-usage-inline">
              <span className="desktop-plan-usage-value desktop-plan-placeholder reading" data-placeholder-shape="" aria-hidden="true">— / —</span>
              <PlanUsageBar percent={null} kind="hours" />
              <span className="desktop-plan-placeholder reading" data-placeholder-shape="" aria-hidden="true">—</span>
            </div>
          </div>
        </div>
      </div>
      <div className="desktop-plan-comparison">
        <SettingsSubsection title={t("settings.plan.chooseTitle")}>
          <div className="desktop-plan-grid" style={{ "--desktop-plan-columns": 3 } as CSSProperties} aria-hidden="true">
            {[0, 1, 2].map((index) => (
              <div className="desktop-plan-card" key={index}>
                <div className="desktop-plan-card-head">
                  <span className="desktop-plan-placeholder name" data-placeholder-shape="" />
                  <span className="desktop-plan-placeholder price" data-placeholder-shape="" />
                </div>
                <div className="desktop-plan-spec">
                  {[0, 1, 2, 3].map((row) => <div className="desktop-plan-spec-row" key={row}>
                    <span className="desktop-plan-placeholder spec" data-placeholder-shape="" />
                    <span className="desktop-plan-placeholder reading" data-placeholder-shape="" />
                  </div>)}
                </div>
                <div className="desktop-plan-card-action"><span className="desktop-plan-placeholder action" data-placeholder-shape="" /></div>
              </div>
            ))}
          </div>
        </SettingsSubsection>
        <p className="desktop-plan-note" aria-hidden="true"><span className="desktop-plan-placeholder detail" data-placeholder-shape="" /></p>
        <div className="desktop-plan-storage-details" aria-hidden="true">
          <span className="desktop-plan-placeholder name" data-placeholder-shape="" />
        </div>
      </div>
      <PlaceholderLayer />
    </div>
  );
}
