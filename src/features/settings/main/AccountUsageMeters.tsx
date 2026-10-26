import { useLocalization, type LocalizationContextValue } from "@puppyone/localization";
import type { DesktopBillingCatalog, DesktopBillingUsage } from "../../../lib/cloudApi";
import { formatGigabytes } from "./planPricing";

/**
 * What the account has stored.
 *
 * Stored bytes are the only metered quantity drawn here. Hosted runtime is
 * metered too and used to sit beside it, but `planPricing.ts` fixes the
 * opposite rule for that same number: "RU is internal metering vocabulary and
 * must never reach a user surface. A bill the user cannot predict is worse
 * than a bill that is slightly too high." Both files cannot be right, and the
 * pricing authority wins — runtime stays a cost control on our side.
 *
 * The product reason outranks the consistency one. A runtime bar drains while
 * the product is used, so the one surface a user opens after a working session
 * teaches them that working costs them something, and the cheapest way to keep
 * that bar full is to run fewer agents. Stored bytes do not behave that way:
 * storage moves when the user saves rather than when an agent thinks, it is a
 * shelf they chose to fill, and every other product they pay for has already
 * taught them what a storage number means.
 *
 * A meter is only drawn against an authoritative reading. With no usage from
 * the billing service we state what the plan includes instead — a fact about
 * the plan, never a fabricated consumption figure, because a filled bar is a
 * claim about the user's money.
 */
export function AccountUsageMeters({
  usage,
  catalog,
  planId,
}: {
  usage: DesktopBillingUsage | null;
  catalog: DesktopBillingCatalog | null;
  planId: string | null;
}) {
  const localization = useLocalization();
  const { t } = localization;

  if (usage) {
    const storage = usage.storage;
    return (
      <section className="desktop-account-usage" aria-label={t("settings.account.usageTitle")}>
        <Meter
          label={t("settings.account.storageLabel")}
          value={storage.limit_bytes === null
            ? t("settings.plan.amountGb", {
              amount: formatGigabytes(storage.logical_bytes, localization),
            })
            : t("settings.account.gbUsedOf", {
              used: formatGigabytes(storage.logical_bytes, localization),
              total: formatGigabytes(storage.limit_bytes, localization),
            })}
          percent={storage.limit_bytes === null
            ? null
            : ratio(storage.logical_bytes, storage.limit_bytes)}
        />
      </section>
    );
  }

  const included = planAllowance(catalog, planId, localization);
  if (!included) return null;
  return (
    <section className="desktop-account-usage" aria-label={t("settings.account.usageTitle")}>
      <p className="desktop-account-allowance">{included}</p>
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
  /** `null` renders the reading without a bar, for an unmetered quantity. */
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

/** What this plan grants, stated as a plan fact rather than as usage. */
function planAllowance(
  catalog: DesktopBillingCatalog | null,
  planId: string | null,
  localization: LocalizationContextValue,
): string | null {
  const plan = catalog?.plans.find((candidate) => candidate.id === planId);
  if (!plan) return null;
  const storage = plan.per_seat_limits["storage.max_bytes"]
    ?? plan.fixed_limits["storage.max_bytes"];
  if (typeof storage !== "number") return null;
  return localization.t("settings.account.planIncludes", {
    storage: formatGigabytes(storage, localization),
  });
}
