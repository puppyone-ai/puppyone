/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OnboardingGroupsBase } from "../../../../src/components/onboarding/OnboardingProjectGroups";
import { HomepageComputers } from "../../../../src/features/hosts";
import { installDesktopBridge } from "../../../support/electron/desktopBridge";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const device = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const session = { user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", session_generation: "one" };
const base: OnboardingGroupsBase = { label: "Projects", layout: "grid", cloud: [], showOtherComputers: true,
  local: { title: "This computer", render: () => <ul className="onboarding-project-list" /> } };
let root: Root | null = null;

afterEach(() => { act(() => root?.unmount()); root = null; document.body.replaceChildren(); });

async function render(bridge: Record<string, unknown>) {
  installDesktopBridge({
    listHostDevices: async () => ({ devices: [{ id: device, name: "Studio Mac", online: true, folders: [] }] }),
    getHostStatus: async () => ({ state: "online", deviceId: device, paused: false, activeRequests: 0, watching: 0, running: [] }),
    onHostStatus: () => () => {},
    ...bridge,
  } as never);
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(withTestLocalization(
    <HomepageComputers session={session as never} apiBase="https://api.puppyone.ai/api/v1" base={base} onOpen={() => {}} />)));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  return host;
}

/** This computer's menu item for sharing after a restart, opening the menu first. */
async function startAtLogin(host: HTMLElement) {
  const trigger = host.querySelector<HTMLButtonElement>('[data-project-group="this-computer"] .onboarding-project-group-menu');
  if (trigger?.getAttribute("aria-expanded") !== "true") await act(async () => { trigger?.click(); });
  return [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemcheckbox"]')]
    .find((item) => item.textContent?.includes("Share after this computer restarts")) ?? null;
}

describe("starting the host service at login", () => {
  it("is in this computer's menu and turns on through the App", async () => {
    const setHostAutostart = vi.fn(async ({ enabled }: { enabled: boolean }) => ({ supported: true, enabled }));
    const host = await render({ getHostAutostart: async () => ({ supported: true, enabled: false }), setHostAutostart });
    const item = await startAtLogin(host);
    expect(item?.getAttribute("aria-checked")).toBe("false");
    await act(async () => { item?.click(); });
    expect(setHostAutostart).toHaveBeenCalledWith({ enabled: true });
    expect((await startAtLogin(host))?.getAttribute("aria-checked")).toBe("true");
  });

  it("is not offered where this computer cannot start it", async () => {
    const host = await render({ getHostAutostart: async () => ({ supported: false, enabled: false }) });
    expect(await startAtLogin(host)).toBeNull();
  });

  it("says so when the setting cannot be changed", async () => {
    const host = await render({ getHostAutostart: async () => ({ supported: true, enabled: false }),
      setHostAutostart: async () => { throw new Error("denied"); } });
    const item = await startAtLogin(host);
    await act(async () => { item?.click(); });
    expect(host.querySelector(".onboarding-project-groups-note")?.textContent).toContain("Unable to change this setting.");
  });
});
