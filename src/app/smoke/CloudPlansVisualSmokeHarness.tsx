import { useLocalization } from "@puppyone/localization";
import { useEffect, useState } from "react";
import { resolveSurfaceAppearance, SurfaceAppearanceProvider } from "../../features/appearance/AppearanceRuntime";
import { useDesktopAppearance, useDesktopPreferenceEffects } from "../../features/settings";
import { TypographyCatalogProvider, useTypographyCatalog, useTypographyRuntime } from "../../features/typography";
import { desktopPreferencesStore, initializeDesktopPreferences, useDesktopPreference } from "../../preferencesStore";
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
 * `?state=signed-out` (default), `?state=free`, `?state=team`, `?state=enterprise`
 * or `?state=scheduled` (Enterprise waiting to become Team at renewal).
 * `?state=loading` holds the first-load layout; `?state=delayed` resolves it
 * after five seconds for layout-shift review. `?state=no-usage` keeps the tracks
 * visible before usage is available. Readings
 * are fixtures; nothing here reaches a billing service.
 */
const queryState = new URLSearchParams(window.location.search).get("state") ?? "signed-out";
const requestedState = queryState === "personal" ? "team" : queryState;
initializeDesktopPreferences({ getItem: () => null, setItem: () => {}, removeItem: () => {} });
desktopPreferencesStore.getState().setThemeMode(new URLSearchParams(window.location.search).get("theme") === "light" ? "light" : "dark");
const GB = 1000 ** 3;
const SESSION = { user_id: "fixture", api_base_url: "https://cloud-fixture.puppyone.ai/api/v1" } as DesktopCloudSession;

const SUMMARIES: Record<string, DesktopBillingSummary | null> = {
  free: null,
  team: {
    org_id: "o1", plan_id: "team_v2", status: "active", seat_quantity: 1, current_period_end: "2026-12-08T00:00:00Z",
    cancel_at_period_end: false, add_ons: [
      { add_on_id: "agent_hours_100", quantity: 1, status: "active", cancel_at_period_end: false, current_period_end: null },
    ],
  } as unknown as DesktopBillingSummary,
  enterprise: {
    org_id: "o1", plan_id: "enterprise_v2", status: "active", seat_quantity: 5, current_period_end: "2026-12-08T00:00:00Z",
    cancel_at_period_end: false, add_ons: [],
  } as unknown as DesktopBillingSummary,
  scheduled: {
    org_id: "o1", plan_id: "enterprise_v2", status: "active", seat_quantity: 3, current_period_end: "2026-12-08T12:00:00Z",
    pending_plan_id: "team_v2", pending_seat_quantity: 1, pending_effective_at: "2026-12-08T12:00:00Z",
    cancel_at_period_end: false, add_ons: [],
  } as unknown as DesktopBillingSummary,
};

const USAGE: Record<string, DesktopBillingUsage> = {
  free: usage(3 * 60, 5 * 60, 0.4 * GB, 1 * GB),
  team: usage(122 * 60, 140 * 60, 3.2 * GB, 10 * GB),
  enterprise: usage(61 * 60, 200 * 60, 41 * GB, 100 * GB),
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
  return <TypographyCatalogProvider><PlanFixture /></TypographyCatalogProvider>;
}

function PlanFixture() {
  useDesktopPreferenceEffects();
  const { resolvedAppearance, lightThemePreset, darkThemePreset } = useDesktopAppearance();
  const typographyPreferences = useDesktopPreference((s) => s.typographyPreferences);
  const typographyCatalog = useTypographyCatalog();
  const { locale } = useLocalization();
  const typography = useTypographyRuntime(typographyPreferences, typographyCatalog, locale);
  const markdownPresentation = useDesktopPreference((s) => s.markdownPresentation);
  const pointerCursors = useDesktopPreference((s) => s.pointerCursors);
  const diffMarkers = useDesktopPreference((s) => s.diffMarkers);
  const appearance = resolveSurfaceAppearance({ appearance: resolvedAppearance, typography, lightThemePreset, darkThemePreset,
    markdownPresentation, pointerCursors, diffMarkers });
  const [state, setState] = useState(requestedState === "delayed" ? "loading" : requestedState);
  useEffect(() => {
    if (requestedState !== "delayed") return;
    const timer = window.setTimeout(() => setState("team"), 5000);
    return () => window.clearTimeout(timer);
  }, []);
  const localization = useLocalization();
  const { t } = localization;
  const view = resolvePlanCatalog(null);
  const summary = SUMMARIES[state === "no-usage" ? "team" : state] ?? null;
  const holding = resolvePlanHolding(summary, null);
  const current = view.plans.find((plan) => plan.id === holding.planId) ?? view.plans[0]!;
  const action = (plan: PlanOffer) => plan.id === current.id
    ? <span className="desktop-plan-current-badge">{t("settings.plan.current")}</span>
    : <button type="button" className={`desktop-settings-action${holding.subscribed ? "" : " primary"}`}>
      {t(holding.subscribed ? "settings.plan.switch" : "settings.plan.upgrade")}
    </button>;
  const addOns = (kind: "hours" | "storage") => holding.subscribed ? <AddOns
    session={SESSION} apiBaseUrl={null} organizationId="o1" onSessionChange={() => undefined}
    addOns={view.addOns.filter((addOn) => addOn.kind === kind)} holding={holding} sellable
    localization={localization} onChanged={() => undefined}
  /> : null;

  return (
    <SurfaceAppearanceProvider value={appearance}><section {...appearance.rootProps}
      className={`desktop-utility-view desktop-settings-view${resolvedAppearance.effectiveColorMode === "dark" ? " dark" : ""}`}>
      <div className="desktop-utility-body desktop-settings-body" data-po-scrollbar="content">
        <div className="desktop-settings-section desktop-plan-settings">
          <SettingsSectionHeader title={t("settings.seats.title")} />
          {state === "signed-out" || state === "loading" ? (
            <CloudPlans
              session={state === "loading" ? SESSION : null}
              apiBaseUrl={null}
              organizationId={state === "loading" ? "o1" : null}
              onSessionChange={() => undefined}
              catalog={null}
              summary={null}
              usage={null}
              loading={state === "loading"}
              onRefresh={() => undefined}
              localization={localization}
              onSignIn={() => undefined}
              canManageBilling={null}
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
              <PlanComparison plans={view.plans} holding={holding} usage={USAGE[state] ?? null} storageActions={addOns("storage")} signedIn
                localization={localization} renderAction={action} />
              <PlanFinePrint localization={localization} />
              {addOns("hours")}
            </>
          )}
        </div>
      </div>
    </section></SurfaceAppearanceProvider>
  );
}
