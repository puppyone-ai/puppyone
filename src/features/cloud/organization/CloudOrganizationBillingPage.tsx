import { useMemo, type ReactNode } from "react";
import {
  Check,
  Clock3,
  CreditCard,
  Database,
  ExternalLink,
  RefreshCw,
  ShieldAlert,
  Zap,
} from "lucide-react";
import { bidiIsolate } from "@puppyone/localization/core";
import "./organization.css";
import { useLocalization, type LocalizationContextValue } from "@puppyone/localization/react";
import {
  type DesktopBillingPlan,
} from "../../../lib/cloudApi";
import { formatCloudMessage } from "../cloudPresentation";
import { useCloudBillingController } from "../billing/useCloudBillingController";
import {
  CloudOrganizationSelector,
  CloudOrganizationPageShell,
  type CloudOrganizationPageProps,
  useCloudOrganizationAccess,
  useCloudOrganizationData,
} from "./CloudOrganizationTeamPage";

type CloudBillingPageProps = Pick<
  CloudOrganizationPageProps,
  "session" | "apiBaseUrl" | "onSessionChange"
>;

export function CloudOrganizationBillingPage({
  session,
  apiBaseUrl,
  onSessionChange,
}: CloudBillingPageProps) {
  const localization = useLocalization();
  const { t } = localization;
  const orgData = useCloudOrganizationData(
    session,
    apiBaseUrl,
    onSessionChange,
    { loadTeamDetails: false },
  );
  const organization = orgData.organization;
  const organizationAccess = useCloudOrganizationAccess(
    session,
    apiBaseUrl,
    organization?.id ?? null,
    onSessionChange,
  );
  const isOwner = organizationAccess.status === "ready"
    && organizationAccess.access?.can_manage_billing === true;
  const controller = useCloudBillingController({
    session,
    apiBaseUrl,
    organizationId: organization?.id ?? null,
    enabled: Boolean(organization && isOwner),
    onSessionChange,
    t,
  });
  const billing = controller.state;
  const organizationNeedsRetry = orgData.error !== null || organizationAccess.error !== null;

  const currentPlan = useMemo(
    () => billing.catalog?.plans.find((plan) => plan.id === billing.summary?.plan_id) ?? null,
    [billing.catalog, billing.summary?.plan_id],
  );
  return (
    <CloudOrganizationPageShell
      title={t("cloud.route.cloud-billing.title")}
      actions={(
        <>
          <CloudOrganizationSelector organizationData={orgData} />
          <button
            className="desktop-cloud-org-secondary-button"
            type="button"
            onClick={() => {
              if (organizationNeedsRetry) {
                orgData.refresh();
                organizationAccess.refresh();
                return;
              }
              void controller.refresh();
            }}
            disabled={orgData.loading
              || organizationAccess.loading
              || (!organizationNeedsRetry && (billing.loading || !isOwner))}
          >
            <RefreshCw size={14} />
            <span>{t("cloud.common.refresh")}</span>
          </button>
        </>
      )}
    >
      <div className="desktop-cloud-billing-stack">
        {orgData.status === "none" && (
          <BillingNotice icon={<ShieldAlert size={16} />} title={t("cloud.billing.noOrganization")} />
        )}
        {orgData.status === "selection-required" && (
          <BillingNotice
            icon={<ShieldAlert size={16} />}
            title={t("cloud.organization.selectionRequired")}
          />
        )}
        {organization && organizationAccess.status === "ready" && !isOwner && (
          <BillingNotice
            icon={<ShieldAlert size={16} />}
            title={t("cloud.billing.ownerRequired")}
            detail={t("cloud.billing.ownerRequiredDetail")}
          />
        )}
        {orgData.error && (
          <div className="desktop-cloud-org-inline-error standalone">
            <strong>{t("cloud.billing.loadFailed")}</strong>
            <span>{formatCloudMessage(orgData.error, t)}</span>
          </div>
        )}
        {organizationAccess.error && (
          <div className="desktop-cloud-org-inline-error standalone">
            <strong>{t("cloud.billing.loadFailed")}</strong>
            <span>{formatCloudMessage(organizationAccess.error, t)}</span>
          </div>
        )}
        {(billing.error || billing.actionError) && (
          <div className="desktop-cloud-org-inline-error standalone">
            <strong>{t("cloud.billing.loadFailed")}</strong>
            <span>{billing.actionError ?? billing.error}</span>
          </div>
        )}
        {billing.polling && (
          <BillingNotice
            icon={<Clock3 size={16} />}
            title={t("cloud.billing.waitingForAuthority")}
          />
        )}

        {billing.summary && currentPlan && (
          <section className="desktop-cloud-billing-current">
            <div className="desktop-cloud-billing-current-main">
              <div>
                <div className="desktop-cloud-billing-title-row">
                  <span>{t("cloud.billing.currentPlan")}</span>
                  <h2>{currentPlan.name}</h2>
                  <em>{t(`cloud.billing.subscriptionStatus.${billing.summary.status}`)}</em>
                </div>
                <p>{currentPlan.description}</p>
              </div>
              <div className="desktop-cloud-billing-price">
                <strong>{formatMonthlyTotal(currentPlan, billing.summary.seat_quantity, localization)}</strong>
                <span>{currentPlan.interval === "month" ? t("cloud.billing.perMonth") : ""}</span>
                <small>{t("cloud.billing.currentSeats", { count: billing.summary.seat_quantity })}</small>
              </div>
            </div>
            <div className="desktop-cloud-billing-summary">
              {billing.summary.pending_plan_id && (
                <span className="desktop-cloud-plan-feature"><Clock3 size={14} />{t("cloud.billing.pendingPlan", { plan: billing.summary.pending_plan_id })}</span>
              )}
              {billing.summary.cancel_at_period_end && (
                <span className="desktop-cloud-plan-feature"><Clock3 size={14} />{t("cloud.billing.cancelPending")}</span>
              )}
              {billing.summary.portal_available && (
                <button className="desktop-cloud-billing-inline-action" type="button" onClick={() => void controller.openPortal()} disabled={billing.action !== null}>
                  {t("cloud.billing.managePortal")} <ExternalLink size={12} />
                </button>
              )}
            </div>
          </section>
        )}

        {billing.usage && (
          <section className="desktop-cloud-billing-usage-grid">
            <UsageCard
              icon={<Zap size={16} />}
              title={t("cloud.billing.runtimeUsage")}
              value={t("cloud.billing.runtimeAvailable", { count: billing.usage.runtime.available_units })}
              detail={t("cloud.billing.runtimeDetail", {
                consumed: billing.usage.runtime.consumed_units,
                reserved: billing.usage.runtime.reserved_units,
              })}
              percent={ratioPercent(
                billing.usage.runtime.consumed_units,
                billing.usage.runtime.granted_units,
              )}
            />
            <UsageCard
              icon={<Database size={16} />}
              title={t("cloud.billing.storageUsage")}
              value={formatBytes(billing.usage.storage.logical_bytes, localization)}
              detail={billing.usage.storage.limit_bytes === null
                ? t("cloud.billing.unlimited")
                : t("cloud.billing.storageLimit", {
                  limit: formatBytes(billing.usage.storage.limit_bytes, localization),
                })}
              percent={billing.usage.storage.percent}
              warning={billing.usage.storage.threshold_percent >= 80}
            />
          </section>
        )}

        {billing.catalog && billing.summary && (
          <section className="desktop-cloud-billing-options">
            <div className="desktop-cloud-billing-options-header">
              <div>
                <h2>{t("cloud.billing.upgradeOptions")}</h2>
              </div>
              <label className="desktop-cloud-billing-seat-control">
                <span>{t("cloud.billing.seatQuantity")}</span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={billing.seatQuantity}
                  onChange={(event) => controller.setSeatQuantity(Number.parseInt(event.target.value, 10))}
                  aria-label={t("cloud.billing.seatQuantity")}
                />
                <button
                  type="button"
                  onClick={() => void controller.quoteSeats()}
                  disabled={billing.action !== null || !billing.summary.seat_changes_available}
                >
                  {t("cloud.billing.quoteSeatChange")}
                </button>
              </label>
            </div>
            <div className="desktop-cloud-billing-plan-grid">
              {billing.catalog.plans.filter((plan) => plan.public).map((plan) => (
                <CatalogPlanCard
                  key={plan.id}
                  plan={plan}
                  current={plan.id === billing.summary?.plan_id}
                  localization={localization}
                  busy={billing.action !== null}
                  onQuote={() => void controller.quotePlan(plan)}
                />
              ))}
            </div>
          </section>
        )}

        {billing.quote && (
          <section className="desktop-cloud-billing-quote" aria-live="polite">
            <div>
              <span>{t("cloud.billing.quote")}</span>
              <h2>{t("cloud.billing.quoteSummary", {
                plan: billing.quote.target_plan_id,
                count: billing.quote.target_seats,
              })}</h2>
              <p>{t("cloud.billing.quoteExpires", {
                time: localization.formatDate(new Date(billing.quote.expires_at), {
                  dateStyle: "medium",
                  timeStyle: "short",
                }),
              })}</p>
            </div>
            <div className="desktop-cloud-billing-quote-price">
              <strong>{formatCurrency(billing.quote.target_amount_cents, billing.quote.currency, localization)}</strong>
              <span>{t("cloud.billing.perMonth")}</span>
              <small>{t("cloud.billing.quoteDelta", {
                amount: formatCurrency(billing.quote.delta_amount_cents, billing.quote.currency, localization),
              })}</small>
            </div>
            {(billing.quote.target_plan_id !== billing.requestedPlanId || billing.quote.details.crosses_plan_boundary === true) && (
              <div className="desktop-cloud-billing-boundary-warning">
                <ShieldAlert size={16} />
                <span>{t("cloud.billing.boundaryChange", { plan: billing.quote.target_plan_id })}</span>
              </div>
            )}
            <button type="button" className="primary" onClick={() => void controller.confirmQuote()} disabled={billing.action !== null}>
              <CreditCard size={14} />
              {t("cloud.billing.confirmQuotedChange")}
            </button>
          </section>
        )}

        {controller.pendingOperations.length > 0 && (
          <BillingNotice
            icon={<Clock3 size={16} />}
            title={t("cloud.billing.pendingOperations", { count: controller.pendingOperations.length })}
            detail={[...new Set(controller.pendingOperations.map((operation) => t(`cloud.billing.operationStatus.${operation.state}`)))].join(" · ")}
            action={controller.actionableSeatOperation && (
              <button
                type="button"
                onClick={() => void controller.quoteSeats(controller.actionableSeatOperation)}
                disabled={billing.action !== null}
              >
                {t("cloud.billing.quoteSeatChange")}
              </button>
            )}
          />
        )}

        {billing.summary && <details className="desktop-cloud-billing-note">
          <summary>{t("cloud.common.details")}</summary>
          <p>{t("cloud.billing.catalogVersion", { version: billing.summary.catalog_version })}</p>
          <p>{t("cloud.billing.sourceRevision", { revision: billing.summary.source_revision })}</p>
          {controller.pendingOperations.map((operation) => <p key={operation.id} dir="ltr">{operation.id}: {operation.state}{operation.error_code ? ` · ${operation.error_code}` : ""}</p>)}
        </details>}
        {billing.catalog && (
          <div className="desktop-cloud-billing-note">
            <span>{t("cloud.billing.secure")} <ExternalLink size={12} /></span>
          </div>
        )}
      </div>
    </CloudOrganizationPageShell>
  );
}

function CatalogPlanCard({
  plan,
  current,
  localization,
  busy,
  onQuote,
}: {
  plan: DesktopBillingPlan;
  current: boolean;
  localization: LocalizationContextValue;
  busy: boolean;
  onQuote: () => void;
}) {
  const { t } = localization;
  const facts = catalogFacts(plan, localization);
  return (
    <article className={`desktop-cloud-billing-plan-card ${plan.highlighted ? "recommended" : ""}`}>
      <div>
        <div className="desktop-cloud-billing-plan-heading">
          <h3>{plan.name}</h3>
          {current && <span>{t("cloud.billing.current")}</span>}
        </div>
        <p>{plan.description}</p>
      </div>
      <div className="desktop-cloud-billing-plan-price">
        <strong>{formatPerSeatPrice(plan, localization)}</strong>
        {plan.price_per_seat_cents !== null && plan.interval === "month" && (
          <span>{t("cloud.billing.perSeatMonth")}</span>
        )}
      </div>
      <div className="desktop-cloud-billing-plan-features">
        {facts.map((fact) => (
          <span className="desktop-cloud-plan-feature" key={fact}>
            <Check size={14} /><span>{fact}</span>
          </span>
        ))}
      </div>
      <button
        className={plan.highlighted ? "primary" : ""}
        type="button"
        onClick={onQuote}
        disabled={busy || current || !plan.purchasable}
      >
        <CreditCard size={14} />
        <span>{current
          ? t("cloud.billing.currentPlan")
          : plan.purchasable
            ? t("cloud.billing.requestQuote")
            : t("cloud.billing.contactUs")}</span>
      </button>
    </article>
  );
}

function UsageCard({ icon, title, value, detail, percent, warning = false }: {
  icon: ReactNode;
  title: string;
  value: string;
  detail: string;
  percent: number | null;
  warning?: boolean;
}) {
  const boundedPercent = percent === null ? null : Math.max(0, Math.min(100, percent));
  return (
    <article className={`desktop-cloud-billing-usage-card ${warning ? "warning" : ""}`}>
      <header>{icon}<span>{title}</span></header>
      <strong>{value}</strong>
      <small>{detail}</small>
      {boundedPercent !== null && (
        <div className="desktop-cloud-billing-meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={boundedPercent}>
          <span style={{ width: `${boundedPercent}%` }} />
        </div>
      )}
    </article>
  );
}

function BillingNotice({
  icon,
  title,
  detail,
  action,
}: {
  icon: ReactNode;
  title: string;
  detail?: string;
  action?: ReactNode;
}) {
  return (
    <div className="desktop-cloud-billing-notice">
      {icon}
      <div><strong>{title}</strong>{detail && <span>{detail}</span>}</div>
      {action}
    </div>
  );
}

function catalogFacts(plan: DesktopBillingPlan, localization: LocalizationContextValue): string[] {
  const { t } = localization;
  const maximum = plan.seats.maximum === null
    ? t("cloud.billing.unlimited")
    : localization.formatNumber(plan.seats.maximum);
  const facts = [t("cloud.billing.seatRange", {
    minimum: localization.formatNumber(plan.seats.minimum),
    maximum,
  })];
  const storagePerSeat = plan.per_seat_limits["storage.max_bytes"];
  const fixedStorage = plan.fixed_limits["storage.max_bytes"];
  if (storagePerSeat !== undefined) {
    facts.push(t("cloud.billing.storagePerSeat", { amount: formatBytes(storagePerSeat, localization) }));
  } else if (typeof fixedStorage === "number") {
    facts.push(t("cloud.billing.storageIncluded", { amount: formatBytes(fixedStorage, localization) }));
  }
  const scopes = plan.fixed_limits["repo_scopes.max_per_project"];
  facts.push(t("cloud.billing.scopesPerProject", {
    count: scopes === null ? t("cloud.billing.unlimited") : localization.formatNumber(scopes ?? 0),
  }));
  const upload = plan.fixed_limits["upload.max_single_file_bytes"];
  if (typeof upload === "number") {
    facts.push(t("cloud.billing.singleFileLimit", { amount: formatBytes(upload, localization) }));
  }
  const runtime = plan.runtime.units_per_seat;
  if (runtime > 0) {
    facts.push(t("cloud.billing.runtimePerSeat", { count: localization.formatNumber(runtime) }));
  }
  return facts;
}

function formatPerSeatPrice(plan: DesktopBillingPlan, localization: LocalizationContextValue): string {
  if (plan.price_per_seat_cents === null) return localization.t("cloud.billing.custom");
  return formatCurrency(plan.price_per_seat_cents, plan.currency, localization);
}

function formatMonthlyTotal(
  plan: DesktopBillingPlan,
  seats: number,
  localization: LocalizationContextValue,
): string {
  if (plan.price_per_seat_cents === null) return localization.t("cloud.billing.custom");
  return formatCurrency(plan.price_per_seat_cents * seats, plan.currency, localization);
}

function formatCurrency(cents: number, currency: string, localization: LocalizationContextValue): string {
  return localization.formatNumber(cents / 100, {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  });
}

function formatBytes(value: number, localization: LocalizationContextValue): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = Math.max(0, value);
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }
  return `${localization.formatNumber(amount, { maximumFractionDigits: amount < 10 ? 1 : 0 })} ${units[unit]}`;
}

function ratioPercent(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 100);
}
