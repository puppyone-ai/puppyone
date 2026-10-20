/** @vitest-environment happy-dom */
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DesktopProjectLocationSwitcher, type DesktopProjectLocation } from "../../../../src/features/app-shell/DesktopProjectLocationSwitcher";
import { desktopPreferencesStore as store, initializeDesktopPreferences } from "../../../../src/preferencesStore";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("../../../../src/platform/useDesktopPlatformCapabilities", () => ({
  useDesktopPlatformCapabilities: () => ({ platform: "macos" }),
}));
let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  localStorage.clear();
  initializeDesktopPreferences();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});
function icons(enabled: boolean) {
  act(() => store.getState().setExperimentalSettings(s => ({ ...s, enableProjectLocationIconsInHeader: enabled })));
}
function button(location: "local" | "cloud") {
  return document.querySelector<HTMLButtonElement>(`button[data-project-location="${location}"]`)!;
}
async function render(props: Partial<Parameters<typeof DesktopProjectLocationSwitcher>[0]> = {}) {
  await act(async () => root.render(withTestLocalization(<DesktopProjectLocationSwitcher
    projectLocation={{ current: "local", localAvailable: true, cloudState: "available" }}
    {...props} />)));
  if (!store.getState().experimentalSettings.enableProjectLocationIconsInHeader) act(() => document.querySelector<HTMLButtonElement>(".desktop-titlebar-location-button")?.click());
}

describe("project location presentation experiment", () => {
  it.each([false, true])("hides local / Cloud switching while Cloud is disabled (icons: %s)", async (inline) => {
    icons(inline);
    await render({ projectLocation: undefined });
    expect(document.querySelector(".desktop-project-location-controls")).toBeNull();
    expect(document.querySelector(".desktop-titlebar-location-button")).toBeNull();
  });

  it.each([false, true])("uses one selection controller before, during and after Cloud loading (icons: %s)", async (inline) => {
    icons(inline);
    let finish: () => void = () => undefined;
    const navigate = vi.fn();
    function Harness() {
      const [location, setLocation] = useState<DesktopProjectLocation>({ current: "local", localAvailable: true, cloudState: "available" });
      finish = () => setLocation({ ...location, current: "cloud", requested: "cloud", loading: false });
      return <DesktopProjectLocationSwitcher projectLocation={location}
        onViewCloud={() => { navigate("cloud"); setLocation({ ...location, requested: "cloud", headerLocation: "cloud", loading: true }); }}
        onViewLocal={() => { navigate("local"); setLocation({ ...location, current: "local", requested: "local", headerLocation: "local", loading: false }); }} />;
    }
    await act(async () => root.render(withTestLocalization(<Harness />)));
    if (!inline) act(() => document.querySelector<HTMLButtonElement>(".desktop-titlebar-location-button")!.click());
    const controls = document.querySelector(".desktop-project-location-controls");
    const cloudButton = button("cloud");
    expect(Boolean(controls?.closest(".desktop-project-location-menu"))).toBe(!inline);
    expect(cloudButton.getAttribute("aria-label")).toBe(inline ? "Hosted workspace" : "Open in a hosted workspace");
    expect(cloudButton.textContent).toBe(inline ? "" : "Open in a hosted workspace");
    expect(button("local").textContent).toBe(inline ? "Local" : "Open on This Mac");
    act(() => cloudButton.click());
    expect(button("cloud")).toBe(cloudButton);
    expect(button("cloud").getAttribute("aria-pressed")).toBe("true");
    expect(button("local").getAttribute("aria-current")).toBe("true");
    expect(cloudButton.textContent).toBe(inline ? "Hosted workspace" : "Open in a hosted workspace");
    expect(button("local").textContent).toBe(inline ? "" : "Open on This Mac");
    expect(controls?.getAttribute("data-presentation")).toBe(inline ? "header-icons" : "popover");
    if (!inline) {
      expect(cloudButton.classList.contains("desktop-menu-item")).toBe(true);
      expect(cloudButton.classList.contains("selected")).toBe(false);
      expect(cloudButton.querySelector(".desktop-menu-item-trailing .lucide-check")).toBeNull();
      expect(button("local").querySelector(".desktop-menu-item-trailing .lucide-check")).not.toBeNull();
      expect(controls?.querySelector(".desktop-project-location-indicator")).toBeNull();
    }
    expect(document.querySelector('.desktop-project-location-tabs')?.getAttribute("aria-busy")).toBe("true");
    expect(button("cloud").querySelector('[data-puppy-loader="pulse-grid"]')).not.toBeNull();
    act(() => cloudButton.click());
    expect(navigate).toHaveBeenCalledTimes(1);
    act(() => finish());
    expect(button("cloud")).toBe(cloudButton);
    expect(button("cloud").getAttribute("aria-current")).toBe("true");
    expect(button("cloud").querySelector('[data-puppy-loader]')).toBeNull();
    expect(cloudButton.textContent).toBe(inline ? "Hosted workspace" : "Open in a hosted workspace");
    act(() => button("local").click());
    expect(button("local").getAttribute("aria-pressed")).toBe("true");
    expect(button("local").textContent).toBe(inline ? "Local" : "Open on This Mac");
    expect(cloudButton.textContent).toBe(inline ? "" : "Open in a hosted workspace");
    expect(navigate.mock.calls).toEqual([["cloud"], ["local"]]);
  });

  it("updates live and removes the old popup without duplicating location controls", async () => {
    await render();
    expect(document.querySelector(".desktop-project-location-menu")).not.toBeNull();
    icons(true);
    expect(document.querySelector(".desktop-project-location-menu")).toBeNull();
    expect(document.querySelectorAll("button[data-project-location]")).toHaveLength(2);
    icons(false);
    expect(document.querySelector(".desktop-project-location-menu")).toBeNull();
    expect(document.querySelectorAll("button[data-project-location]")).toHaveLength(0);
    act(() => document.querySelector<HTMLButtonElement>(".desktop-titlebar-location-button")!.click());
    expect(document.querySelectorAll("button[data-project-location]")).toHaveLength(2);
  });

  it("keeps the Cloud icon for creation and invokes the existing creation flow", async () => {
    icons(true);
    const create = vi.fn();
    await render({ projectLocation: { current: "local", localAvailable: true, cloudState: "unavailable" }, onViewCloud: create });
    expect(button("cloud").getAttribute("aria-label")).toBe("Open in a hosted workspace");
    expect(button("cloud").querySelector(".lucide-plus")).toBeNull();
    expect(button("cloud").querySelector("svg")).not.toBeNull();
    act(() => button("cloud").click());
    expect(create).toHaveBeenCalledOnce();
  });

  it("disables a missing local destination and retains sign-in for a linked Cloud project", async () => {
    icons(true);
    await render({ projectLocation: { current: "cloud", localAvailable: false, cloudState: "available" }, onViewLocal: vi.fn() });
    expect(button("local").disabled).toBe(true);
    const signIn = vi.fn();
    await render({ projectLocation: { current: "local", localAvailable: true, cloudState: "signed-out" }, onViewCloud: signIn });
    expect(button("cloud").getAttribute("data-cloud-action")).toBeNull();
    act(() => button("cloud").click());
    expect(signIn).toHaveBeenCalledOnce();
  });

  it("closes the location popup when the project menu opens", async () => {
    await render();
    expect(document.querySelector(".desktop-project-location-menu")).not.toBeNull();
    await act(async () => root.render(withTestLocalization(<DesktopProjectLocationSwitcher
      projectMenuOpen projectLocation={{ current: "local", localAvailable: true, cloudState: "available" }} />)));
    expect(document.querySelector(".desktop-project-location-menu")).toBeNull();
  });
});
