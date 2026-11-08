import { useLocalization } from "@puppyone/localization";
import type {
  DesktopBillingCatalog,
  DesktopBillingSummary,
  DesktopBillingUsage,
} from "../../../lib/cloudApi";
import {
  describeHoursReading,
  describeStorageReading,
  resolveAllowance,
  resolvePlanCatalog,
  resolvePlanHolding,
} from "./planPricing";

/**
 * This period's cloud agent hours and storage, against what the plan includes.
 *
 * Both meters are the plan's own promise ("40 hours a month", "10 GB"), so
 * Account can show how much of it is left without selling anything. Hours are
 * agent time only; a person working in the cloud never moves that bar.
 *
 * A meter is only drawn against an authoritative reading. With no usage from
 * the billing service the page states what the plan includes instead — a filled
 * bar is a claim about the user's money.
 */
export function AccountUsageMeters({
  usage,
  catalog,
  summary,
}: {
  usage: DesktopBillingUsage | null;
  catalog: DesktopBillingCatalog | null;
  summary: DesktopBillingSummary | null;
}) {
  const localization = useLocalization();
  const { t } = localization;
  const view = resolvePlanCatalog(catalog);
  const holding = resolvePlanHolding(summary, catalog);
  const offer = view.plans.find((plan) => plan.id === holding.planId) ?? view.plans[0]!;
  const reading = resolveAllowance(usage, offer, holding, view.addOns);

  return (
    <section className="desktop-account-usage" aria-label={t("settings.account.usageTitle")}>
      <Meter
        label={t("settings.plan.hoursLabel")}
        value={describeHoursReading(reading, localization)}
        percent={reading.usedHours === null ? null : ratio(reading.usedHours, reading.includedHours)}
      />
      <Meter
        label={t("settings.account.storageLabel")}
        value={describeStorageReading(reading, localization)}
        percent={reading.usedBytes === null || reading.includedBytes === null
          ? null
          : ratio(reading.usedBytes, reading.includedBytes)}
      />
    </section>
  );
}

function Meter({
  label,
  value,
  percent,
}: {
  label: string;
  value: string;
  /** `null` renders the reading without a bar. */
  percent: number | null;
}) {
  const bounded = percent === null ? null : Math.max(0, Math.min(100, percent));
  return (
    <div className="desktop-account-meter">
      <div className="desktop-account-meter-head">
        <span className="desktop-account-meter-label">{label}</span>
        <span className="desktop-account-meter-value">{value}</span>
      </div>
      {bounded !== null && (
        <div
          className={`desktop-account-meter-track${bounded >= 90 ? " exhausted" : ""}`}
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(bounded)}
        >
          <span style={{ width: `${bounded}%` }} />
        </div>
      )}
    </div>
  );
}

function ratio(used: number, total: number): number | null {
  if (!Number.isFinite(total) || total <= 0) return null;
  return (used / total) * 100;
}
