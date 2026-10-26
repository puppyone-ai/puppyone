/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DesktopCloudSignInCta } from "../../../../src/features/cloud/auth/DesktopCloudSignInCta";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});

const render = (props: { signingIn: boolean; error?: string | null; onSignIn: () => void }) => act(() => root.render(
  withTestLocalization(<DesktopCloudSignInCta signingIn={props.signingIn} error={props.error ?? null} onSignIn={props.onSignIn} />),
));

describe("Desktop Cloud sign-in handoff", () => {
  it("lets a user who closed the browser page open it again while waiting", () => {
    const onSignIn = vi.fn();
    render({ signingIn: true, onSignIn });
    expect(host.querySelector<HTMLButtonElement>("[data-cloud-sign-in-action]")?.disabled).toBe(true);
    const reopen = host.querySelector<HTMLButtonElement>(".desktop-cloud-sign-in-reopen-action");
    expect(host.querySelector(".desktop-cloud-sign-in-reopen")?.textContent).toContain("Closed the browser page?");
    expect(reopen?.textContent).toBe("Open it again");
    act(() => reopen?.click());
    expect(onSignIn).toHaveBeenCalledTimes(1);
  });

  it("offers no reopen link before sign-in starts or when it failed", () => {
    render({ signingIn: false, onSignIn: vi.fn() });
    expect(host.querySelector(".desktop-cloud-sign-in-reopen")).toBeNull();
    render({ signingIn: true, error: "Browser unavailable", onSignIn: vi.fn() });
    expect(host.querySelector(".desktop-cloud-sign-in-reopen")).toBeNull();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Browser unavailable");
  });
});
