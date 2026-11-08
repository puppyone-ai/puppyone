/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HostCatalogDevice } from "../../../../shared/host-contract/types";
import { OtherComputersSettings } from "../../../../src/features/hosts";
import { installDesktopBridge } from "../../../support/electron/desktopBridge";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const THIS = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OFFICE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const session = { user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", session_generation: "one" };
const expectedSession = { userId: session.user_id, generation: "one" };
const device = (id: string, name: string, online: boolean): HostCatalogDevice => ({ id, name, platform: "darwin",
  state: "active", revision: 1, online, last_seen_at: online ? null : new Date(Date.now() - 3 * 3_600_000).toISOString(), folders: [] });
let root: Root | null = null;
afterEach(() => { act(() => root?.unmount()); root = null; document.body.replaceChildren(); });

async function render(bridge: Record<string, unknown> = {}, devices = [device(THIS, "MacBook Pro", true), device(OFFICE, "Office PC", false)]) {
  installDesktopBridge({
    listHostDevices: async () => ({ devices }),
    getHostStatus: async () => ({ state: "online", deviceId: THIS, paused: false, activeRequests: 0, watching: 0, running: [] }),
    onHostStatus: () => () => {},
    getHostAutostart: async () => ({ supported: true, enabled: false }),
    ...bridge,
  } as never);
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(withTestLocalization(<OtherComputersSettings session={session as never} />)));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  return host;
}
const row = (host: HTMLElement, label: string) => [...host.querySelectorAll<HTMLElement>(".desktop-settings-row")]
  .find((candidate) => candidate.textContent?.includes(label));
const startAtLogin = (host: HTMLElement) => host.querySelector<HTMLInputElement>('input[aria-label="Share after this computer restarts"]');

describe("other computers, in Settings", () => {
  it("lists the owner's other computers with their presence, never this one among them", async () => {
    const host = await render();
    const others = [...host.querySelectorAll("[data-remove-computer]")].map((button) => button.getAttribute("data-remove-computer"));
    // One removal for this computer, one per other computer.
    expect(others).toEqual([THIS, OFFICE]);
    expect(row(host, "Office PC")?.textContent).toMatch(/Last online .*3 hours ago/);
  });

  it("removes another computer through the App, which asks first", async () => {
    const revokeHostDevice = vi.fn(async () => ({ revoked: true }));
    const host = await render({ revokeHostDevice });
    const remove = host.querySelector<HTMLButtonElement>(`[data-remove-computer="${OFFICE}"]`)!;
    expect(remove.getAttribute("aria-label")).toContain("Office PC");
    await act(async () => { remove.click(); });
    expect(revokeHostDevice).toHaveBeenCalledExactlyOnceWith({ deviceId: OFFICE, expectedSession });
  });

  it("removes this computer from the account, through the same request", async () => {
    const revokeHostDevice = vi.fn(async () => ({ revoked: true }));
    const host = await render({ revokeHostDevice });
    await act(async () => { host.querySelector<HTMLButtonElement>(`[data-remove-computer="${THIS}"]`)!.click(); });
    expect(revokeHostDevice).toHaveBeenCalledExactlyOnceWith({ deviceId: THIS, expectedSession });
  });

  it("says when there are no other computers yet", async () => {
    const host = await render({}, [device(THIS, "MacBook Pro", true)]);
    expect(host.querySelector("[data-other-computers-empty]")?.textContent).toContain("No other computers yet");
  });

  it("pauses this computer's sharing and resumes it from the same row", async () => {
    const setHostSharingPaused = vi.fn(async () => ({}));
    const host = await render({ setHostSharingPaused });
    expect(row(host, "Sharing")?.textContent).toContain("On");
    await act(async () => { host.querySelector<HTMLButtonElement>('[data-sharing-action="pause"]')!.click(); });
    expect(setHostSharingPaused).toHaveBeenCalledWith({ paused: true, expectedSession });
  });

  it("offers Resume while paused, where nothing else would", async () => {
    const host = await render({ getHostStatus: async () => ({ state: "online", deviceId: THIS, paused: true,
      activeRequests: 0, watching: 0, running: [] }) });
    expect(row(host, "Sharing")?.textContent).toContain("Paused");
    expect(host.querySelector('[data-sharing-action="resume"]')?.textContent).toBe("Resume");
  });

  it("turns sharing after a restart on through the App", async () => {
    const setHostAutostart = vi.fn(async ({ enabled }: { enabled: boolean }) => ({ supported: true, enabled }));
    const host = await render({ setHostAutostart });
    expect(startAtLogin(host)?.checked).toBe(false);
    await act(async () => { startAtLogin(host)!.click(); });
    expect(setHostAutostart).toHaveBeenCalledWith({ enabled: true });
    expect(startAtLogin(host)?.checked).toBe(true);
  });

  it("does not offer it where this computer cannot start it", async () => {
    const host = await render({ getHostAutostart: async () => ({ supported: false, enabled: false }) });
    expect(startAtLogin(host)).toBeNull();
  });

  it("says so when the setting cannot be changed", async () => {
    const host = await render({ setHostAutostart: async () => { throw new Error("denied"); } });
    await act(async () => { startAtLogin(host)!.click(); });
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Unable to change this setting.");
  });
});
