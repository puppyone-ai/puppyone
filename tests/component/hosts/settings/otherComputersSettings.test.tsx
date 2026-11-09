/** @vitest-environment happy-dom */
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HostCatalogDevice, HostSharingStatus } from "../../../../shared/host-contract/types";
import { OtherComputersSettings } from "../../../../src/features/hosts";
import { installDesktopBridge } from "../../../support/electron/desktopBridge";
import { withTestLocalization } from "../../../support/react/localization";
import { accessibleName, getByRole, queryAllByRole, queryByRole, readableText } from "../../../support/react/queries";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const THIS = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OFFICE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const session = { user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", session_generation: "one" };
const expectedSession = { userId: session.user_id, generation: "one" };
const device = (id: string, name: string, online: boolean): HostCatalogDevice => ({ id, name, platform: "darwin",
  state: "active", revision: 1, online, last_seen_at: online ? null : new Date(Date.now() - 3 * 3_600_000).toISOString(),
  folders: id === THIS ? [{ id: "notes", name: "Notes", state: "active", revision: 1, capabilities: ["folder.read"] }] : [] });
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
  await act(async () => root?.render(withTestLocalization(<StrictMode><OtherComputersSettings session={session as never} /></StrictMode>)));
  return host;
}
const thisComputer = (host: HTMLElement) => getByRole(host, "region", { name: "Sharing from this computer" });
const others = (host: HTMLElement) => getByRole(host, "region", { name: "Other computers" });
const removeButton = async (host: HTMLElement, name: string) => {
  const computer = name === "Remove this computer" ? "MacBook Pro" : name.replace(/^Remove /, "");
  await act(async () => { getByRole(host, "button", { name: `Options for ${computer}` }).click(); });
  return getByRole(document, "menuitem", { name });
};
const startAtLogin = (host: HTMLElement) => queryByRole(host, "checkbox", { name: "Continue sharing at login" }) as HTMLInputElement | null;

describe("other computers, in Settings", () => {
  it("shows a real off state without irrelevant startup controls", async () => {
    const host = await render({ getHostStatus: async () => ({ state: "off", deviceId: null, paused: false, folders: [] }) }, []);
    expect(readableText(thisComputer(host))).toContain("Not sharing");
    expect(readableText(thisComputer(host))).toContain("On the Homepage");
    expect(startAtLogin(host)).toBeNull();
    expect(queryByRole(thisComputer(host), "button", { name: "Pause" })).toBeNull();
  });

  it("does not turn a failed device read into an empty list, and offers retry", async () => {
    const listHostDevices = vi.fn().mockRejectedValue(new Error("unavailable"));
    const host = await render({ listHostDevices });
    expect(readableText(others(host))).toContain("Couldn’t load your computers.");
    expect(readableText(others(host))).not.toContain("Sign in to the same");
    const initialReads = listHostDevices.mock.calls.length;
    listHostDevices.mockResolvedValue({ devices: [device(THIS, "MacBook Pro", true)] });
    await act(async () => { getByRole(others(host), "button", { name: "Retry" }).click(); });
    expect(listHostDevices).toHaveBeenCalledTimes(initialReads + 1);
    expect(queryByRole(others(host), "alert")).toBeNull();
    expect(readableText(others(host))).toContain("Sign in to the same");
  });

  it("never claims sharing is on when local status is unavailable", async () => {
    const host = await render({ getHostStatus: async () => { throw new Error("service unavailable"); } });
    expect(readableText(thisComputer(host))).toContain("Can’t check sharing");
    expect(queryByRole(thisComputer(host), "button", { name: "Pause" })).toBeNull();
    expect(startAtLogin(host)).toBeNull();
  });

  it("shows local status while the computer list is still loading and coalesces focus refreshes", async () => {
    let finish!: (value: { devices: HostCatalogDevice[] }) => void;
    const pending = new Promise<{ devices: HostCatalogDevice[] }>((resolve) => { finish = resolve; });
    const listHostDevices = vi.fn(() => pending);
    const host = await render({ listHostDevices });
    expect(readableText(thisComputer(host))).toContain("Connected");
    expect(readableText(others(host))).not.toContain("Sign in to the same");
    const initialReads = listHostDevices.mock.calls.length;
    await act(async () => { window.dispatchEvent(new Event("focus")); window.dispatchEvent(new Event("focus")); });
    expect(listHostDevices).toHaveBeenCalledTimes(initialReads);
    await act(async () => finish({ devices: [device(THIS, "MacBook Pro", true), device(OFFICE, "Office PC", false)] }));
    expect(readableText(others(host))).toContain("Office PC");
  });

  it("keeps known computers visible when a background refresh fails", async () => {
    const listHostDevices = vi.fn().mockResolvedValue({ devices: [device(THIS, "MacBook Pro", true), device(OFFICE, "Office PC", false)] });
    const host = await render({ listHostDevices });
    listHostDevices.mockRejectedValue(new Error("offline"));
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(readableText(others(host))).toContain("Office PC");
    expect(getByRole(others(host), "button", { name: "Retry" })).toBeTruthy();
    expect(readableText(others(host))).not.toContain("Sign in to the same");
  });

  it("shows shared folder names and opens their existing access controls", async () => {
    const host = await render();
    await act(async () => { getByRole(host, "button", { name: "“Notes” on your other computers" }).click(); });
    expect(getByRole(document, "dialog")).toBeTruthy();
    expect(readableText(getByRole(document, "dialog"))).toContain("View only");
  });

  it("keeps a status event newer than an outstanding local status read", async () => {
    let finish!: (status: Partial<HostSharingStatus>) => void;
    let publish!: (status: Partial<HostSharingStatus>) => void;
    const host = await render({ getHostStatus: () => new Promise((resolve) => { finish = resolve; }),
      onHostStatus: (listener: typeof publish) => { publish = listener; return () => {}; } });
    expect(readableText(thisComputer(host))).toContain("Loading");
    await act(async () => publish({ state: "online", deviceId: THIS, paused: false, folders: [{ folderId: "notes", name: "Notes", writable: false }] }));
    await act(async () => finish({ state: "off", deviceId: null }));
    expect(readableText(thisComputer(host))).toContain("1 folder shared");
    expect(readableText(thisComputer(host))).not.toContain("Not sharing");
  });

  it("keeps its purpose and sign-in entry when signed out", async () => {
    const onSignIn = vi.fn();
    const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    await act(async () => root?.render(withTestLocalization(<OtherComputersSettings session={null} onSignIn={onSignIn} />)));
    expect(readableText(host)).toContain("Cross-computer access");
    expect(readableText(host)).toContain("Open shared folders");
    await act(async () => getByRole(host, "button", { name: "Sign in with browser" }).click());
    expect(onSignIn).toHaveBeenCalledOnce();
  });

  it("lists the owner's other computers with their presence, never this one among them", async () => {
    const host = await render();
    // Destructive actions stay in each computer’s menu.
    expect(queryAllByRole(host, "button", { name: /^Remove / }).map(accessibleName)).toEqual([]);
    expect(readableText(others(host))).toMatch(/Office PC Last online .*3 hours ago/);
    expect(readableText(others(host))).not.toContain("MacBook Pro");
  });

  it("removes another computer through the App, which asks first", async () => {
    const revokeHostDevice = vi.fn(async () => ({ revoked: true }));
    const host = await render({ revokeHostDevice });
    const button = await removeButton(host, "Remove Office PC");
    await act(async () => { button.click(); });
    expect(revokeHostDevice).toHaveBeenCalledExactlyOnceWith({ deviceId: OFFICE, expectedSession });
  });

  it("opens only one computer menu and restores focus on Escape", async () => {
    const host = await render();
    await removeButton(host, "Remove this computer");
    const office = getByRole(host, "button", { name: "Options for Office PC" });
    await act(async () => { office.click(); });
    expect(queryAllByRole(document, "menu")).toHaveLength(1);
    expect(getByRole(document, "menuitem", { name: "Remove Office PC" })).toBeTruthy();
    await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(queryByRole(document, "menu")).toBeNull();
    expect(document.activeElement).toBe(office);
  });

  it("says it could not remove the computer, not a folder, when Main gives no reason", async () => {
    const host = await render({ revokeHostDevice: async () => { throw new Error(); } });
    const button = await removeButton(host, "Remove Office PC");
    await act(async () => { button.click(); });
    await vi.waitFor(() => expect(readableText(getByRole(host, "alert"))).toBe("Unable to remove this computer."));
  });

  it("removes this computer from the account, through the same request", async () => {
    const revokeHostDevice = vi.fn(async () => ({ revoked: true }));
    const host = await render({ revokeHostDevice });
    const button = await removeButton(host, "Remove this computer");
    await act(async () => { button.click(); });
    expect(revokeHostDevice).toHaveBeenCalledExactlyOnceWith({ deviceId: THIS, expectedSession });
  });

  it("says when there are no other computers yet", async () => {
    const host = await render({}, [device(THIS, "MacBook Pro", true)]);
    expect(readableText(others(host))).toContain("Sign in to the same PuppyOne account on another computer");
  });

  it("pauses this computer's sharing and resumes it from the same row", async () => {
    const setHostSharingPaused = vi.fn(async () => ({}));
    const host = await render({ setHostSharingPaused });
    expect(readableText(thisComputer(host))).toContain("1 folder shared");
    expect(getByRole(thisComputer(host), "button", { name: "Pause" })).toBeTruthy();
    await act(async () => { getByRole(thisComputer(host), "button", { name: "Pause" }).click(); });
    expect(setHostSharingPaused).toHaveBeenCalledWith({ paused: true, expectedSession });
  });

  it("offers Resume while paused, where nothing else would", async () => {
    const host = await render({ getHostStatus: async () => ({ state: "online", deviceId: THIS, paused: true,
      activeRequests: 0, watching: 0, running: [] }) });
    expect(readableText(thisComputer(host))).toContain("Paused Resume");
    expect(getByRole(thisComputer(host), "button", { name: "Resume" })).toBeTruthy();
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
    await vi.waitFor(() => expect(readableText(getByRole(host, "alert"))).toContain("Unable to change this setting."));
  });
});
