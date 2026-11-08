import { useLocalization } from "@puppyone/localization";
import { SettingsSectionHeader } from "../../features/settings/components";
import {
  AddOns,
  CloudPlans,
  CurrentPlan,
  PlanComparison,
  PlanFinePrint,
} from "../../features/settings/main/CloudPlans";
import {
  resolvePlanCatalog,
  resolvePlanHolding,
  type PlanOffer,
} from "../../features/settings/main/planPricing";
import type {
  DesktopBillingSummary,
  DesktopBillingUsage,
  DesktopCloudSession,
} from "../../lib/cloudApi";

/**
 * Settings → Plan, for visual review: `#cloud-plans-visual-smoke`, with
 * `?state=signed-out` (default), `?state=free`, `?state=personal`, `?state=team`
 * or `?state=scheduled` (Team waiting to become Personal at renewal). Readings
 * are fixtures; nothing here reaches a billing service.
 */
const state = new URLSearchParams(window.location.search).get("state") ?? "signed-out";
const GB = 1000 ** 3;
const SESSION = { user_id: "fixture", api_base_url: "https://cloud-fixture.puppyone.ai/api/v1" } as DesktopCloudSession;

const SUMMARIES: Record<string, DesktopBillingSummary | null> = {
  free: null,
  personal: {
    org_id: "o1", plan_id: "personal", status: "active", seat_quantity: 1, current_period_end: "2026-12-08T00:00:00Z",
    cancel_at_period_end: false, add_ons: [
      { add_on_id: "agent_hours_100", quantity: 1, status: "active", cancel_at_period_end: false, current_period_end: null },
    ],
  } as unknown as DesktopBillingSummary,
  team: {
    org_id: "o1", plan_id: "team", status: "active", seat_quantity: 5, current_period_end: "2026-12-08T00:00:00Z",
    cancel_at_period_end: false, add_ons: [],
  } as unknown as DesktopBillingSummary,
  scheduled: {
    org_id: "o1", plan_id: "team", status: "active", seat_quantity: 3, current_period_end: "2026-12-08T12:00:00Z",
    pending_plan_id: "personal", pending_seat_quantity: 1, pending_effective_at: "2026-12-08T12:00:00Z",
    cancel_at_period_end: false, add_ons: [],
  } as unknown as DesktopBillingSummary,
};

const USAGE: Record<string, DesktopBillingUsage> = {
  free: usage(3 * 60, 5 * 60, 0.4 * GB, 1 * GB),
  personal: usage(122 * 60, 140 * 60, 3.2 * GB, 10 * GB),
  team: usage(61 * 60, 200 * 60, 41 * GB, 100 * GB),
  scheduled: usage(30 * 60, 120 * 60, 12 * GB, 60 * GB),
};

function usage(used: number, granted: number, bytes: number, limit: number): DesktopBillingUsage {
  return {
    runtime: {
      org_id: "o1", available_units: granted - used, reserved_units: 0, granted_units: granted,
      consumed_units: used, postpaid_available_units: 0, postpaid_consumed_units: 0, buckets: [],
      allowance: { granted_units: granted, consumed_units: used, reserved_units: 0, resets_at: "2026-12-01T00:00:00Z", unit_seconds: 60 },
    },
    storage: { logical_bytes: bytes, limit_bytes: limit, percent: null, threshold_percent: 0, version: 1 },
  };
}

export function CloudPlansVisualSmokeHarness() {
  const localization = useLocalization();
  const { t } = localization;
  const view = resolvePlanCatalog(null);
  const summary = SUMMARIES[state] ?? null;
  const holding = resolvePlanHolding(summary, null);
  const current = view.plans.find((plan) => plan.id === holding.planId) ?? view.plans[0]!;
  const action = (plan: PlanOffer) => plan.id === current.id
    ? <span className="desktop-plan-current-badge">{t("settings.plan.current")}</span>
    : <button type="button" className={`desktop-settings-action${holding.subscribed ? "" : " primary"}`}>
      {t(holding.subscribed ? "settings.plan.switch" : "settings.plan.upgrade")}
    </button>;

  return (
    <section className="desktop-utility-view desktop-settings-view">
      <div className="desktop-utility-body desktop-settings-body" data-po-scrollbar="content">
        <div className="desktop-settings-section">
          <SettingsSectionHeader title={t("settings.seats.title")} />
          {state === "signed-out" ? (
            <CloudPlans
              session={null}
              apiBaseUrl={null}
              organizationId={null}
              onSessionChange={() => undefined}
              catalog={null}
              summary={null}
              usage={null}
              loading={false}
              onRefresh={() => undefined}
              localization={localization}
              onSignIn={() => undefined}
            />
          ) : (
            <>
              <CurrentPlan
                offer={current}
                holding={holding}
                usage={USAGE[state] ?? null}
                addOns={view.addOns}
                localization={localization}
                action={holding.subscribed ? (
                  <button type="button" className="desktop-settings-action">{t("settings.plan.invoices")}</button>
                ) : undefined}
                scheduledAction={holding.scheduled ? (
                  <button type="button" className="desktop-settings-action">{t("settings.plan.keepCurrent")}</button>
                ) : undefined}
              />
              <PlanComparison plans={view.plans} holding={holding} signedIn localization={localization} renderAction={action} />
              <PlanFinePrint localization={localization} />
              {holding.subscribed && (
                <AddOns
                  session={SESSION}
                  apiBaseUrl={null}
                  organizationId="o1"
                  onSessionChange={() => undefined}
                  addOns={view.addOns}
                  holding={holding}
                  sellable
                  localization={localization}
                  onChanged={() => undefined}
                />
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
