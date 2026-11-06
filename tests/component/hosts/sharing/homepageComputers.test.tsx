/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HostCatalogDevice } from "../../../../shared/host-contract/types";
import type { OnboardingGroupsBase } from "../../../../src/components/onboarding/OnboardingProjectGroups";
import type { ProjectListSharing } from "../../../../src/components/onboarding/OnboardingProjectList";
import { HomepageComputers } from "../../../../src/features/hosts";
import { installDesktopBridge } from "../../../support/electron/desktopBridge";
import { stripBidiIsolation, withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const API = "https://api.puppyone.ai/api/v1";
const session = { user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", session_generation: "one" };
const THIS = "11111111-1111-4111-8111-111111111111";
const STUDIO = "22222222-2222-4222-8222-222222222222";
const OFFICE = "33333333-3333-4333-8333-333333333333";
const folder = (id: string, name: string, write = false) => ({ id, name, state: "active" as const, revision: 4,
  capabilities: write ? ["folder.read" as const, "folder.write" as const] : ["folder.read" as const] });
const devices: HostCatalogDevice[] = [
  { id: STUDIO, name: "Studio Mac", platform: "darwin", state: "active", revision: 1, online: true, last_seen_at: null,
    folders: [folder("s-2", "zines"), folder("s-1", "design", true), { ...folder("s-3", "gone"), state: "paused" }] },
  { id: THIS, name: "This one", platform: "darwin", state: "active", revision: 1, online: true, last_seen_at: null,
    folders: [folder("f-1", "notes", true), { ...folder("f-2", "paused"), state: "paused" }] },
  { id: OFFICE, name: "Office PC", platform: "win32", state: "active", revision: 1, online: false,
    last_seen_at: new Date(Date.now() - 3 * 3_600_000).toISOString(), folders: [folder("o-1", "contracts")] },
];
let root: Root | null = null;
afterEach(() => { act(() => root?.unmount()); root = null; document.body.replaceChildren(); });

async function render({ showOtherComputers = true, bridge = {} }: { showOtherComputers?: boolean; bridge?: Record<string, unknown> } = {}) {
  installDesktopBridge({
    listHostDevices: async () => ({ devices }),
    getHostStatus: async () => ({ state: "online", deviceId: THIS, paused: false, activeRequests: 0, watching: 0, running: [] }),
    onHostStatus: () => () => {},
    ...bridge,
  } as never);
  let sharing: ProjectListSharing | undefined;
  const base: OnboardingGroupsBase = { label: "Projects", layout: "grid", showOtherComputers,
    cloud: [{ id: "cloud", title: "Cloud", children: <ul className="onboarding-project-list" /> }],
    local: { title: "This computer", render: (given) => { sharing = given; return <ul className="onboarding-project-list" />; } } };
  const onOpen = vi.fn();
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(withTestLocalization(
    <HomepageComputers session={session as never} apiBase={API} base={base} onOpen={onOpen} />)));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  return { host, onOpen, sharing: () => sharing };
}

const titles = (host: HTMLElement) => [...host.querySelectorAll(".onboarding-project-group-title")]
  .map((title) => stripBidiIsolation(title.textContent));
const group = (host: HTMLElement, id: string) => host.querySelector<HTMLElement>(`[data-project-group="computer:${id}"]`)!;

describe("the owner's other computers on the Homepage", () => {
  it("follows the Cloud and this computer, one group per computer, named as the owner named it", async () => {
    const { host } = await render();
    expect(titles(host)).toEqual(["Cloud", "This computer", "Studio Mac", "Office PC"]);
    expect(group(host, STUDIO).querySelector(".onboarding-project-group-detail")?.textContent).toBe("Online");
    expect(group(host, OFFICE).querySelector(".onboarding-project-group-detail")?.textContent).toMatch(/^Last online/);
  });

  it("lists a computer's open folders by name, and opens one there", async () => {
    const { host, onOpen } = await render();
    const studio = group(host, STUDIO);
    expect([...studio.querySelectorAll(".onboarding-project-tile-name")].map((name) => name.textContent)).toEqual(["design", "zines"]);
    await act(async () => { studio.querySelector<HTMLButtonElement>("[data-host-folder='s-1'] button")?.click(); });
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({
      ref: { deployment: API, accountId: session.user_id, deviceId: STUDIO, folderId: "s-1" },
      name: "design", hostName: "Studio Mac", writable: true,
    }));
  });

  it("keeps an offline computer's folders in view without letting them open", async () => {
    const { host } = await render();
    const office = group(host, OFFICE);
    expect(office.dataset.inactive).toBe("true");
    expect(office.querySelector<HTMLButtonElement>("[data-host-folder='o-1'] button")?.disabled).toBe(true);
  });

  it("tells this computer's list which of its folders are open to the others", async () => {
    const { host, sharing } = await render();
    expect([...sharing()!.sharedFolderIds]).toEqual(["f-1"]);
    expect(host.querySelector('[data-project-group="this-computer"] .onboarding-project-group-detail')?.textContent)
      .toContain("1 folder open to your other computers");
  });

  it("leaves other computers out while the page is narrowed to some places", async () => {
    const { host } = await render({ showOtherComputers: false });
    expect(titles(host)).toEqual(["Cloud", "This computer"]);
  });

  it("removes another computer through the App, which asks first", async () => {
    const revokeHostDevice = vi.fn(async () => ({ revoked: true }));
    const { host } = await render({ bridge: { revokeHostDevice } });
    await act(async () => { group(host, OFFICE).querySelector<HTMLButtonElement>(".onboarding-project-group-menu")?.click(); });
    const remove = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
      .find((item) => item.textContent === "Remove computer");
    await act(async () => { remove?.click(); });
    expect(revokeHostDevice).toHaveBeenCalledWith({ deviceId: OFFICE, expectedSession: { userId: session.user_id, generation: "one" } });
  });
});
