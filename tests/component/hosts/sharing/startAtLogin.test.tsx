/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HomepageDeviceFolders } from "../../../../src/features/hosts/ui/HomepageDeviceFolders";
import { installDesktopBridge } from "../../../support/electron/desktopBridge";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const device = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const session = { user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", session_generation: "one" };
let root: Root | null = null;

afterEach(() => { act(() => root?.unmount()); root = null; document.body.replaceChildren(); });

async function render(bridge: Record<string, unknown>) {
  installDesktopBridge({
    listHostDevices: async () => ({ devices: [{ id: device, name: "Studio Mac", online: true, folders: [] }] }),
    listRecentHostFolders: async () => ({ folders: [] }),
    getHostStatus: async () => ({ state: "online", deviceId: device, paused: false, activeRequests: 0, watching: 0, running: [] }),
    onHostStatus: () => () => {},
    ...bridge,
  } as never);
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(withTestLocalization(
    <HomepageDeviceFolders session={session as never} apiBase="https://api.puppyone.ai/api/v1" onOpen={() => {}} />)));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  return host;
}

const checkbox = (host: HTMLElement) => [...host.querySelectorAll("label")]
  .find((label) => label.textContent?.includes("Share after this computer restarts"))?.querySelector("input") ?? null;

describe("starting the host service at login", () => {
  it("shows the switch for this computer and turns it on through the App", async () => {
    const setHostAutostart = vi.fn(async ({ enabled }: { enabled: boolean }) => ({ supported: true, enabled }));
    const host = await render({ getHostAutostart: async () => ({ supported: true, enabled: false }), setHostAutostart });
    const input = checkbox(host);
    console.log("HTML", host.innerHTML.slice(0, 1500));
    expect(input?.checked).toBe(false);
    await act(async () => { input?.click(); });
    expect(setHostAutostart).toHaveBeenCalledWith({ enabled: true });
    expect(checkbox(host)?.checked).toBe(true);
  });

  it("shows nothing where this computer cannot start it", async () => {
    const host = await render({ getHostAutostart: async () => ({ supported: false, enabled: false }) });
    expect(checkbox(host)).toBeNull();
  });

  it("says so when the setting cannot be changed", async () => {
    const host = await render({ getHostAutostart: async () => ({ supported: true, enabled: false }),
      setHostAutostart: async () => { throw new Error("denied"); } });
    await act(async () => { checkbox(host)?.click(); });
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Unable to change this setting.");
  });
});
