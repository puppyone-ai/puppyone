import type { LocalizationContextValue } from "@puppyone/localization";
import type {
  DesktopBillingCatalog,
  DesktopBillingPlan,
  DesktopBillingSummary,
} from "../../../lib/cloudApi";

/**
 * Cloud pricing.
 *
 * The product sells one thing: **Personal — one person, $19 a month**. It
 * includes exactly two things, and the page names exactly those two:
 *
 *  - **Storage**, a fixed allowance stated in GB.
 *  - **A Cloud Computer**, one computer of ours that keeps the person's agents
 *    working while their own computer is off.
 *
 * Agents on the user's own computer are free and stay free, so holding no plan
 * is a complete answer and never an error state.
 *
 * This replaces the per-agent model (one cloud agent running at a time, $10 a
 * month each). Charging per person is the first step; extra storage and more
 * Cloud Computers can be sold as add-ons later without changing this shape.
 *
 * Still deliberately absent, since each one is tempting to show:
 *
 *  - **vCPU, memory, GPU, machine size.** Never quoted. The machine behind a
 *    Cloud Computer is ours to choose and ours to change, and a spec sheet
 *    freezes an implementation detail into a promise.
 *  - **Runtime units or hours.** RU is internal metering vocabulary and must
 *    never reach a user surface. A bill the user cannot predict is worse than
 *    a bill that is slightly too high.
 *  - **Storage priced per GB.** `document/product-philosophy.md` forbids the
 *    words 云盘 / 网盘 / Backup for the cloud copy, and a price per GB teaches
 *    the user it is a drive. Storage ships inside the plan instead.
 */

const BYTES_PER_MB = 1000 ** 2;
const BYTES_PER_GB = 1000 ** 3;
const LOCAL_CURRENCY = "USD";

/**
 * Personal, per month, in cents.
 *
 * Indicative until the billing service can answer. The amount actually charged
 * always comes from the billing catalog, so the catalog must carry the same
 * number for the page and the checkout to agree.
 */
const LOCAL_PERSONAL_PRICE_CENTS = 1900;

/** Storage included with Personal, used only while the catalog is unreadable. */
const LOCAL_PERSONAL_STORAGE_BYTES = 10 * BYTES_PER_GB;

/** The id Personal is shown under while no catalog plan is readable. */
const LOCAL_PERSONAL_ID = "personal";

/**
 * Statuses that mean the person is not holding a paid plan right now. Every
 * other status is a plan they hold, including one already scheduled to
 * cancel or one whose payment is late.
 */
const NOT_HELD: ReadonlySet<DesktopBillingSummary["status"]> = new Set([
  "free",
  "checkout_pending",
  "revoked",
]);

export type PersonalPlanOffer = {
  id: string;
  /** What Personal costs per month. `null` means talk to us. */
  priceCents: number | null;
  currency: string;
  /** Storage included, in bytes. `null` when the plan does not say. */
  storageBytes: number | null;
  purchasable: boolean;
  /**
   * The authoritative plan Personal maps to. Absent for indicative pricing,
   * and a purchase cannot start without it: an amount we charge must come
   * from the billing authority, never from a number the client rendered.
   */
  catalogPlan?: DesktopBillingPlan;
};

/** Indicative offer, shown until the billing service can answer. */
export function localPersonalOffer(): PersonalPlanOffer {
  return {
    id: LOCAL_PERSONAL_ID,
    priceCents: LOCAL_PERSONAL_PRICE_CENTS,
    currency: LOCAL_CURRENCY,
    storageBytes: LOCAL_PERSONAL_STORAGE_BYTES,
    purchasable: true,
  };
}

/**
 * The authoritative offer, once a session can read the billing catalog.
 *
 * One plan is sold, so one plan is read: the cheapest public plan that costs
 * something. The free plan costs nothing and is not an offer, and anything
 * dearer is a plan this surface does not sell.
 */
export function catalogPersonalOffer(catalog: DesktopBillingCatalog): PersonalPlanOffer | null {
  const plan = catalog.plans
    .filter((candidate) => candidate.public
      && candidate.price_per_seat_cents !== null
      && candidate.price_per_seat_cents > 0)
    .sort((a, b) => (a.price_per_seat_cents ?? 0) - (b.price_per_seat_cents ?? 0))[0];
  if (!plan) return null;
  return {
    id: plan.id,
    priceCents: plan.price_per_seat_cents,
    currency: plan.currency,
    storageBytes: planStorageBytes(plan),
    purchasable: plan.purchasable,
    catalogPlan: plan,
  };
}

export function resolvePersonalOffer(
  catalog: DesktopBillingCatalog | null,
): { offer: PersonalPlanOffer; authoritative: boolean } {
  const authoritative = catalog ? catalogPersonalOffer(catalog) : null;
  if (authoritative) return { offer: authoritative, authoritative: true };
  return { offer: localPersonalOffer(), authoritative: false };
}

export type PlanHolding = {
  /** Whether the person holds Personal right now. */
  subscribed: boolean;
  planId: string | null;
  /** Monthly total in cents, or `null` while nothing authoritative is known. */
  monthlyCents: number | null;
  currency: string;
  status: DesktopBillingSummary["status"] | null;
};

/**
 * What this account currently holds.
 *
 * Holding nothing is the free state, and it is a complete answer: local agents
 * stay free forever, so a person can stay there permanently. The philosophy is
 * explicit that the local-only stage is a correct end state, not a funnel step.
 */
export function resolvePlanHolding(
  summary: DesktopBillingSummary | null,
  catalog: DesktopBillingCatalog | null,
): PlanHolding {
  if (!summary || NOT_HELD.has(summary.status)) {
    return {
      subscribed: false,
      planId: null,
      monthlyCents: 0,
      currency: LOCAL_CURRENCY,
      status: summary?.status ?? null,
    };
  }
  const plan = catalog?.plans.find((candidate) => candidate.id === summary.plan_id) ?? null;
  const unit = plan?.price_per_seat_cents ?? null;
  const seats = Math.max(1, summary.seat_quantity);
  return {
    subscribed: true,
    planId: summary.plan_id,
    monthlyCents: unit === null ? null : unit * seats,
    currency: plan?.currency ?? LOCAL_CURRENCY,
    status: summary.status,
  };
}

/** Storage a plan grants one person, in bytes, or `null` if it does not say. */
export function planStorageBytes(plan: DesktopBillingPlan): number | null {
  const storage = plan.per_seat_limits["storage.max_bytes"]
    ?? plan.fixed_limits["storage.max_bytes"];
  return typeof storage === "number" ? storage : null;
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
