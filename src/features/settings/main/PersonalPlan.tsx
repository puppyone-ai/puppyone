import type { ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import type { LocalizationContextValue } from "@puppyone/localization";
import type { DesktopBillingUsage, DesktopCloudSession } from "../../../lib/cloudApi";
import { useCloudBillingController } from "../../cloud";
import { SettingsSubsection, SettingsValueRow } from "../components";
import {
  formatMoney,
  formatStorage,
  type PersonalPlanOffer,
  type PlanHolding,
} from "./planPricing";

/** One Cloud Computer comes with Personal. */
const INCLUDED_COMPUTERS = 1;

/**
 * Personal: the one plan, what it includes, and the one way to get it.
 *
 * Built from the same label/value rows as every other Settings page, so it
 * reads like Settings rather than like a pricing page: the plan and its price
 * with the one action beside them, then what it includes. No sentences
 * explaining the plan. The rows are the explanation.
 *
 * Storage is the only quantity with a bar, and only once the plan is held:
 * stored bytes move when the user saves, not while an agent works, so the bar
 * never teaches anyone to run fewer agents. The machine behind the Cloud
 * Computer is never described.
 */
export function PersonalPlan({
  session,
  apiBaseUrl,
  organizationId,
  onSessionChange,
  offer,
  holding,
  usage,
  loading,
  localization,
  onSignIn,
  signInDisabled = false,
}: {
  session: DesktopCloudSession | null;
  apiBaseUrl: string | null;
  organizationId: string | null;
  onSessionChange: (session: DesktopCloudSession | null) => void;
  offer: PersonalPlanOffer;
  holding: PlanHolding;
  /** Authoritative usage, or `null` while the billing service cannot answer. */
  usage: DesktopBillingUsage | null;
  loading: boolean;
  localization: LocalizationContextValue;
  onSignIn: () => void;
  signInDisabled?: boolean;
}) {
  const { t } = localization;

  if (session !== null && organizationId !== null) {
    return (
      <ConnectedPlan
        session={session}
        apiBaseUrl={apiBaseUrl}
        organizationId={organizationId}
        onSessionChange={onSessionChange}
        offer={offer}
        holding={holding}
        usage={usage}
        loading={loading}
        localization={localization}
      />
    );
  }

  // Buying needs an account. Signed out, the one action is sign-in; signed in
  // but still loading the account, the same button waits instead of offering
  // a sign-in the reader has already done.
  return (
    <PersonalPlanRows
      offer={offer}
      holding={holding}
      usage={null}
      localization={localization}
      action={(
        <button
          type="button"
          className="desktop-settings-action primary"
          disabled={session !== null || signInDisabled}
          onClick={onSignIn}
        >
          {t(session !== null ? "settings.seats.subscribe" : "settings.seats.signInToSubscribe")}
        </button>
      )}
    />
  );
}

function ConnectedPlan({
  session,
  apiBaseUrl,
  organizationId,
  onSessionChange,
  offer,
  holding,
  usage,
  loading,
  localization,
}: {
  session: DesktopCloudSession;
  apiBaseUrl: string | null;
  organizationId: string;
  onSessionChange: (session: DesktopCloudSession | null) => void;
  offer: PersonalPlanOffer;
  holding: PlanHolding;
  usage: DesktopBillingUsage | null;
  loading: boolean;
  localization: LocalizationContextValue;
}) {
  const { t } = localization;
  const controller = useCloudBillingController({
    session, apiBaseUrl, organizationId, enabled: true, onSessionChange, t,
  });
  const billing = controller.state;
  const unavailable = billingUnavailable(billing.error);
  const catalogPlan = !unavailable && offer.purchasable ? offer.catalogPlan ?? null : null;
  const renewal = billing.summary?.current_period_end ?? null;

  let action: ReactNode;
  if (holding.subscribed) {
    action = billing.summary?.portal_available ? (
      <button
        type="button"
        className="desktop-settings-action"
        disabled={billing.action !== null}
        onClick={() => void controller.openPortal()}
      >
        <span>{t("settings.seats.invoices")}</span>
        <ExternalLink size={12} aria-hidden="true" />
      </button>
    ) : undefined;
  } else {
    // While subscriptions are not open the button stays where it will be,
    // and says so, rather than a sentence appearing under the plan.
    action = (
      <button
        type="button"
        className="desktop-settings-action primary"
        disabled={!catalogPlan || loading || billing.action !== null}
        onClick={catalogPlan ? () => {
          controller.setSeatQuantity(1);
          void controller.quotePlan(catalogPlan);
        } : undefined}
      >
        {t(catalogPlan || loading ? "settings.seats.subscribe" : "settings.seats.comingSoon")}
      </button>
    );
  }

  return (
    <>
      <PersonalPlanRows
        offer={offer}
        holding={holding}
        renewal={holding.subscribed ? renewal : null}
        usage={usage}
        localization={localization}
        action={action}
      />

      {billing.actionError && (
        <p className="desktop-plan-error" role="alert">{billing.actionError}</p>
      )}

      {billing.quote && (
        <SettingsSubsection title={t("settings.plan.quoteTitle")}>
          <SettingsValueRow
            label={t("settings.seats.planName")}
            value={formatMoney(billing.quote.target_amount_cents, billing.quote.currency, localization)}
            action={(
              <button
                type="button"
                className="desktop-settings-action primary"
                disabled={billing.action !== null}
                onClick={() => void controller.confirmQuote()}
              >
                <span>{t("settings.plan.confirmAndPay")}</span>
                <ExternalLink size={12} aria-hidden="true" />
              </button>
            )}
          />
          <p className="desktop-plan-note">{t("settings.plan.quoteNote")}</p>
        </SettingsSubsection>
      )}
    </>
  );
}

/**
 * The rows themselves, the presentation half with no session or controller
 * behind them.
 */
export function PersonalPlanRows({
  offer,
  holding,
  renewal = null,
  usage,
  localization,
  action,
}: {
  offer: PersonalPlanOffer;
  holding: PlanHolding;
  /** When a held plan renews, as an ISO date. */
  renewal?: string | null;
  usage: DesktopBillingUsage | null;
  localization: LocalizationContextValue;
  action?: ReactNode;
}) {
  const { t } = localization;
  const price = holding.subscribed && holding.monthlyCents !== null
    ? formatMoney(holding.monthlyCents, holding.currency, localization)
    : formatMoney(offer.priceCents, offer.currency, localization);
  const monthly = offer.priceCents === null && !holding.subscribed
    ? price
    : t("settings.plan.monthlyFor", { amount: price });
  const value = renewal
    ? `${monthly} · ${t("settings.seats.renews", {
      date: localization.formatDate(renewal, { month: "short", day: "numeric" }),
    })}`
    : monthly;

  return (
    <>
      <SettingsSubsection leading>
        <SettingsValueRow label={t("settings.seats.planName")} value={value} action={action} />
      </SettingsSubsection>

      <SettingsSubsection title={t("settings.seats.includesTitle")}>
        <StorageRow offer={offer} holding={holding} usage={usage} localization={localization} />
        <SettingsValueRow
          label={t("settings.seats.computerTitle")}
          value={t("settings.seats.computerCount", { count: INCLUDED_COMPUTERS })}
        />
      </SettingsSubsection>
    </>
  );
}

/**
 * Storage: how much is used of how much, with a bar, once the plan is held
 * and the billing service has said. Before that it states the allowance.
 */
function StorageRow({
  offer,
  holding,
  usage,
  localization,
}: {
  offer: PersonalPlanOffer;
  holding: PlanHolding;
  usage: DesktopBillingUsage | null;
  localization: LocalizationContextValue;
}) {
  const { t } = localization;
  const label = t("settings.seats.storageTitle");
  const limit = usage?.storage.limit_bytes ?? offer.storageBytes;

  if (!holding.subscribed || !usage || limit === null || limit <= 0) {
    return (
      <SettingsValueRow
        label={label}
        value={offer.storageBytes === null ? "—" : formatStorage(offer.storageBytes, localization)}
      />
    );
  }

  const used = usage.storage.logical_bytes;
  const percent = Math.max(0, Math.min(100, (used / limit) * 100));
  return (
    <div className="desktop-settings-row desktop-settings-value-row desktop-plan-meter-row">
      <span>{label}</span>
      <div className="desktop-settings-value">
        <span className="desktop-settings-value-text">
          {t("settings.seats.storageUsedOf", {
            used: formatStorage(used, localization),
            total: formatStorage(limit, localization),
          })}
        </span>
      </div>
      <div
        className={`desktop-plan-meter-track${percent >= 90 ? " exhausted" : ""}`}
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
      >
        <span style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

/**
 * Both the BFF and PuppyPay answer 404 while hosted subscriptions are switched
 * off. That is a product state, not a fault.
 */
function billingUnavailable(error: string | null): boolean {
  if (!error) return false;
  return /not available|not enabled|hosting_billing_disabled/i.test(error);
}
