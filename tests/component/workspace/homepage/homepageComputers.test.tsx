/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HostCatalogDevice } from "../../../../shared/host-contract/types";
import type { OnboardingGroupsBase } from "../../../../src/components/onboarding/OnboardingProjectGroups";
import type { ProjectListSharing } from "../../../../src/components/onboarding/OnboardingProjectList";
import { HomepageComputers } from "../../../../src/features/hosts";
import { forgetSharedFolder, rememberSharedFolder } from "../../../../src/features/hosts/model/sharedFolders";
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

async function render({ bridge = {} }: { bridge?: Record<string, unknown> } = {}) {
  installDesktopBridge({
    listHostDevices: async () => ({ devices }),
    getHostStatus: async () => ({ state: "online", deviceId: THIS, paused: false, activeRequests: 0, watching: 0, running: [] }),
    onHostStatus: () => () => {},
    ...bridge,
  } as never);
  let sharing: ProjectListSharing | undefined;
  const base: OnboardingGroupsBase = { label: "Projects", layout: "grid",
    personalSharedTitle: "My shared projects",
    cloud: [{ id: "team-shared", title: "Team shared projects", children: <ul className="onboarding-project-list" /> }],
    local: { title: "Only on this computer", items: [
      { id: "local-shared", label: "ditherit", localPath: "/fixture/ditherit", hostFolderId: "f-1" },
      { id: "local-paused", label: "paused", localPath: "/fixture/paused", hostFolderId: "f-2" },
      { id: "local-private", label: "private", localPath: "/fixture/private" },
    ], render: (items, given) => { sharing = given; return <ul className="onboarding-project-list">
      {items.map((item) => <li key={item.id}>{item.label}</li>)}</ul>; } } };
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
const personal = (host: HTMLElement) => host.querySelector<HTMLElement>('[data-project-group="personal-shared"]')!;
const deviceList = (host: HTMLElement, name: string) => host.querySelector<HTMLElement>(`ul[aria-label="On ⁨${name}⁩"]`)!;

describe("the owner's other computers on the Homepage", () => {
  it("shows three audiences, with shared local and remote folders together rather than device headings", async () => {
    const { host } = await render();
    expect(titles(host)).toEqual(["Team shared projects", "My shared projects", "Only on this computer"]);
    expect(personal(host).textContent).toContain("ditherit");
    expect(personal(host).textContent).toContain("paused");
    expect(personal(host).textContent).toContain("contracts");
    const localOnly = host.querySelector('[data-project-group="local-only"]');
    expect(localOnly?.textContent).toContain("private");
    expect(localOnly?.textContent).not.toContain("ditherit");
    expect(host.querySelector('[data-project-group^="computer:"]')).toBeNull();
  });

  it("lists a computer's open folders by name, and opens one there", async () => {
    const { host, onOpen } = await render();
    const studio = deviceList(host, "Studio Mac");
    expect([...studio.querySelectorAll(".onboarding-project-tile-name")].map((name) => name.textContent)).toEqual(["design", "gone", "zines"]);
    expect(studio.querySelector<HTMLButtonElement>("[data-host-folder='s-3'] button")?.disabled).toBe(true);
    await act(async () => { studio.querySelector<HTMLButtonElement>("[data-host-folder='s-1'] button")?.click(); });
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({
      ref: { deployment: API, accountId: session.user_id, deviceId: STUDIO, folderId: "s-1" },
      name: "design", hostName: "Studio Mac", writable: true,
    }));
  });

  it("keeps an offline computer's folders in view without letting them open", async () => {
    const { host } = await render();
    const office = deviceList(host, "Office PC");
    expect(office.querySelector("[data-host-folder='o-1']")?.getAttribute("data-inactive")).toBe("true");
    expect(office.querySelector<HTMLButtonElement>("[data-host-folder='o-1'] button")?.disabled).toBe(true);
  });

  it("tells this computer's list which of its folders are open to the others", async () => {
    const { host, sharing } = await render();
    expect([...sharing()!.sharedFolderIds]).toEqual(["f-1", "f-2"]);
    expect(personal(host).textContent).not.toContain("folder open to your other computers");
  });

  it("retains recorded sharing through a failed catalog read instead of claiming local-only", async () => {
    const { host } = await render({ bridge: { listHostDevices: async () => { throw new Error("offline"); } } });
    expect(personal(host).textContent).toContain("ditherit");
    expect(host.querySelector('[data-project-group="local-only"]')?.textContent).not.toContain("ditherit");
    expect(host.querySelector('[role="status"]')).not.toBeNull();
  });

  it("keeps known sharing and avoids duplicate remote cards when this computer's status is unavailable", async () => {
    const { host } = await render({ bridge: { getHostStatus: async () => { throw new Error("host unavailable"); } } });
    expect(personal(host).textContent).toContain("ditherit");
    expect(host.querySelector('[data-project-group="local-only"]')?.textContent).not.toContain("ditherit");
    expect(host.querySelector('[data-host-folder="f-1"]')).toBeNull();
  });

  it("moves the card only after an explicit stop-sharing confirmation and updates again on sharing", async () => {
    const { host } = await render();
    await act(async () => forgetSharedFolder("f-1", "/fixture/ditherit"));
    expect(personal(host).textContent).not.toContain("ditherit");
    expect(host.querySelector('[data-project-group="local-only"]')?.textContent).toContain("ditherit");
    await act(async () => rememberSharedFolder("/fixture/ditherit", "f-1"));
    expect(personal(host).textContent).toContain("ditherit");
    expect(host.querySelector('[data-project-group="local-only"]')?.textContent).not.toContain("ditherit");
  });

  it("removes another computer through the App, which asks first", async () => {
    const revokeHostDevice = vi.fn(async () => ({ revoked: true }));
    const { host } = await render({ bridge: { revokeHostDevice } });
    await act(async () => { personal(host).querySelector<HTMLButtonElement>('[aria-label="Manage computers"]')?.click(); });
    const remove = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
      .find((item) => stripBidiIsolation(item.textContent).includes("Remove Office PC"));
    await act(async () => { remove?.click(); });
    expect(revokeHostDevice).toHaveBeenCalledWith({ deviceId: OFFICE, expectedSession: { userId: session.user_id, generation: "one" } });
  });
});
