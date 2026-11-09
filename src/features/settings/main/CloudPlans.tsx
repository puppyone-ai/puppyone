import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Check, ExternalLink, Minus, Plus } from "lucide-react";
import type { LocalizationContextValue } from "@puppyone/localization";
import {
  changeCloudBillingAddOn,
  createDesktopBillingIdempotencyKey,
  openCloudBillingExternalUrl,
  type DesktopBillingCatalog,
  type DesktopBillingQuote,
  type DesktopBillingSummary,
  type DesktopBillingUsage,
  type DesktopCloudSession,
} from "../../../lib/cloudApi";
import { useCloudBillingController } from "../../cloud";
import { SettingsSubsection, SettingsValueRow } from "../components";
import { PlanLoading } from "./PlanLoading";
import { PlanUsageBar } from "./PlanUsageBar";
import {
  formatCurrency,
  formatHours,
  formatMoney,
  formatStorage,
  resolveAllowance,
  resolvePlanCatalog,
  resolvePlanHolding,
  plansForSpace,
  unitsToHours,
  type AddOnOffer,
  type PlanHolding,
  type PlanId,
  type PlanOffer,
  type SpaceKind,
} from "./planPricing";

type PlanPageProps = {
  session: DesktopCloudSession | null;
  apiBaseUrl: string | null;
  organizationId: string | null;
  onSessionChange: (session: DesktopCloudSession | null) => void;
  catalog: DesktopBillingCatalog | null;
  summary: DesktopBillingSummary | null;
  usage: DesktopBillingUsage | null;
  loading: boolean;
  restoring?: boolean;
  loadError?: boolean;
  catalogUnavailable?: boolean;
  onRefresh: (force?: boolean) => void;
  localization: LocalizationContextValue;
  onSignIn: () => void;
  signInDisabled?: boolean;
  /**
   * The kind of space this page is for. Plans belong to spaces: a personal
   * space holds Free or Personal, a team holds Free or Team.
   */
  spaceKind: SpaceKind;
  /** Whether this person may change the plan; only a space's owner can. */
  canManageBilling: boolean | null;
  /** Starts a team when someone in their personal space wants to work with others. */
  onCreateTeam?: () => void;
};

/**
 * Plan: what you are on, what you have used, and what else you could be on.
 *
 * The page answers three questions in the order people ask them. First the
 * plan held and this period's agent hours and storage, so "am I running out?"
 * is answered before anything is sold. Then the available plans side by side, each
 * with one price and the same four lines, so they compare at a glance. Then,
 * for a paid plan, the two add-ons. Every change is quoted before it is paid,
 * and payment always finishes in the browser.
 *
 * Pricing rules live in `planPricing.ts`.
 */
export function CloudPlans(props: PlanPageProps) {
  const { session, organizationId } = props;
  if (props.restoring || (session && !props.summary && (props.loading || !props.loadError))) {
    return <PlanLoading localization={props.localization} />;
  }
  if (session !== null && organizationId !== null && props.summary) {
    return <ConnectedPlans {...props} session={session} organizationId={organizationId} />;
  }
  const view = resolvePlanCatalog(props.catalog);
  const holding = resolvePlanHolding(null, null);
  const waiting = session !== null;
  return (
    <>
      {session && (
        <SettingsSubsection title={props.localization.t("settings.plan.currentLabel")}>
          <div className="desktop-settings-row desktop-plan-load-error" role="alert">
            <span>{props.localization.t("cloud.billing.loadFailed")}</span>
            <button type="button" className="desktop-settings-action" onClick={() => props.onRefresh()}>
              {props.localization.t("cloud.common.refresh")}
            </button>
          </div>
        </SettingsSubsection>
      )}
      {!props.catalogUnavailable && <PlanComparison
        plans={plansForSpace(view.plans, props.spaceKind)}
        holding={holding}
        signedIn={false}
        localization={props.localization}
        renderAction={(plan) => waiting ? null : (
          <button
            type="button"
            className={`desktop-settings-action${plan.id === "free" ? "" : " primary"}`}
            disabled={waiting || props.signInDisabled}
            onClick={props.onSignIn}
          >
            {props.localization.t("settings.plan.signInToChoose")}
          </button>
        )}
      />}
      {!props.catalogUnavailable && <PlanFinePrint localization={props.localization} />}
    </>
  );
}

function ConnectedPlans({
  session,
  apiBaseUrl,
  organizationId,
  onSessionChange,
  catalog,
  summary,
  usage,
  loading,
  loadError,
  catalogUnavailable,
  onRefresh,
  localization,
  spaceKind,
  canManageBilling,
  onCreateTeam,
}: PlanPageProps & { session: DesktopCloudSession; organizationId: string }) {
  const { t } = localization;
  const controller = useCloudBillingController({
    session, apiBaseUrl, organizationId, enabled: true, onSessionChange, t,
    readSnapshot: { catalog, summary, usage },
    onSnapshotChange: onRefresh,
  });
  const billing = controller.state;
  const view = resolvePlanCatalog(billing.catalog ?? catalog);
  const effectiveSummary = billing.summary ?? summary;
  const holding = resolvePlanHolding(effectiveSummary, billing.catalog ?? catalog);
  const current = view.plans.find((plan) => plan.id === holding.planId) ?? view.plans[0]!;
  // Only the space's owner can buy or change; others see the plan as it is.
  const owner = canManageBilling === true;
  const sellable = !catalogUnavailable && view.authoritative && !billingUnavailable(billing.error) && owner;
  const busy = billing.action !== null || loading;
  const spacePlans = plansForSpace(view.plans, spaceKind);

  const team = view.plans.find((plan) => plan.id === "team");
  const teamMinimum = team?.minimumSeats ?? 2;
  const seatTarget = Math.max(teamMinimum, billing.seatQuantity);
  // The seat stepper writes the controller's quantity as it moves, so the quote
  // always reads the number on screen.
  const setSeats = controller.setSeatQuantity;
  const onTeam = holding.subscribed && holding.planId === "team";
  // Start the stepper from what is held, and again whenever that changes, but
  // never overwrite a number the person is still choosing.
  const seededFor = useRef<string | null>(null);
  useEffect(() => {
    const held = `${onTeam}:${holding.seats}:${teamMinimum}`;
    if (seededFor.current === held) return;
    seededFor.current = held;
    setSeats(onTeam ? holding.seats : teamMinimum);
  }, [holding.seats, onTeam, setSeats, teamMinimum]);

  const quoteTiming = describeQuoteTiming(billing.quote, holding, localization);

  const refreshAll = useCallback(() => {
    void controller.refresh();
  }, [controller]);

  const choose = (plan: PlanOffer) => {
    if (!plan.catalogPlan) return;
    if (plan.id === "team" && onTeam) {
      void controller.quoteSeats();
      return;
    }
    if (plan.id !== "team") setSeats(1);
    void controller.quotePlan(plan.catalogPlan);
  };

  const renderAction = (plan: PlanOffer): ReactNode => {
    const isCurrent = plan.id === current.id;
    if (plan.id === "free") {
      if (isCurrent) return <CurrentBadge localization={localization} />;
      // Leaving a paid plan is a cancellation, which lives with invoices.
      return (
        <button
          type="button"
          className="desktop-settings-action"
          disabled={busy || !effectiveSummary?.portal_available}
          onClick={() => void controller.openPortal()}
        >
          <span>{t("settings.plan.moveToFree")}</span>
          <ExternalLink size={12} aria-hidden="true" />
        </button>
      );
    }
    if (plan.id === "team") {
      const changed = !onTeam || seatTarget !== holding.seats;
      return (
        <div className="desktop-plan-card-team-action">
          <QuantityStepper
            label={t("settings.plan.peopleLabel")}
            value={seatTarget}
            minimum={onTeam ? 1 : teamMinimum}
            maximum={500}
            disabled={busy || !sellable}
            onChange={setSeats}
            localization={localization}
            unit={t("settings.plan.peopleUnit", { count: seatTarget })}
          />
          {onTeam && !changed ? <CurrentBadge localization={localization} /> : (
            <button
              type="button"
              className="desktop-settings-action primary"
              disabled={busy || !sellable || !plan.catalogPlan}
              onClick={() => choose(plan)}
            >
              {t(teamActionLabel(onTeam, sellable))}
            </button>
          )}
        </div>
      );
    }
    if (isCurrent) return <CurrentBadge localization={localization} />;
    return (
      <button
        type="button"
        className={`desktop-settings-action${holding.subscribed ? "" : " primary"}`}
        disabled={busy || !sellable || !plan.catalogPlan}
        onClick={() => choose(plan)}
      >
        {t(planActionLabel(holding.subscribed, sellable))}
      </button>
    );
  };

  return (
    <>
      <CurrentPlan
        offer={current}
        holding={holding}
        showPrice={view.authoritative && !catalogUnavailable}
        usage={billing.usage ?? usage}
        addOns={view.addOns}
        localization={localization}
        scheduledAction={holding.scheduled && current.catalogPlan ? (
          <button
            type="button"
            className="desktop-settings-action"
            disabled={busy || !sellable}
            onClick={() => void controller.quotePlan(current.catalogPlan!, holding.seats)}
          >
            {t("settings.plan.keepCurrent")}
          </button>
        ) : undefined}
        action={holding.subscribed && effectiveSummary?.portal_available ? (
          <button
            type="button"
            className="desktop-settings-action"
            disabled={busy}
            onClick={() => void controller.openPortal()}
          >
            <span>{t("settings.plan.invoices")}</span>
            <ExternalLink size={12} aria-hidden="true" />
          </button>
        ) : undefined}
      />

      {billing.quote && (
        <SettingsSubsection title={t("settings.plan.quoteTitle")}>
          <SettingsValueRow
            label={t("settings.plan.quotePlan", {
              plan: t(`settings.plan.name.${planKey(billing.quote.target_plan_id)}`),
              count: billing.quote.target_seats,
            })}
            value={t("settings.plan.monthlyFor", {
              amount: formatMoney(billing.quote.target_amount_cents, billing.quote.currency, localization),
            })}
            action={(
              <button
                type="button"
                className="desktop-settings-action primary"
                disabled={billing.action !== null}
                onClick={() => void controller.confirmQuote().then(refreshAll)}
              >
                <span>{t(quoteTiming.confirm)}</span>
                {quoteTiming.opensBrowser && <ExternalLink size={12} aria-hidden="true" />}
              </button>
            )}
          />
          <p className="desktop-plan-note">{quoteTiming.note}</p>
        </SettingsSubsection>
      )}
      {billing.actionError && (
        <p className="desktop-plan-error" role="alert">{billing.actionError}</p>
      )}

      {(catalogUnavailable || loadError || billing.error) && (
        <p className="desktop-plan-note desktop-plan-team-prompt" role="status">
          <span>{t(!loadError && !billing.error && catalogUnavailable ? "settings.plan.changesUnavailable" : "cloud.billing.loadFailed")}</span>
          <button type="button" className="desktop-settings-action" disabled={busy} onClick={refreshAll}>
            {t("cloud.common.refresh")}
          </button>
        </p>
      )}

      {canManageBilling === false && <p className="desktop-plan-note">{t("settings.plan.space.managedByOwner")}</p>}
      {!catalogUnavailable && <PlanComparison
        plans={spacePlans}
        holding={holding}
        signedIn
        localization={localization}
        renderAction={owner ? renderAction : (plan) => plan.id === current.id
          ? <CurrentBadge localization={localization} />
          : null}
      />}
      {!catalogUnavailable && spaceKind === "personal" && onCreateTeam && (
        <p className="desktop-plan-note desktop-plan-team-prompt">
          <button type="button" className="desktop-settings-action" onClick={onCreateTeam}>
            {t("settings.plan.space.createTeam")}
          </button>
        </p>
      )}
      {!catalogUnavailable && <PlanFinePrint localization={localization} />}

      {!catalogUnavailable && owner && holding.subscribed && view.addOns.some((addOn) => addOn.availableOn.includes(holding.planId)) && (
        <AddOns
          session={session}
          apiBaseUrl={apiBaseUrl}
          organizationId={organizationId}
          onSessionChange={onSessionChange}
          addOns={view.addOns.filter((addOn) => addOn.availableOn.includes(holding.planId))}
          holding={holding}
          sellable={sellable}
          localization={localization}
          onChanged={refreshAll}
        />
      )}
    </>
  );
}

function describeScheduledChange(holding: PlanHolding, localization: LocalizationContextValue): string {
  const { t } = localization;
  const scheduled = holding.scheduled!;
  const date = localization.formatDate(scheduled.effectiveAt, { month: "short", day: "numeric" });
  if (scheduled.planId === holding.planId) {
    return t("settings.plan.scheduledSeats", { count: scheduled.seats, date });
  }
  return t("settings.plan.scheduledPlan", {
    plan: t(`settings.plan.name.${planKey(String(scheduled.planId))}`),
    date,
  });
}

/**
 * What confirming a quote will do, in words: pay now, wait for renewal, or
 * withdraw a scheduled change by keeping what is held.
 */
export function describeQuoteTiming(
  quote: DesktopBillingQuote | null,
  holding: PlanHolding,
  localization: LocalizationContextValue,
): { confirm: string; note: string; opensBrowser: boolean } {
  const { t } = localization;
  const keeps = quote !== null
    && holding.scheduled !== null
    && planKey(quote.target_plan_id) === holding.planId
    && quote.target_seats === holding.seats;
  if (keeps) {
    return { confirm: "settings.plan.keepCurrent", note: t("settings.plan.quoteKeep"), opensBrowser: false };
  }
  if (quote?.effective === "next_period" && holding.renewsAt) {
    return {
      confirm: "settings.plan.confirmSchedule",
      note: t("settings.plan.quoteNextPeriod", {
        date: localization.formatDate(holding.renewsAt, { month: "short", day: "numeric" }),
      }),
      opensBrowser: false,
    };
  }
  return { confirm: "settings.plan.confirmAndPay", note: t("settings.plan.quoteNote"), opensBrowser: true };
}

/** The plan held, and this period's agent hours and storage against it. */
export function CurrentPlan({
  offer,
  holding,
  usage,
  addOns,
  localization,
  action,
  scheduledAction,
  showPrice = true,
}: {
  offer: PlanOffer;
  holding: PlanHolding;
  usage: DesktopBillingUsage | null;
  addOns: readonly AddOnOffer[];
  localization: LocalizationContextValue;
  action?: ReactNode;
  /** Withdraws a scheduled downgrade; shown beside it. */
  scheduledAction?: ReactNode;
  showPrice?: boolean;
}) {
  const { t } = localization;
  const reading = resolveAllowance(usage, offer, holding, addOns);
  // Older services report a balance without a monthly allowance. Show that
  // balance directly rather than presenting a locally assumed monthly grant.
  const availableHours = reading.usedHours === null && Number.isFinite(usage?.runtime.available_units)
    ? unitsToHours(usage!.runtime.available_units) : null;
  const hoursUsed = reading.usedHours ?? availableHours;
  const hoursValue = hoursUsed === null ? null : formatHours(hoursUsed, localization);
  const hoursDetailKey = availableHours !== null ? "settings.plan.gaugeAvailable" : "settings.plan.gaugeIncluded";
  const status = planStatus(holding);
  const facts: string[] = [];
  if (holding.subscribed) {
    // Until the catalog answers, the plan's own price stands in for the total.
    const monthly = holding.monthlyCents ?? offer.priceCents * (offer.perPerson ? holding.seats : 1);
    if (showPrice) facts.push(t("settings.plan.monthlyFor", { amount: formatMoney(monthly, holding.currency, localization) }));
    if (offer.perPerson) facts.push(t("settings.plan.peopleUnit", { count: holding.seats }));
  }
  const date = holding.renewsAt
    ? t(holding.cancelAtPeriodEnd ? "settings.plan.endsOn" : "settings.plan.renewsOn", {
      date: localization.formatDate(holding.renewsAt, { month: "short", day: "numeric" }),
    })
    : null;
  const storagePercent = percentOf(reading.usedBytes, reading.includedBytes);
  const resets = reading.resetsAt
    ? t("settings.plan.resetsOn", {
      date: localization.formatDate(reading.resetsAt, { month: "short", day: "numeric" }),
    })
    : null;

  return (
    <div className="desktop-plan-overview">
      <SettingsSubsection title={t("settings.plan.currentLabel")}>
        <div className="desktop-settings-row desktop-plan-summary">
          <div className="desktop-plan-summary-main">
            <div className="desktop-plan-summary-heading">
              <h4>{t(`settings.plan.name.${offer.id}`)}</h4>
              {status !== "free" && (
                <span className={`desktop-plan-status is-${status}`}>{t(`settings.plan.status.${status}`)}</span>
              )}
            </div>
            {(facts.length > 0 || date) && (
              <p className="desktop-plan-summary-detail">{[...facts, date].filter(Boolean).join(" · ")}</p>
            )}
          </div>
          {action}
        </div>
        {holding.scheduled && (
          <SettingsValueRow
            label={t("settings.plan.scheduledLabel")}
            value={describeScheduledChange(holding, localization)}
            action={scheduledAction}
          />
        )}
      </SettingsSubsection>
      <div className="desktop-plan-usage">
        <UsageMeter
          kind="hours"
          label={t("settings.plan.hoursLabel")}
          used={availableHours !== null ? t("settings.plan.gaugeHours", { hours: hoursValue! }) : hoursValue}
          total={availableHours !== null ? null : t("settings.plan.gaugeHours", { hours: formatHours(reading.includedHours, localization) })}
          percent={percentOf(reading.usedHours, reading.includedHours)}
          detail={reading.usedHours === null ? t(hoursDetailKey) : resets}
        />
        <UsageMeter
          kind="storage"
          label={t("settings.plan.storageLabel")}
          used={reading.usedBytes === null ? null : formatStorage(reading.usedBytes, localization)}
          total={reading.includedBytes === null ? null : formatStorage(reading.includedBytes, localization)}
          percent={storagePercent}
          detail={storagePercent === null
            ? t("settings.plan.gaugeIncluded")
            : t("settings.plan.gaugePercent", { percent: localization.formatNumber(Math.round(storagePercent)) })}
        />
      </div>
    </div>
  );
}

type PlanStatus = "free" | "active" | "ending" | "attention" | "updating";

function planStatus(holding: PlanHolding): PlanStatus {
  if (!holding.subscribed) return "free";
  if (holding.status === "past_due" || holding.status === "disputed") return "attention";
  if (holding.cancelAtPeriodEnd || holding.status === "cancel_scheduled") return "ending";
  if (holding.status === "change_pending") return "updating";
  return "active";
}

function percentOf(used: number | null, total: number | null): number | null {
  if (used === null || total === null || total <= 0) return null;
  return Math.max(0, Math.min(100, (used / total) * 100));
}

/** Keep the track visible; only authoritative readings light its bars. */
function UsageMeter({
  kind,
  label,
  used,
  total,
  percent,
  detail,
}: {
  kind: "hours" | "storage";
  label: string;
  used: string | null;
  total: string | null;
  percent: number | null;
  detail: string | null;
}) {
  return (
    <div className="desktop-plan-usage-item">
      <PlanUsageBar percent={percent} kind={kind} label={label} reading={[used, total].filter((value) => value !== null).join(" / ")} />
      <div className="desktop-plan-usage-heading">
        <span>{label}</span>
        <span className="desktop-plan-usage-value">
          {used ?? total ?? "—"}
          {used !== null && total !== null && <span> / {total}</span>}
        </span>
      </div>
      {detail && <span className="desktop-plan-usage-detail">{detail}</span>}
    </div>
  );
}

/**
 * Plans, hours and storage belong to one organization. Someone in a team sees
 * their personal space first and can switch to each team they belong to.
 */
export function OrganizationSwitch({
  organizations,
  selectedId,
  onSelect,
  localization,
  loading = false,
  visible = organizations.length > 0,
}: {
  organizations: readonly { id: string; name: string; personal: boolean }[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  localization: LocalizationContextValue;
  loading?: boolean;
  visible?: boolean;
}) {
  const { t } = localization;
  if (!visible) return null;
  if (organizations.length < 2) {
    const organization = organizations[0];
    let value: ReactNode = loading
      ? <span className="desktop-plan-placeholder name" data-placeholder-shape="" aria-label={t("settings.plan.loading")} /> : "—";
    if (organization) value = organization.personal ? t("settings.plan.org.personal") : organization.name;
    return <SettingsValueRow label={t("settings.plan.org.label")} value={value} />;
  }
  return (
    <SettingsValueRow
      label={t("settings.plan.org.label")}
      value={(
        <select
          className="desktop-settings-select desktop-plan-space-select"
          aria-label={t("settings.plan.org.label")}
          value={selectedId ?? ""}
          onChange={(event) => onSelect(event.target.value)}
        >
          {selectedId === null && <option value="" disabled>—</option>}
          {organizations.map((organization) => (
            <option key={organization.id} value={organization.id}>
              {organization.personal ? t("settings.plan.org.personal") : organization.name}
            </option>
          ))}
        </select>
      )}
    />
  );
}

/** Comparable plan cards use the same typography and controls as Settings. */
export function PlanComparison({
  plans,
  holding,
  signedIn,
  localization,
  renderAction,
}: {
  plans: readonly PlanOffer[];
  holding: PlanHolding;
  signedIn: boolean;
  localization: LocalizationContextValue;
  renderAction: (plan: PlanOffer) => ReactNode;
}) {
  const { t } = localization;
  return (
    <div className="desktop-plan-comparison">
      <SettingsSubsection title={t("settings.plan.chooseTitle")}>
        <div className="desktop-plan-grid" role="list" style={{ "--desktop-plan-columns": plans.length } as CSSProperties}>
          {plans.map((plan) => {
            const current = signedIn && plan.id === holding.planId;
            const perPerson = (value: string) => plan.perPerson
              ? t("settings.plan.spec.perPerson", { value })
              : value;
            const historyDays = plan.historyDays ?? 30;
            const specs: Array<[string, string]> = [
              [t("settings.plan.hoursLabel"), t(plan.perPerson ? "settings.plan.spec.hoursPerPerson" : "settings.plan.spec.hours", {
                hours: formatHours(plan.agentHours, localization),
              })],
              [t("settings.plan.storageLabel"), plan.storageBytes === null
                ? t("settings.plan.custom")
                : perPerson(formatStorage(plan.storageBytes, localization))],
              [t("settings.plan.spec.projects"), plan.projects === null
                ? t("settings.plan.spec.unlimited")
                : perPerson(localization.formatNumber(plan.projects))],
              [t("settings.plan.spec.history"), historyDays >= 365
                ? t("settings.plan.spec.years", { count: Math.round(historyDays / 365) })
                : t("settings.plan.spec.days", { count: historyDays })],
            ];
            return (
              <div
                key={plan.id}
                role="listitem"
                className={`desktop-plan-card${current ? " current" : ""}`}
                aria-current={current ? "true" : undefined}
              >
                <div className="desktop-plan-card-head">
                  <h4 className="desktop-plan-card-name">{t(`settings.plan.name.${plan.id}`)}</h4>
                  <span className="desktop-plan-card-price">
                    <span className="desktop-plan-card-amount">{formatCurrency(plan.priceCents, plan.currency, localization)}</span>
                    <span className="desktop-plan-card-per">
                      {t(plan.perPerson ? "settings.plan.spec.perPersonMonth" : "settings.plan.spec.perMonth")}
                    </span>
                  </span>
                </div>
                <dl className="desktop-plan-spec">
                  {specs.map(([label, value]) => (
                    <div key={label} className="desktop-plan-spec-row">
                      <dt>{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
                <div className="desktop-plan-card-action">{renderAction(plan)}</div>
              </div>
            );
          })}
        </div>
      </SettingsSubsection>
    </div>
  );
}

export function PlanFinePrint({ localization }: { localization: LocalizationContextValue }) {
  return <p className="desktop-plan-note">{localization.t("settings.plan.finePrint")}</p>;
}

function CurrentBadge({ localization }: { localization: LocalizationContextValue }) {
  return (
    <span className="desktop-plan-current-badge">
      <Check size={13} aria-hidden="true" />
      {localization.t("settings.plan.current")}
    </span>
  );
}

type AddOnDraft = { id: string; quantity: number };

/** Extra hours and storage, as monthly packs on top of a paid plan. */
export function AddOns({
  session,
  apiBaseUrl,
  organizationId,
  onSessionChange,
  addOns,
  holding,
  sellable,
  localization,
  onChanged,
}: {
  session: DesktopCloudSession;
  apiBaseUrl: string | null;
  organizationId: string;
  onSessionChange: (session: DesktopCloudSession | null) => void;
  addOns: readonly AddOnOffer[];
  holding: PlanHolding;
  sellable: boolean;
  localization: LocalizationContextValue;
  onChanged: () => void;
}) {
  const { t } = localization;
  const [draft, setDraft] = useState<AddOnDraft | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ tone: "note" | "error"; text: string } | null>(null);
  const keyRef = useRef<{ intent: string; key: string } | null>(null);

  const draftOffer = draft ? addOns.find((addOn) => addOn.id === draft.id) ?? null : null;
  const held = draft ? holding.addOns[draft.id] ?? 0 : 0;

  const confirm = async () => {
    if (!draft || !draftOffer) return;
    const intent = `${organizationId}:${draft.id}:${draft.quantity}`;
    if (keyRef.current?.intent !== intent) {
      keyRef.current = { intent, key: createDesktopBillingIdempotencyKey(`add-on:${draft.id}`) };
    }
    setPending(true);
    setMessage(null);
    try {
      const change = await changeCloudBillingAddOn(
        session,
        organizationId,
        draft.id,
        draft.quantity,
        keyRef.current.key,
        onSessionChange,
        apiBaseUrl,
      );
      keyRef.current = null;
      if (change.outcome === "checkout" && change.checkout_url) {
        await openCloudBillingExternalUrl(change.checkout_url);
        setMessage({ tone: "note", text: t("settings.plan.addOnCheckoutOpened") });
      } else if (change.outcome === "pending_provider_confirmation") {
        setMessage({ tone: "note", text: t("settings.plan.addOnPending") });
      }
      setDraft(null);
      onChanged();
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof Error ? error.message : t("settings.plan.addOnFailed"),
      });
    } finally {
      setPending(false);
    }
  };

  return (
    <SettingsSubsection title={t("settings.plan.addOnsTitle")}>
      {addOns.map((addOn) => {
        const heldQuantity = holding.addOns[addOn.id] ?? 0;
        const shown = draft?.id === addOn.id ? draft.quantity : heldQuantity;
        return (
          <div key={addOn.id} className="desktop-settings-row desktop-plan-addon">
            <div className="desktop-plan-addon-main">
              <span>{t(`settings.plan.addOn.${addOn.kind}`)}</span>
              <span className="desktop-plan-addon-detail">
                {t(`settings.plan.addOn.${addOn.kind}Detail`, {
                  hours: formatHours(addOn.hours, localization),
                  amount: formatStorage(addOn.storageBytes, localization),
                  price: formatMoney(addOn.priceCents, addOn.currency, localization),
                })}
              </span>
            </div>
            <QuantityStepper
              label={t(`settings.plan.addOn.${addOn.kind}`)}
              value={shown}
              minimum={0}
              maximum={addOn.maxQuantity}
              disabled={pending || !sellable || (draft !== null && draft.id !== addOn.id)}
              onChange={(quantity) => setDraft(quantity === heldQuantity ? null : { id: addOn.id, quantity })}
              localization={localization}
            />
          </div>
        );
      })}
      {draft && draftOffer && (
        <SettingsValueRow
          label={t("settings.plan.addOnChangeLabel")}
          value={t(draft.quantity > held ? "settings.plan.addOnMoreNow" : "settings.plan.addOnFewerNext", {
            amount: formatMoney(
              Math.abs(draft.quantity - held) * draftOffer.priceCents,
              draftOffer.currency,
              localization,
            ),
            total: formatMoney(draft.quantity * draftOffer.priceCents, draftOffer.currency, localization),
          })}
          action={(
            <span className="desktop-plan-inline-actions">
              <button type="button" className="desktop-settings-action" disabled={pending} onClick={() => setDraft(null)}>
                {t("settings.plan.cancel")}
              </button>
              <button
                type="button"
                className="desktop-settings-action primary"
                disabled={pending}
                onClick={() => void confirm()}
              >
                <span>{t(held === 0 ? "settings.plan.confirmAndPay" : "settings.plan.confirm")}</span>
                {held === 0 && <ExternalLink size={12} aria-hidden="true" />}
              </button>
            </span>
          )}
        />
      )}
      {message && (
        <p className={message.tone === "error" ? "desktop-plan-error" : "desktop-plan-note"} role={message.tone === "error" ? "alert" : "status"}>
          {message.text}
        </p>
      )}
    </SettingsSubsection>
  );
}

function QuantityStepper({
  label,
  value,
  minimum,
  maximum,
  disabled,
  onChange,
  localization,
  unit,
}: {
  label: string;
  value: number;
  minimum: number;
  maximum: number;
  disabled: boolean;
  onChange: (value: number) => void;
  localization: LocalizationContextValue;
  unit?: string;
}) {
  const { t } = localization;
  return (
    <span className="desktop-plan-stepper" role="group" aria-label={label}>
      <button
        type="button"
        className="desktop-settings-action"
        aria-label={t("settings.plan.decrease", { label })}
        disabled={disabled || value <= minimum}
        onClick={() => onChange(Math.max(minimum, value - 1))}
      >
        <Minus size={12} aria-hidden="true" />
      </button>
      <output className="desktop-plan-stepper-value" aria-live="polite">{unit ?? localization.formatNumber(value)}</output>
      <button
        type="button"
        className="desktop-settings-action"
        aria-label={t("settings.plan.increase", { label })}
        disabled={disabled || value >= maximum}
        onClick={() => onChange(Math.min(maximum, value + 1))}
      >
        <Plus size={12} aria-hidden="true" />
      </button>
    </span>
  );
}

function teamActionLabel(onTeam: boolean, sellable: boolean): string {
  if (onTeam) return "settings.plan.changePeople";
  return sellable ? "settings.plan.upgrade" : "settings.plan.comingSoon";
}

function planActionLabel(subscribed: boolean, sellable: boolean): string {
  if (!sellable) return "settings.plan.comingSoon";
  return subscribed ? "settings.plan.switch" : "settings.plan.upgrade";
}

function planKey(planId: string): PlanId | "team" {
  if (planId === "plus" || planId === "personal") return "personal";
  if (planId === "free") return "free";
  return "team";
}

/**
 * Both the BFF and PuppyPay answer 404 while hosted subscriptions are switched
 * off. That is a product state, not a fault.
 */
function billingUnavailable(error: string | null): boolean {
  if (!error) return false;
  return /not available|not enabled|hosting_billing_disabled/i.test(error);
}
