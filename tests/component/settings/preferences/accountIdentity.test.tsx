/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { AccountIdentity } from "../../../../src/features/settings/main/AccountIdentity";
import { AccountUsageMeters } from "../../../../src/features/settings/main/AccountUsageMeters";
import type { DesktopBillingUsage } from "../../../../src/lib/cloudApi";
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

const base = {
  email: "person@example.com",
  statusNote: null,
  busy: false,
  onSignOut: () => undefined,
};

it("states the identity once, without a status row restating it", async () => {
  const host = await render(<AccountIdentity {...base} />);
  expect(host.textContent).toContain("person@example.com");
  // The email already proves the session; a "Signed in" row beside it is pure
  // restatement and must not come back.
  expect(host.textContent).not.toMatch(/Signed in|Status|Authentication|Email/);
});

it("keeps signing out quiet rather than making it the loudest control", async () => {
  const host = await render(<AccountIdentity {...base} />);
  const signOut = [...host.querySelectorAll("button")]
    .find((button) => /Sign out/.test(button.textContent ?? ""));
  expect(signOut).toBeTruthy();
  // Destructive and rare: it must not borrow the primary or danger styling
  // that the page reserves for what it actually wants you to do.
  expect(signOut?.className).not.toMatch(/primary|danger/);
});

it("offers no sign-out to sign out of when signed out", async () => {
  const host = await render(<AccountIdentity {...base} email={null} />);
  expect([...host.querySelectorAll("button")].map((b) => b.textContent))
    .not.toContain("Sign out");
});

it("states the identity and nothing the page says again below it", async () => {
  const host = await render(<AccountIdentity {...base} />);
  // What the account holds is one fact with one source, and that source is the
  // row beside the machines it counts — not a second copy under the email.
  expect(host.textContent).not.toMatch(/View plans|workspace/i);
});

it("draws a meter only against an authoritative reading", async () => {
  const usage = {
    runtime: {
      org_id: "o1", available_units: 504, reserved_units: 0,
      granted_units: 720, consumed_units: 216,
      postpaid_available_units: 0, postpaid_consumed_units: 0, buckets: [],
    },
    storage: {
      logical_bytes: 6.2 * 1000 ** 3, limit_bytes: 20 * 1000 ** 3,
      percent: 31, threshold_percent: 80, version: 1,
    },
  } as DesktopBillingUsage;
  const host = await render(
    <AccountUsageMeters usage={usage} catalog={null} planId="free" />,
  );
  const bars = host.querySelectorAll('[role="progressbar"]');
  // Storage is the only quantity quoted back to the user, so exactly one bar.
  // `planPricing.ts` fixes the rule that runtime metering must never reach a
  // user surface, and a bar that drains while the product is used would teach
  // the reader to run fewer agents.
  expect(bars).toHaveLength(1);
  expect(bars[0].getAttribute("aria-valuenow")).toBe("31");
  expect(host.textContent).toContain("6.2");
  // 720 granted / 216 consumed units is 12 and 3.6 hours: neither may appear.
  expect(host.textContent).not.toContain("3.6");
  expect(host.textContent).not.toMatch(/\bhours?\b/i);
});

it("never fabricates a filled bar when usage is unknown", async () => {
  const host = await render(
    <AccountUsageMeters usage={null} catalog={null} planId="free" />,
  );
  // A filled bar is a claim about the user's money. With no reading there is
  // nothing to claim, so nothing is drawn.
  expect(host.querySelector('[role="progressbar"]')).toBeNull();
});
