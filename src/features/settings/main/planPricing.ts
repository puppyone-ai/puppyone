import type { LocalizationContextValue } from "@puppyone/localization";
import type {
  DesktopBillingAddOn,
  DesktopBillingCatalog,
  DesktopBillingPlan,
  DesktopBillingSummary,
  DesktopBillingUsage,
} from "../../../lib/cloudApi";

/**
 * Cloud pricing, as decided on 2026-11-08 (puppy-issues
 * `document/puppypay/product.md`, "云端套餐").
 *
 * Three plans, priced per person: Free, Personal ($20 a month) and Team ($40
 * per person a month). Each plan includes the same three things, and the page
 * names exactly those: cloud projects, storage and cloud agent hours. Team adds
 * what a group needs to work together and keep its agents in check.
 *
 * The headline is the price and what it is for; hours and storage are the
 * allowance printed under it, never a unit price. A plan sold by the hour or by
 * the gigabyte invites comparison with raw compute and storage, and loses.
 *
 * Rules this file keeps:
 *
 *  - **Hours are agent time only.** A person opening or editing files in the
 *    cloud never spends them, and the page says so beside the hours.
 *  - **No machine specs, no runtime units.** RU and vCPU are internal; hours
 *    are the only time unit a person sees.
 *  - **No price per GB.** Storage ships inside the plan and grows in packs, so
 *    the cloud copy never reads as a drive to fill (`product-philosophy.md`).
 *  - **Amounts charged come from the catalog.** The local offers below are
 *    indicative and only shown until the billing service answers.
 */

const BYTES_PER_MB = 1000 ** 2;
const BYTES_PER_GB = 1000 ** 3;
const LOCAL_CURRENCY = "USD";
const SECONDS_PER_HOUR = 3600;
const DEFAULT_UNIT_SECONDS = 60;

export const PLAN_ORDER = ["free", "personal", "team"] as const;
export type PlanId = (typeof PLAN_ORDER)[number];

/** What a team gets that one person does not need. Keys match catalog features. */
export const TEAM_FEATURES = [
  "team.member_roles",
  "agent.access_rules",
  "activity.log",
  "billing.consolidated",
] as const;

export type PlanOffer = {
  id: PlanId;
  /** Per month; per person when `perPerson`. */
  priceCents: number;
  currency: string;
  perPerson: boolean;
  /** Fewest people the plan can be bought for. */
  minimumSeats: number;
  /** Cloud projects included; per person when `perPerson`. `null` means no cap. */
  projects: number | null;
  /** Storage included, in bytes; per person when `perPerson`. */
  storageBytes: number | null;
  /** Cloud agent hours a month; per person when `perPerson`. */
  agentHours: number;
  /** History kept, in days. */
  historyDays: number | null;
  teamFeatures: boolean;
  purchasable: boolean;
  /**
   * The authoritative plan. Absent for indicative pricing, and a purchase can
   * never start without it.
   */
  catalogPlan?: DesktopBillingPlan;
};

export type AddOnOffer = {
  id: string;
  kind: "hours" | "storage";
  priceCents: number;
  currency: string;
  /** Agent hours each pack adds a month. */
  hours: number;
  /** Bytes each pack adds. */
  storageBytes: number;
  maxQuantity: number;
  availableOn: readonly string[];
  catalogAddOn?: DesktopBillingAddOn;
};

const LOCAL_PLANS: Record<PlanId, PlanOffer> = {
  free: {
    id: "free", priceCents: 0, currency: LOCAL_CURRENCY, perPerson: false, minimumSeats: 1,
    projects: 1, storageBytes: 1 * BYTES_PER_GB, agentHours: 5, historyDays: 30,
    teamFeatures: false, purchasable: false,
  },
  personal: {
    id: "personal", priceCents: 2000, currency: LOCAL_CURRENCY, perPerson: false, minimumSeats: 1,
    projects: 20, storageBytes: 10 * BYTES_PER_GB, agentHours: 40, historyDays: 30,
    teamFeatures: false, purchasable: true,
  },
  team: {
    id: "team", priceCents: 4000, currency: LOCAL_CURRENCY, perPerson: true, minimumSeats: 2,
    projects: 20, storageBytes: 20 * BYTES_PER_GB, agentHours: 40, historyDays: 365,
    teamFeatures: true, purchasable: true,
  },
};

const LOCAL_ADD_ONS: AddOnOffer[] = [
  {
    id: "agent_hours_100", kind: "hours", priceCents: 500, currency: LOCAL_CURRENCY,
    hours: 100, storageBytes: 0, maxQuantity: 20, availableOn: ["personal", "team"],
  },
  {
    id: "storage_10gb", kind: "storage", priceCents: 500, currency: LOCAL_CURRENCY,
    hours: 0, storageBytes: 10 * BYTES_PER_GB, maxQuantity: 50, availableOn: ["personal", "team"],
  },
];

export type PlanCatalogView = {
  plans: PlanOffer[];
  addOns: AddOnOffer[];
  /** False while the prices shown are indicative. */
  authoritative: boolean;
};

/**
 * The three plans and the add-ons, from the catalog when it is readable.
 *
 * A catalog that does not carry all three plans (an older billing service) is
 * not this pricing, so the page keeps the indicative offers instead of mixing
 * two price lists.
 */
export function resolvePlanCatalog(catalog: DesktopBillingCatalog | null): PlanCatalogView {
  if (!catalog) return { plans: PLAN_ORDER.map((id) => LOCAL_PLANS[id]), addOns: LOCAL_ADD_ONS, authoritative: false };
  const unitSeconds = catalog.runtime.unit_seconds || DEFAULT_UNIT_SECONDS;
  const plans = PLAN_ORDER.map((id) => {
    const plan = catalog.plans.find((candidate) => candidate.id === id || candidate.aliases.includes(id));
    return plan ? planFromCatalog(id, plan, unitSeconds) : null;
  });
  if (plans.some((plan) => plan === null)) {
    return { plans: PLAN_ORDER.map((id) => LOCAL_PLANS[id]), addOns: LOCAL_ADD_ONS, authoritative: false };
  }
  return {
    plans: plans as PlanOffer[],
    addOns: (catalog.add_ons ?? []).map((addOn) => addOnFromCatalog(addOn, unitSeconds)),
    authoritative: true,
  };
}

function planFromCatalog(id: PlanId, plan: DesktopBillingPlan, unitSeconds: number): PlanOffer {
  const perPerson = plan.seats.minimum > 1 || plan.runtime.units_per_seat > 0;
  const units = perPerson ? plan.runtime.units_per_seat : plan.runtime.fixed_units;
  return {
    id,
    priceCents: plan.price_per_seat_cents ?? 0,
    currency: plan.currency,
    perPerson,
    minimumSeats: Math.max(1, plan.seats.minimum),
    projects: limitOf(plan, "projects.max"),
    storageBytes: limitOf(plan, "storage.max_bytes"),
    agentHours: unitsToHours(units, unitSeconds),
    historyDays: limitOf(plan, "history.retention_days"),
    teamFeatures: TEAM_FEATURES.some((feature) => plan.features[feature] === true),
    purchasable: plan.purchasable,
    catalogPlan: plan,
  };
}

function addOnFromCatalog(addOn: DesktopBillingAddOn, unitSeconds: number): AddOnOffer {
  const storageBytes = addOn.limit_increments["storage.max_bytes"] ?? 0;
  return {
    id: addOn.id,
    kind: addOn.runtime_units > 0 ? "hours" : "storage",
    priceCents: addOn.price_cents,
    currency: addOn.currency,
    hours: unitsToHours(addOn.runtime_units, unitSeconds),
    storageBytes,
    maxQuantity: addOn.max_quantity,
    availableOn: addOn.available_on_plans,
    catalogAddOn: addOn,
  };
}

/** A per-person limit for one person, or a fixed limit as it stands. */
function limitOf(plan: DesktopBillingPlan, key: string): number | null {
  const perSeat = plan.per_seat_limits[key];
  if (typeof perSeat === "number") return perSeat;
  const fixed = plan.fixed_limits[key];
  return typeof fixed === "number" ? fixed : null;
}

export function unitsToHours(units: number, unitSeconds: number = DEFAULT_UNIT_SECONDS): number {
  return Math.round(((units * unitSeconds) / SECONDS_PER_HOUR) * 10) / 10;
}

/**
 * Statuses that mean no paid plan is held right now. Every other status is a
 * plan held, including one scheduled to cancel or one whose payment is late.
 */
const NOT_HELD: ReadonlySet<DesktopBillingSummary["status"]> = new Set([
  "free",
  "checkout_pending",
  "revoked",
]);

export type PlanHolding = {
  /** Whether a paid plan is held right now. */
  subscribed: boolean;
  /** The plan in effect: "free" when nothing paid is held. */
  planId: PlanId | string;
  seats: number;
  /** Monthly total in cents for the plan, or `null` while unknown. */
  monthlyCents: number | null;
  currency: string;
  status: DesktopBillingSummary["status"] | null;
  renewsAt: string | null;
  cancelAtPeriodEnd: boolean;
  /** Add-on quantities held, by id. */
  addOns: Record<string, number>;
  /** A downgrade or seat decrease that waits for renewal. */
  scheduled: ScheduledPlanChange | null;
};

export type ScheduledPlanChange = {
  planId: PlanId | string;
  seats: number;
  effectiveAt: string;
};

/**
 * What this account holds. Holding nothing is Free, and Free is a complete
 * answer: everything on this computer stays free for good.
 */
export function resolvePlanHolding(
  summary: DesktopBillingSummary | null,
  catalog: DesktopBillingCatalog | null,
): PlanHolding {
  if (!summary || NOT_HELD.has(summary.status)) {
    return {
      subscribed: false,
      planId: "free",
      seats: 1,
      monthlyCents: 0,
      currency: LOCAL_CURRENCY,
      status: summary?.status ?? null,
      renewsAt: null,
      cancelAtPeriodEnd: false,
      addOns: {},
      scheduled: null,
    };
  }
  const plan = catalog?.plans.find((candidate) => candidate.id === summary.plan_id
    || candidate.aliases.includes(summary.plan_id)) ?? null;
  const seats = Math.max(1, summary.seat_quantity);
  const unit = plan?.price_per_seat_cents ?? null;
  const addOns: Record<string, number> = {};
  for (const item of summary.add_ons ?? []) {
    if (!item.cancel_at_period_end) addOns[item.add_on_id] = (addOns[item.add_on_id] ?? 0) + item.quantity;
  }
  return {
    subscribed: true,
    planId: canonicalPlanId(plan?.id ?? summary.plan_id),
    seats,
    monthlyCents: unit === null ? null : unit * seats,
    currency: plan?.currency ?? LOCAL_CURRENCY,
    status: summary.status,
    renewsAt: summary.current_period_end,
    cancelAtPeriodEnd: summary.cancel_at_period_end,
    addOns,
    scheduled: summary.pending_effective_at
      ? {
        planId: canonicalPlanId(summary.pending_plan_id ?? plan?.id ?? summary.plan_id),
        seats: summary.pending_seat_quantity ?? seats,
        effectiveAt: summary.pending_effective_at,
      }
      : null,
  };
}

function canonicalPlanId(planId: string): PlanId | string {
  if (planId === "plus") return "personal";
  if (planId === "business" || planId === "pro") return "team";
  return planId;
}

export type AllowanceReading = {
  /** Agent hours used this period, or `null` without an authoritative reading. */
  usedHours: number | null;
  includedHours: number;
  resetsAt: string | null;
  usedBytes: number | null;
  includedBytes: number | null;
};

/**
 * This period's agent hours and storage against what the plan includes.
 *
 * A meter is only drawn against an authoritative reading; without one the
 * page states what the plan includes and never a fabricated consumption.
 */
export function resolveAllowance(
  usage: DesktopBillingUsage | null,
  offer: PlanOffer,
  holding: PlanHolding,
  addOns: readonly AddOnOffer[],
): AllowanceReading {
  const extraHours = addOns.reduce((sum, addOn) => sum + addOn.hours * (holding.addOns[addOn.id] ?? 0), 0);
  const extraBytes = addOns.reduce(
    (sum, addOn) => sum + addOn.storageBytes * (holding.addOns[addOn.id] ?? 0),
    0,
  );
  const seats = offer.perPerson ? holding.seats : 1;
  const planHours = offer.agentHours * seats + extraHours;
  const planBytes = offer.storageBytes === null ? null : offer.storageBytes * seats + extraBytes;
  const allowance = usage?.runtime.allowance ?? null;
  return {
    usedHours: allowance ? unitsToHours(allowance.consumed_units, allowance.unit_seconds) : null,
    includedHours: allowance && allowance.granted_units > 0
      ? unitsToHours(allowance.granted_units, allowance.unit_seconds)
      : planHours,
    resetsAt: allowance?.resets_at ?? holding.renewsAt,
    usedBytes: usage ? usage.storage.logical_bytes : null,
    includedBytes: usage?.storage.limit_bytes ?? planBytes,
  };
}

export function formatMoney(
  cents: number | null,
  currency: string,
  localization: LocalizationContextValue,
): string {
  if (cents === null) return localization.t("settings.plan.custom");
  if (cents === 0) return localization.t("settings.plan.freePrice");
  return localization.formatNumber(cents / 100, {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  });
}

/** A price as currency, $0 included: a plan card compares numbers, not words. */
export function formatCurrency(
  cents: number,
  currency: string,
  localization: LocalizationContextValue,
): string {
  return localization.formatNumber(cents / 100, {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  });
}

export function formatGigabytes(bytes: number, localization: LocalizationContextValue): string {
  return localization.formatNumber(Math.round((bytes / BYTES_PER_GB) * 10) / 10);
}

/**
 * A storage amount with its unit: MB below one gigabyte, so a few saved files
 * never read as "0 GB", and GB with at most one decimal from there.
 */
export function formatStorage(bytes: number, localization: LocalizationContextValue): string {
  const safe = Math.max(0, bytes);
  if (safe < BYTES_PER_GB) {
    return localization.t("settings.plan.amountMb", {
      amount: localization.formatNumber(Math.round(safe / BYTES_PER_MB)),
    });
  }
  return localization.t("settings.plan.amountGb", { amount: formatGigabytes(safe, localization) });
}

export function formatHours(hours: number, localization: LocalizationContextValue): string {
  return localization.formatNumber(hours, { maximumFractionDigits: hours < 10 ? 1 : 0 });
}

/** "3.2 GB of 10 GB", or what the plan includes while usage is unknown. */
export function describeStorageReading(
  reading: AllowanceReading,
  localization: LocalizationContextValue,
): string {
  const { usedBytes, includedBytes } = reading;
  if (includedBytes === null) return usedBytes === null ? "—" : formatStorage(usedBytes, localization);
  if (usedBytes === null) return formatStorage(includedBytes, localization);
  return localization.t("settings.plan.storageUsedOf", {
    used: formatStorage(usedBytes, localization),
    total: formatStorage(includedBytes, localization),
  });
}

/** "12 of 40 h", or the hours included while usage is unknown. */
export function describeHoursReading(
  reading: AllowanceReading,
  localization: LocalizationContextValue,
): string {
  if (reading.usedHours === null) {
    return localization.t("settings.plan.hoursIncluded", {
      hours: formatHours(reading.includedHours, localization),
    });
  }
  return localization.t("settings.plan.hoursUsedOf", {
    used: formatHours(reading.usedHours, localization),
    total: formatHours(reading.includedHours, localization),
  });
}

/** The localized name of the plan held. */
export function heldPlanName(holding: PlanHolding, localization: LocalizationContextValue): string {
  if (!holding.subscribed) return localization.t("settings.plan.name.free");
  return localization.t(holding.planId === "team" ? "settings.plan.name.team" : "settings.plan.name.personal");
}

/** Bar tone: calm, then a warning from 80%, then exhausted from 90%. */
export function meterTone(percent: number): "" | " warning" | " exhausted" {
  if (percent >= 90) return " exhausted";
  if (percent >= 80) return " warning";
  return "";
}
