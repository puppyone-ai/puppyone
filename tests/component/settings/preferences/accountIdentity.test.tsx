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

it("draws meters only against an authoritative reading", async () => {
  const usage = {
    runtime: {
      org_id: "o1", available_units: 84, reserved_units: 0,
      granted_units: 300, consumed_units: 216,
      postpaid_available_units: 0, postpaid_consumed_units: 0, buckets: [],
      allowance: {
        granted_units: 300, consumed_units: 216, reserved_units: 0,
        resets_at: "2026-12-01T00:00:00Z", unit_seconds: 60,
      },
    },
    storage: {
      logical_bytes: 0.31 * 1000 ** 3, limit_bytes: 1000 ** 3,
      percent: 31, threshold_percent: 0, version: 1,
    },
  } as DesktopBillingUsage;
  const host = await render(
    <AccountUsageMeters usage={usage} catalog={null} summary={null} />,
  );
  const bars = [...host.querySelectorAll('[role="progressbar"]')];
  // Both are the plan's own promise: agent hours and storage. Hours are agent
  // time only, so the bar never drains while a person works.
  expect(bars.map((bar) => bar.getAttribute("aria-valuenow"))).toEqual(["72", "31"]);
  expect(host.textContent).toContain("3.6 of 5 h");
  // Runtime units are internal and never reach the page.
  expect(host.textContent).not.toMatch(/\bunits?\b|216|300/);
});

it("never fabricates a filled bar when usage is unknown", async () => {
  const host = await render(
    <AccountUsageMeters usage={null} catalog={null} summary={null} />,
  );
  // A filled bar is a claim about the user's money. With no reading there is
  // nothing to claim, so nothing is drawn.
  expect(host.querySelector('[role="progressbar"]')).toBeNull();
});
