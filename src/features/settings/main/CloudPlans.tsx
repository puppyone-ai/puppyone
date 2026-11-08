import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ExternalLink, Minus, Plus } from "lucide-react";
import type { LocalizationContextValue } from "@puppyone/localization";
import {
  changeCloudBillingAddOn,
  createDesktopBillingIdempotencyKey,
  openCloudBillingExternalUrl,
  type DesktopBillingCatalog,
  type DesktopBillingSummary,
  type DesktopBillingUsage,
  type DesktopCloudSession,
} from "../../../lib/cloudApi";
import { useCloudBillingController } from "../../cloud";
import { SettingsSubsection, SettingsValueRow } from "../components";
import {
  describeHoursReading,
  describeStorageReading,
  formatHours,
  formatMoney,
  meterTone,
  formatStorage,
  resolveAllowance,
  resolvePlanCatalog,
  resolvePlanHolding,
  TEAM_FEATURES,
  type AddOnOffer,
  type PlanHolding,
  type PlanId,
  type PlanOffer,
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
  onRefresh: () => void;
  localization: LocalizationContextValue;
  onSignIn: () => void;
  signInDisabled?: boolean;
};

/**
 * Plan: what you are on, what you have used, and what else you could be on.
 *
 * The page answers three questions in the order people ask them. First the
 * plan held and this period's agent hours and storage, so "am I running out?"
 * is answered before anything is sold. Then the three plans side by side, each
 * with one price and the same four lines, so they compare at a glance. Then,
 * for a paid plan, the two add-ons. Every change is quoted before it is paid,
 * and payment always finishes in the browser.
 *
 * Pricing rules live in `planPricing.ts`.
 */
export function CloudPlans(props: PlanPageProps) {
  const { session, organizationId } = props;
  if (session !== null && organizationId !== null) {
    return <ConnectedPlans {...props} session={session} organizationId={organizationId} />;
  }
  const view = resolvePlanCatalog(props.catalog);
  const holding = resolvePlanHolding(null, null);
  const waiting = session !== null;
  return (
    <>
      <PlanComparison
        plans={view.plans}
        holding={holding}
        signedIn={false}
        localization={props.localization}
        renderAction={() => (
          <button
            type="button"
            className="desktop-settings-action"
            disabled={waiting || props.signInDisabled}
            onClick={props.onSignIn}
          >
            {props.localization.t(waiting ? "settings.plan.loading" : "settings.plan.signInToChoose")}
          </button>
        )}
      />
      <PlanFinePrint localization={props.localization} />
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
  onRefresh,
  localization,
}: PlanPageProps & { session: DesktopCloudSession; organizationId: string }) {
  const { t } = localization;
  const controller = useCloudBillingController({
    session, apiBaseUrl, organizationId, enabled: true, onSessionChange, t,
  });
  const billing = controller.state;
  const view = resolvePlanCatalog(billing.catalog ?? catalog);
  const effectiveSummary = billing.summary ?? summary;
  const holding = resolvePlanHolding(effectiveSummary, billing.catalog ?? catalog);
  const current = view.plans.find((plan) => plan.id === holding.planId) ?? view.plans[0]!;
  const sellable = view.authoritative && !billingUnavailable(billing.error);
  const busy = billing.action !== null || loading;

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

  const refreshAll = useCallback(() => {
    controller.refresh();
    onRefresh();
  }, [controller, onRefresh]);

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
        usage={billing.usage ?? usage}
        addOns={view.addOns}
        localization={localization}
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
                <span>{t("settings.plan.confirmAndPay")}</span>
                <ExternalLink size={12} aria-hidden="true" />
              </button>
            )}
          />
          <p className="desktop-plan-note">{t("settings.plan.quoteNote")}</p>
        </SettingsSubsection>
      )}
      {billing.actionError && (
        <p className="desktop-plan-error" role="alert">{billing.actionError}</p>
      )}

      <PlanComparison
        plans={view.plans}
        holding={holding}
        signedIn
        localization={localization}
        renderAction={renderAction}
      />
      <PlanFinePrint localization={localization} />

      {holding.subscribed && view.addOns.some((addOn) => addOn.availableOn.includes(holding.planId)) && (
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

/** The plan held, and this period's agent hours and storage against it. */
function CurrentPlan({
  offer,
  holding,
  usage,
  addOns,
  localization,
  action,
}: {
  offer: PlanOffer;
  holding: PlanHolding;
  usage: DesktopBillingUsage | null;
  addOns: readonly AddOnOffer[];
  localization: LocalizationContextValue;
  action?: ReactNode;
}) {
  const { t } = localization;
  const reading = resolveAllowance(usage, offer, holding, addOns);
  const name = t(`settings.plan.name.${offer.id}`);
  const parts = [name];
  if (holding.subscribed && holding.monthlyCents !== null) {
    parts.push(t("settings.plan.monthlyFor", {
      amount: formatMoney(holding.monthlyCents, holding.currency, localization),
    }));
  }
  if (holding.subscribed && offer.perPerson) {
    parts.push(t("settings.plan.peopleUnit", { count: holding.seats }));
  }
  if (holding.renewsAt) {
    parts.push(t(holding.cancelAtPeriodEnd ? "settings.plan.endsOn" : "settings.plan.renewsOn", {
      date: localization.formatDate(holding.renewsAt, { month: "short", day: "numeric" }),
    }));
  }
  const resets = reading.resetsAt
    ? t("settings.plan.resetsOn", {
      date: localization.formatDate(reading.resetsAt, { month: "short", day: "numeric" }),
    })
    : null;

  return (
    <SettingsSubsection leading>
      <SettingsValueRow label={t("settings.plan.currentLabel")} value={parts.join(" · ")} action={action} />
      <MeterRow
        label={t("settings.plan.hoursLabel")}
        value={describeHoursReading(reading, localization)}
        detail={reading.usedHours === null ? null : resets}
        used={reading.usedHours}
        total={reading.includedHours}
      />
      <MeterRow
        label={t("settings.plan.storageLabel")}
        value={describeStorageReading(reading, localization)}
        detail={null}
        used={reading.usedBytes}
        total={reading.includedBytes}
      />
    </SettingsSubsection>
  );
}

/** A value row with its bar beneath, drawn only against an authoritative reading. */
function MeterRow({
  label,
  value,
  detail,
  used,
  total,
}: {
  label: string;
  value: string;
  detail: string | null;
  used: number | null;
  total: number | null;
}) {
  const percent = used === null || total === null || total <= 0
    ? null
    : Math.max(0, Math.min(100, (used / total) * 100));
  return (
    <div className="desktop-settings-row desktop-settings-value-row desktop-plan-meter-row">
      <span>{label}</span>
      <div className="desktop-settings-value">
        <span className="desktop-settings-value-text">
          {value}
          {detail && <span className="desktop-plan-meter-detail"> · {detail}</span>}
        </span>
      </div>
      {percent !== null && (
        <div
          className={`desktop-plan-meter-track${meterTone(percent)}`}
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(percent)}
        >
          <span style={{ width: `${percent}%` }} />
        </div>
      )}
    </div>
  );
}

/** Three plans side by side, each with one price and the same lines. */
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
    <SettingsSubsection title={t("settings.plan.chooseTitle")}>
      <div className="desktop-plan-grid" role="list">
        {plans.map((plan) => {
          const current = signedIn && plan.id === holding.planId;
          return (
            <div
              key={plan.id}
              role="listitem"
              className={`desktop-plan-card${current ? " current" : ""}`}
              aria-current={current ? "true" : undefined}
            >
              <div className="desktop-plan-card-head">
                <strong>{t(`settings.plan.name.${plan.id}`)}</strong>
                <span className="desktop-plan-card-price">
                  {plan.priceCents === 0
                    ? t("settings.plan.freePrice")
                    : t(plan.perPerson ? "settings.plan.pricePerPerson" : "settings.plan.pricePerMonth", {
                      amount: formatMoney(plan.priceCents, plan.currency, localization),
                    })}
                </span>
                <span className="desktop-plan-card-tagline">{t(`settings.plan.tagline.${plan.id}`)}</span>
              </div>
              <ul className="desktop-plan-card-lines">
                <li>{t(plan.perPerson ? "settings.plan.hoursPerPerson" : "settings.plan.hoursPerMonth", {
                  hours: formatHours(plan.agentHours, localization),
                })}</li>
                <li>{plan.storageBytes === null ? t("settings.plan.storageCustom") : t(
                  plan.perPerson ? "settings.plan.storagePerPerson" : "settings.plan.storageAmount",
                  { amount: formatStorage(plan.storageBytes, localization) },
                )}</li>
                <li>{plan.projects === null ? t("settings.plan.projectsUnlimited") : t(
                  plan.perPerson ? "settings.plan.projectsPerPerson" : "settings.plan.projects",
                  { count: plan.projects },
                )}</li>
                <li>{t("settings.plan.historyDays", { count: plan.historyDays ?? 365 })}</li>
                {plan.teamFeatures && TEAM_FEATURES.map((feature) => (
                  <li key={feature} className="desktop-plan-card-feature">
                    <Check size={12} aria-hidden="true" />
                    {t(`settings.plan.feature.${feature.replace(".", "_")}`)}
                  </li>
                ))}
              </ul>
              <div className="desktop-plan-card-action">{renderAction(plan)}</div>
            </div>
          );
        })}
      </div>
    </SettingsSubsection>
  );
}

function PlanFinePrint({ localization }: { localization: LocalizationContextValue }) {
  return <p className="desktop-plan-note">{localization.t("settings.plan.finePrint")}</p>;
}

function CurrentBadge({ localization }: { localization: LocalizationContextValue }) {
  return <span className="desktop-plan-current-badge">{localization.t("settings.plan.current")}</span>;
}

type AddOnDraft = { id: string; quantity: number };

/** Extra hours and storage, as monthly packs on top of a paid plan. */
function AddOns({
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
          <SettingsValueRow
            key={addOn.id}
            label={t(`settings.plan.addOn.${addOn.kind}`)}
            value={t(`settings.plan.addOn.${addOn.kind}Detail`, {
              hours: formatHours(addOn.hours, localization),
              amount: formatStorage(addOn.storageBytes, localization),
              price: formatMoney(addOn.priceCents, addOn.currency, localization),
            })}
            action={(
              <QuantityStepper
                label={t(`settings.plan.addOn.${addOn.kind}`)}
                value={shown}
                minimum={0}
                maximum={addOn.maxQuantity}
                disabled={pending || !sellable || (draft !== null && draft.id !== addOn.id)}
                onChange={(quantity) => setDraft(quantity === heldQuantity ? null : { id: addOn.id, quantity })}
                localization={localization}
              />
            )}
          />
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
