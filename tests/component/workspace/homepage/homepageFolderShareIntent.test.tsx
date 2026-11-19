/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DesktopCloudSession } from "../../../../src/lib/cloudApi";
import { useHomepageFolderSharing } from "../../../../src/features/hosts";
import { installDesktopBridge } from "../../../support/electron/desktopBridge";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let request: NonNullable<ReturnType<typeof useHomepageFolderSharing>["request"]>;
let finish: () => void;
const openProject = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
const returnHome = vi.fn(async () => {});
const session = { user_id: "owner", session_generation: "one" } as DesktopCloudSession;
function Harness({ path = null, apiBase = "https://fixture.puppyone.ai/api/v1", account = session }: {
  path?: string | null; apiBase?: string; account?: DesktopCloudSession | null;
}) {
  const sharing = useHomepageFolderSharing({ enabled: true, session: account, apiBase,
    workspacePath: path, workspaceName: "Draft", openProject, returnHome });
  request = sharing.request!;
  return sharing.dialog;
}
async function render(props: Parameters<typeof Harness>[0] = {}) {
  await act(async () => root.render(withTestLocalization(<Harness {...props} />)));
}
beforeEach(() => {
  openProject.mockClear(); returnHome.mockClear();
  installDesktopBridge({ listHostDevices: async () => ({ devices: [] }), getHostStatus: async () => ({ state: "off" }),
    onHostStatus: () => () => {} } as never);
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); });
it("waits for the exact source to finish opening, then cancels back to Home", async () => {
  await render(); let pending!: Promise<void>;
  await act(async () => { pending = request("/fixture/draft"); });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await render({ path: "/fixture/draft" });
  await act(async () => { finish(); await pending; });
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Cancel")!.click());
  expect(returnHome).toHaveBeenCalledOnce();
});
it("drops failed and superseded navigation rather than opening a delayed dialog on a later visit", async () => {
  await render(); let pending!: Promise<void>;
  await act(async () => { pending = request("/fixture/draft"); });
  await render({ path: "/fixture/other" });
  await act(async () => { finish(); await pending; });
  await render({ path: "/fixture/draft" });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  openProject.mockRejectedValueOnce(new Error("open failed"));
  await act(async () => { await expect(request("/fixture/failed")).rejects.toThrow("open failed"); });
  await render({ path: "/fixture/failed" });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
it.each([
  { account: { ...session, user_id: "other" } },
  { account: { ...session, session_generation: "two" } },
  { apiBase: "https://other-fixture.puppyone.ai/api/v1" },
  { account: null },
])("cancels pending sharing on an authority change: %j", async (props) => {
  await render(); let pending!: Promise<void>;
  await act(async () => { pending = request("/fixture/draft"); });
  await render({ path: "/fixture/draft", ...props });
  await act(async () => { finish(); await pending; });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(returnHome).not.toHaveBeenCalled();
});
it("ignores late completion after leaving and revisiting the same source", async () => {
  let complete!: (value: { folderId: string; deviceId: string }) => void;
  installDesktopBridge({ ...window.puppyoneDesktop,
    registerHostFolder: () => new Promise((resolve) => { complete = resolve; }) } as never);
  await render(); let pending!: Promise<void>;
  await act(async () => { pending = request("/fixture/late-share"); });
  await render({ path: "/fixture/late-share" });
  await act(async () => { finish(); await pending; });
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Make available")!.click());
  await render({ path: "/fixture/other" });
  await render({ path: "/fixture/late-share" });
  await act(async () => complete({ folderId: "late", deviceId: "device" }));
  expect(returnHome).not.toHaveBeenCalled();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
it("closes a ready confirmation on navigation without returning an unrelated project Home", async () => {
  await render(); let pending!: Promise<void>;
  await act(async () => { pending = request("/fixture/draft"); });
  await render({ path: "/fixture/draft" });
  await act(async () => { finish(); await pending; });
  await render({ path: "/fixture/other" });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await render({ path: "/fixture/draft" });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(returnHome).not.toHaveBeenCalled();
});
