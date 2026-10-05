/** @vitest-environment happy-dom */
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudWorkspaceSwitchDialog } from "../../../../src/features/cloud/workbench/CloudWorkspaceSwitchDialog";
import { useCloudWorkspaceSwitch } from "../../../../src/features/cloud/workbench/useCloudWorkspaceSwitch";
import { CloudSignedOutRoute } from "../../../../src/features/cloud/auth/CloudSignedOutRoute";
import { withTestLocalization } from "../../../support/react/localization";

const auth = vi.hoisted(() => ({ native: true, start: vi.fn().mockResolvedValue(undefined), browser: vi.fn() }));
vi.mock("../../../../src/lib/cloudSession", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../../src/lib/cloudSession")>(),
  getCachedDesktopCloudAuthState: () => null,
  onDesktopCloudAuthError: () => () => undefined,
  onDesktopCloudAuthStateChanged: () => () => undefined,
  supportsDesktopCloudOAuth: () => auth.native,
  startDesktopCloudOAuth: auth.start,
}));
vi.mock("../../../../src/lib/cloudApi", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../../src/lib/cloudApi")>(), openCloudApp: auth.browser,
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const API = "https://cloud-fixture.puppyone.ai/api/v1";
let root: Root | null = null;
function Harness({ restoring = false }: { restoring?: boolean }) {
  const [cloudActive, setCloudActive] = useState(false);
  const controller = useCloudWorkspaceSwitch({ enabled: true, scope: "current-repository", session: null,
    service: null, providerError: null, initializationPending: false, onCommit: () => setCloudActive(true) });
  return <>
    <button onClick={controller.request}>Cloud</button>
    <input aria-label="Local unsaved draft" defaultValue="Keep this draft" />
    <div data-current-provider={cloudActive ? "cloud" : "local"} />
    <CloudWorkspaceSwitchDialog controller={controller} authenticationRequired gate={<CloudSignedOutRoute compact activeSection="contents"
      authState={{ status: restoring ? "restoring" : "signed-out", apiBaseUrl: API }} apiBaseUrl={API} loadingLabel="Restoring Cloud session…" />} />
  </>;
}
const render = async (restoring = false) => {
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(withTestLocalization(<Harness restoring={restoring} />)));
  const input = document.querySelector<HTMLInputElement>("input")!; input.focus();
  await act(async () => document.querySelector<HTMLButtonElement>("button")!.click());
  return input;
};
afterEach(() => { act(() => root?.unmount()); root = null; document.body.innerHTML = ""; vi.clearAllMocks(); auth.native = true; });

describe("login before Cloud selection", () => {
  it.each([true, false])("reuses the trusted login owner (native OAuth: %s) without selecting Cloud", async (native) => {
    auth.native = native;
    const local = await render();
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.querySelector("aside, nav")).toBeNull();
    expect(dialog.textContent).toContain("Your project, always online.");
    expect(dialog.querySelector('[role="img"][aria-label="Manus"]')).not.toBeNull();
    expect(dialog.querySelector('[role="img"][aria-label="Viktor"]')).not.toBeNull();
    expect(local.value).toBe("Keep this draft");
    const signIn = dialog.querySelector<HTMLButtonElement>("[data-cloud-sign-in-action]")!;
    expect(signIn.textContent).toBe("Sign in to get started");
    expect(document.activeElement).toBe(signIn);
    await act(async () => signIn.click());
    expect(native ? auth.start : auth.browser).toHaveBeenCalledWith(native ? API : "/login");
    expect(native ? auth.browser : auth.start).not.toHaveBeenCalled();
    expect(signIn.disabled).toBe(native);
    if (native) expect(dialog.textContent).toContain("Finish signing in in your browser.");
    expect(document.querySelector('[data-current-provider]')?.getAttribute("data-current-provider")).toBe("local");
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(local);
    expect(local.value).toBe("Keep this draft");
  });
  it("allows another attempt after sign-in fails while keeping the local draft", async () => {
    auth.start.mockRejectedValueOnce(new Error("Fixture browser could not open"));
    const local = await render();
    const signIn = document.querySelector<HTMLButtonElement>("[data-cloud-sign-in-action]")!;
    await act(async () => signIn.click());
    expect(signIn.disabled).toBe(false);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Fixture browser could not open");
    expect(document.querySelector('[data-current-provider]')?.getAttribute("data-current-provider")).toBe("local");
    expect(local.value).toBe("Keep this draft");
    await act(async () => signIn.click());
    expect(auth.start).toHaveBeenCalledTimes(2);
    expect(signIn.disabled).toBe(true);
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });
  it("waits for authoritative restoration before offering sign-in", async () => {
    await render(true);
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.querySelector('[role="status"]')).not.toBeNull();
    expect(dialog.querySelector("[data-cloud-sign-in-action]")).toBeNull();
    expect(auth.start).not.toHaveBeenCalled();
    expect(document.querySelector('[data-current-provider]')?.getAttribute("data-current-provider")).toBe("local");
  });
});
