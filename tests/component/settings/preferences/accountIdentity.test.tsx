/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { AccountIdentity } from "../../../../src/features/settings/main/AccountIdentity";
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

