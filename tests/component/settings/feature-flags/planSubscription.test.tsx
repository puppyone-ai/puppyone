/** @vitest-environment happy-dom */
import { readFileSync } from "node:fs";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import {
  isSettingsSectionAvailable,
  resolveSettingsSidebarGroups,
} from "../../../../src/features/settings/sidebar/settingsSidebarModel";
import {
  formatStorage,
  localPersonalOffer,
  resolvePersonalOffer,
  resolvePlanHolding,
} from "../../../../src/features/settings/main/planPricing";
import { PersonalPlan, PersonalPlanRows } from "../../../../src/features/settings/main/PersonalPlan";
import type { DesktopBillingSummary, DesktopBillingUsage } from "../../../../src/lib/cloudApi";
import { useLocalization } from "@puppyone/localization";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
afterEach(() => { act(() => root?.unmount()); root = null; document.body.replaceChildren(); });

async function render(node: React.ReactElement) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(withTestLocalization(node)));
  return host;
}

const GB = 1000 ** 3;

/** The plan before an account is readable: signed out, or signed in and loading. */
function Unconnected({ onSignIn = () => undefined, signedIn = false }: {
  onSignIn?: () => void;
  signedIn?: boolean;
}) {
  const localization = useLocalization();
  return (
    <PersonalPlan
      session={signedIn ? ({ user_id: "u1" } as never) : null}
      apiBaseUrl={null}
      organizationId={null}
      onSessionChange={() => undefined}
      offer={resolvePersonalOffer(null).offer}
      holding={resolvePlanHolding(null, null)}
      usage={null}
      loading={false}
      localization={localization}
      onSignIn={onSignIn}
    />
  );
}

const HELD = resolvePlanHolding(
  { plan_id: "personal", status: "active", seat_quantity: 1, org_id: "o1" } as DesktopBillingSummary,
  { plans: [{ id: "personal", price_per_seat_cents: 1900, currency: "USD" }] } as never,
);

const usageOf = (usedBytes: number, limitBytes: number | null = 10 * GB) => ({
  storage: { logical_bytes: usedBytes, limit_bytes: limitBytes },
}) as DesktopBillingUsage;

/** The rows alone, with no session or controller behind them. */
function Rows({ held = false, usage = null, action }: {
  held?: boolean;
  usage?: DesktopBillingUsage | null;
  action?: React.ReactNode;
}) {
  const localization = useLocalization();
  return (
    <PersonalPlanRows
      offer={localPersonalOffer()}
      holding={held ? HELD : resolvePlanHolding(null, null)}
      usage={usage}
      localization={localization}
      action={action}
    />
  );
}

/** Each row as [label, value], the way a reader scans a Settings page. */
const rowsOf = (host: HTMLElement) => [...host.querySelectorAll(".desktop-settings-row")]
  .map((row) => [
    row.querySelector(":scope > span")?.textContent,
    row.querySelector(".desktop-settings-value-text")?.textContent,
  ]);

/**
 * The product is priced per person: one plan, Personal, $19 a month, which
 * includes Storage and a Cloud Computer. These tests hold that shape: one
 * price, two included things, a storage bar once it is held, and no machine
 * spec, all in the same rows as the rest of Settings.
 */

it("keeps the price reachable without a local project, and only with Cloud on", () => {
  const context = { cloudEnabled: true, localWorkspaceAvailable: false };
  const ids = resolveSettingsSidebarGroups(context).flatMap((g) => g.items.map((i) => i.id));
  expect(ids).toContain("account");
  expect(ids).toContain("seats");
  // Hosting describes a project, so it needs one; the money never does.
  expect(ids).not.toContain("cloud");
  expect(isSettingsSectionAvailable("account", context)).toBe(true);
  // A local-first Desktop has no account and nothing to buy.
  const localFirst = { cloudEnabled: false, localWorkspaceAvailable: false };
  expect(isSettingsSectionAvailable("account", localFirst)).toBe(false);
  expect(isSettingsSectionAvailable("seats", localFirst)).toBe(false);
});

it("splits state from purchase, and puts every price on Plan", () => {
  const context = { cloudEnabled: true };
  const cloud = resolveSettingsSidebarGroups(context).find((group) => group.id === "cloud");
  expect(cloud?.items.map((item) => item.id)).toEqual(["account", "seats"]);
  expect(isSettingsSectionAvailable("seats", context)).toBe(true);
  // Invoices are documents, not a settings pane: Plan links out to them.
  expect(cloud?.items.map((item) => item.id)).not.toContain("billing");

  const account = readFileSync("src/features/settings/main/AccountSettingsView.tsx", "utf8");
  const plan = readFileSync("src/features/settings/main/SeatsSettingsView.tsx", "utf8");
  // No catalogue price may appear beside the state it would change.
  expect(account).not.toContain("PersonalPlan");
  expect(account).not.toContain("resolvePersonalOffer");
  expect(plan).toContain("<PersonalPlan");
  // Linking runs one way: the nav is on screen, so Plan needs no way back.
  expect(account).toContain("onOpenBilling");
  expect(plan).not.toContain("onOpenAccount");
});

it("sells Personal at $19 a month, with storage included", () => {
  const offer = localPersonalOffer();
  expect(offer.priceCents).toBe(1900);
  expect(offer.storageBytes).toBe(10 * GB);
  // No spec may survive on the model, or a surface can quote it by accident.
  for (const spec of ["vcpus", "memoryGb", "gpu", "units"]) {
    expect(offer).not.toHaveProperty(spec);
  }
});

it("reads Personal from the catalog as the cheapest plan that costs something", () => {
  const catalog = {
    plans: [
      {
        id: "free", public: true, purchasable: false, price_per_seat_cents: 0, currency: "USD",
        fixed_limits: { "storage.max_bytes": GB / 2 }, per_seat_limits: {},
      },
      {
        id: "personal", public: true, purchasable: true, price_per_seat_cents: 1900, currency: "USD",
        fixed_limits: {}, per_seat_limits: { "storage.max_bytes": 50 * GB },
      },
      {
        id: "business", public: true, purchasable: true, price_per_seat_cents: 4900, currency: "USD",
        fixed_limits: {}, per_seat_limits: {},
      },
    ],
  } as never;
  const { offer, authoritative } = resolvePersonalOffer(catalog);
  expect(authoritative).toBe(true);
  // Free costs nothing and is not an offer; anything dearer is not sold here.
  expect(offer.id).toBe("personal");
  expect(offer.priceCents).toBe(1900);
  // Storage comes from the plan the billing authority publishes.
  expect(offer.storageBytes).toBe(50 * GB);
  expect(offer.catalogPlan).toBeDefined();
});

it("knows when pricing is only indicative, and cannot buy from it", () => {
  expect(resolvePersonalOffer(null).authoritative).toBe(false);
  // The local offer carries no catalogPlan, so there is nothing to quote: an
  // amount we charge must never come from a number the client rendered.
  expect(localPersonalOffer().catalogPlan).toBeUndefined();
});

it("treats holding no plan as a complete, free answer", () => {
  const holding = resolvePlanHolding(null, null);
  expect(holding.subscribed).toBe(false);
  expect(holding.monthlyCents).toBe(0);
  expect(holding.status).toBeNull();

  // A checkout that never completed is not a plan anyone holds.
  const pending = { plan_id: "personal", status: "checkout_pending", seat_quantity: 1, org_id: "o1" };
  expect(resolvePlanHolding(pending as DesktopBillingSummary, null).subscribed).toBe(false);
});

it("bills one person at the plan price", () => {
  const summary = {
    plan_id: "personal", status: "active", seat_quantity: 1, org_id: "o1",
  } as DesktopBillingSummary;
  const catalog = {
    plans: [{ id: "personal", price_per_seat_cents: 1900, currency: "USD" }],
  } as never;
  const holding = resolvePlanHolding(summary, catalog);
  expect(holding.subscribed).toBe(true);
  expect(holding.monthlyCents).toBe(1900);
});

it("reads like Settings: one row for the plan, then what it includes", async () => {
  const host = await render(<Rows />);
  expect(rowsOf(host)).toEqual([
    ["Personal", "$19 / month"],
    ["Storage", "10 GB"],
    ["Cloud Computer", "1"],
  ]);
  expect(host.querySelector(".desktop-settings-subsection-title")?.textContent).toBe("Includes");
  // No card, no badge and no type of its own: the page uses the shared rows.
  expect(host.querySelector("article, [class*='desktop-personal-plan']")).toBeNull();
  // One price, said once.
  expect([...host.textContent!.matchAll(/\$19/g)]).toHaveLength(1);
});

it("explains nothing in sentences: the rows are the explanation", async () => {
  const host = await render(<Rows />);
  expect(host.querySelectorAll("p")).toHaveLength(0);
  expect(host.textContent).not.toMatch(/free|keeps|working|indicative|person\b/i);
});

it("never quotes the machine behind the Cloud Computer", async () => {
  const host = await render(<Rows held usage={usageOf(2.1 * GB)} />);
  // Hardware is what the machine is made of, not what it is worth to anyone.
  expect(host.textContent).not.toMatch(/vCPU|GPU|RAM|\bcores?\b|Standard|Large/);
  // Product vocabulary: the cloud computer is never a VM or an instance.
  expect(host.textContent).not.toMatch(/\bVM\b|virtual machine|instance/i);
});

it("draws how much storage is used once the plan is held", async () => {
  const host = await render(<Rows held usage={usageOf(2.1 * GB)} />);
  const meter = host.querySelector(".desktop-plan-meter-row");
  expect(meter?.querySelector(":scope > span")?.textContent).toBe("Storage");
  expect(meter?.querySelector(".desktop-settings-value-text")?.textContent).toBe("2.1 GB of 10 GB");
  const bar = host.querySelector("[role=progressbar]");
  expect(bar?.getAttribute("aria-valuenow")).toBe("21");
  expect(bar?.classList.contains("exhausted")).toBe(false);
});

it("warns as storage runs out, and never overdraws the bar", async () => {
  const host = await render(<Rows held usage={usageOf(12 * GB)} />);
  const bar = host.querySelector("[role=progressbar]");
  expect(bar?.getAttribute("aria-valuenow")).toBe("100");
  expect(bar?.classList.contains("exhausted")).toBe(true);
});

it("states the allowance, not a bar, before the plan is held", async () => {
  // Someone who has not subscribed has used none of Personal's storage, so a
  // bar would be a claim about a plan they do not hold.
  const host = await render(<Rows usage={usageOf(2.1 * GB)} />);
  expect(host.querySelectorAll("[role=progressbar]")).toHaveLength(0);
  expect(rowsOf(host)[1]).toEqual(["Storage", "10 GB"]);
});

it("meters storage and nothing that moves while agents work", async () => {
  const host = await render(<Rows held usage={usageOf(2.1 * GB)} />);
  // Stored bytes move when the user saves. A runtime meter would drain as
  // agents work and teach the reader to run fewer of them.
  expect(host.querySelectorAll("[role=progressbar]")).toHaveLength(1);
  expect(host.textContent).not.toMatch(/\bhours?\b|\bunits?\b|credits?/i);
});

it("never reads a few saved files as zero gigabytes", async () => {
  const host = await render(<Rows held usage={usageOf(120 * 1000 ** 2)} />);
  expect(host.querySelector(".desktop-plan-meter-row .desktop-settings-value-text")?.textContent)
    .toBe("120 MB of 10 GB");
  const L = { t: (id: string, v?: Record<string, string>) => `${v?.amount} ${id.endsWith("Mb") ? "MB" : "GB"}`,
    formatNumber: (n: number) => String(n) } as never;
  expect(formatStorage(0, L)).toBe("0 MB");
  expect(formatStorage(10 * GB, L)).toBe("10 GB");
});

it("routes a signed-out reader to sign-in rather than a dead buy button", async () => {
  const signIn = vi.fn();
  const host = await render(<Unconnected onSignIn={signIn} />);
  const buttons = [...host.querySelectorAll<HTMLButtonElement>("button")];
  // One plan leaves nothing to pick between, so there is one action and no picker.
  expect(buttons).toHaveLength(1);
  expect(host.querySelectorAll('[role="radio"]')).toHaveLength(0);
  expect(buttons[0]?.textContent).toBe("Sign in to subscribe");
  await act(async () => buttons[0]?.click());
  expect(signIn).toHaveBeenCalledOnce();
});

it("does not offer sign-in to a reader who is already signed in", async () => {
  // While the account is still loading the organization is unknown. The
  // button waits rather than asking for a sign-in that has already happened.
  const signIn = vi.fn();
  const host = await render(<Unconnected signedIn onSignIn={signIn} />);
  const button = host.querySelector<HTMLButtonElement>("button")!;
  expect(button.textContent).toBe("Subscribe");
  expect(button.disabled).toBe(true);
});

it("carries no way back, because the nav it came from is still on screen", async () => {
  const host = await render(<Unconnected />);
  expect(host.querySelector(".desktop-settings-back")).toBeNull();
});

it("prices nothing while the payments experiment is off", () => {
  // Both money surfaces are render entries and both fork on the same read:
  // `src/features/payments/README.md`.
  for (const file of ["AccountSettingsView", "SeatsSettingsView"]) {
    const source = readFileSync(`src/features/settings/main/${file}.tsx`, "utf8");
    expect(source).toContain("usePaymentsExperience();");
    expect(source).toMatch(/if \(!payments\) return null;|\{payments && /);
  }
  // Nothing below them may render a price by reading the experiment itself.
  const purchase = readFileSync("src/features/settings/main/PersonalPlan.tsx", "utf8");
  expect(purchase).not.toContain("usePaymentsExperience");
});
