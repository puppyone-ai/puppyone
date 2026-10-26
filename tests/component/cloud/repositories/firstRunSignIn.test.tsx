/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFirstRunSignIn } from "../../../../src/features/cloud/auth/useFirstRunSignIn";
import { FirstRunSignInScreen } from "../../../../src/features/cloud/auth/FirstRunSignInScreen";
import { withTestLocalization } from "../../../support/react/localization";
import { createTestSurfaceAppearance } from "../../../support/react/surfaceAppearance";

const auth = vi.hoisted(() => ({ signingIn: false, error: null as string | null, startSignIn: vi.fn() }));
vi.mock("../../../../src/features/cloud/hooks/useCloudAuthController", () => ({
  useCloudAuthController: () => auth,
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let entry: ReturnType<typeof useFirstRunSignIn>;
function Harness(props: Parameters<typeof useFirstRunSignIn>[0]) {
  entry = useFirstRunSignIn(props);
  return entry.required ? <FirstRunSignInScreen appearance={createTestSurfaceAppearance()}
    apiBaseUrl="https://cloud-fixture.puppyone.ai/api/v1" onContinueLocally={entry.complete} /> : null;
}
const fresh = { available: true, restoring: false, signedIn: false, hasProjects: false };
async function render(props = fresh) {
  await act(async () => root.render(withTestLocalization(<Harness {...props} />)));
}
async function remount(props = fresh) {
  await act(async () => root.unmount());
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await render(props);
}
beforeEach(() => {
  localStorage.clear();
  auth.signingIn = false;
  auth.error = null;
  auth.startSignIn.mockClear();
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
  localStorage.clear();
});

describe("first-run sign-in", () => {
  it("waits for restoration, then offers sign-in on the fresh empty launch without opening a browser automatically", async () => {
    await render({ ...fresh, restoring: true });
    expect(entry.pending).toBe(true);
    expect(entry.required).toBe(false);
    expect(document.querySelector(".first-run-sign-in")).toBeNull();
    await render();
    expect(entry.pending).toBe(false);
    expect(document.querySelector(".first-run-sign-in")).not.toBeNull();
    expect(auth.startSignIn).not.toHaveBeenCalled();
    await act(async () => document.querySelector<HTMLButtonElement>(".first-run-sign-in-submit")!.click());
    expect(auth.startSignIn).toHaveBeenCalledOnce();
  });

  it("remembers a successful login across a later signed-out restart", async () => {
    await render();
    await render({ ...fresh, signedIn: true });
    expect(entry.required).toBe(false);
    await remount();
    expect(entry.required).toBe(false);
  });

  it("lets a user continue locally and remembers that explicit choice", async () => {
    await render();
    await act(async () => document.querySelector<HTMLButtonElement>(".first-run-sign-in-skip")!.click());
    expect(entry.required).toBe(false);
    expect(auth.startSignIn).not.toHaveBeenCalled();
    await remount();
    expect(entry.required).toBe(false);
  });

  it("preserves an existing project user's startup even if the history is later cleared", async () => {
    await render({ ...fresh, hasProjects: true });
    expect(entry.required).toBe(false);
    await remount();
    expect(entry.required).toBe(false);
  });

  it("does not gate a build without account availability", async () => {
    await render({ ...fresh, available: false });
    expect(entry.required).toBe(false);
  });

  it("shows browser handoff progress and allows local continuation after a login error", async () => {
    await render();
    auth.signingIn = true;
    await render();
    expect(document.querySelector<HTMLButtonElement>(".first-run-sign-in-submit")?.disabled).toBe(true);
    expect(document.body.textContent).toContain("Waiting for sign-in");
    auth.signingIn = false;
    auth.error = "Browser unavailable";
    await render();
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("Browser unavailable");
    expect(entry.required).toBe(true);
    await act(async () => document.querySelector<HTMLButtonElement>(".first-run-sign-in-skip")!.click());
    expect(entry.required).toBe(false);
  });
});
