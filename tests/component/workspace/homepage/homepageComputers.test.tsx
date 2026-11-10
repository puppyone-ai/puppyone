/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HostCatalogDevice } from "../../../../shared/host-contract/types";
import type { OnboardingGroupsBase } from "../../../../src/components/onboarding/OnboardingProjectGroups";
import type { ProjectListSharing } from "../../../../src/components/onboarding/OnboardingProjectList";
import { HomepageComputers } from "../../../../src/features/hosts";
import { clearSharedFolderAssignments, forgetSharedFolder, rememberSharedFolder } from "../../../../src/features/hosts/model/sharedFolders";
import { installDesktopBridge } from "../../../support/electron/desktopBridge";
import { withTestLocalization } from "../../../support/react/localization";
import { accessibleName, getByRole, isDisabled, queryAllByRole, queryByRole } from "../../../support/react/queries";

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
afterEach(() => { act(() => root?.unmount()); root = null; document.body.replaceChildren(); clearSharedFolderAssignments(); });

/**
 * Mounts the groups and waits until the catalog has answered: by default, until the
 * other computers' folders are listed.
 */
async function render({ bridge = {}, until = (host: HTMLElement) => Boolean(deviceList(host, "Studio Mac")) }:
  { bridge?: Record<string, unknown>; until?: (host: HTMLElement) => boolean } = {}) {
  installDesktopBridge({
    listHostDevices: async () => ({ devices }),
    getHostStatus: async () => ({ state: "online", deviceId: THIS, paused: false, activeRequests: 0, watching: 0, running: [] }),
    onHostStatus: () => () => {},
    ...bridge,
  } as never);
  let sharing: ProjectListSharing | undefined;
  const base: OnboardingGroupsBase = { label: "Projects", layout: "grid",
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
  await vi.waitFor(() => expect(until(host)).toBe(true));
  return { host, onOpen, sharing: () => sharing };
}

/** The groups as announced: regions named by their headings. */
const titles = (host: HTMLElement) => queryAllByRole(host, "region").map(accessibleName);
const region = (host: HTMLElement, name: string) => queryByRole(host, "region", { name });
const personal = (host: HTMLElement) => region(host, "Only on this computer")!;
const localOnly = (host: HTMLElement) => region(host, "Only on this computer")!;
const deviceList = (host: HTMLElement, name: string) => queryByRole(host, "list", { name: `On ${name}` });
/** A remote folder's button, by the name it is announced with. */
const folderButtons = (list: HTMLElement) => queryAllByRole(list, "button").map((button) =>
  [accessibleName(button), isDisabled(button)]);

describe("the owner's other computers on the Homepage", () => {
  it("shows three audiences, with shared local and remote folders together rather than device headings", async () => {
    const { host } = await render();
    expect(titles(host)).toEqual(["Only on this computer", "Team shared projects", "Other computers"]);
    expect(personal(host).textContent).toContain("ditherit");
    expect(personal(host).textContent).toContain("paused");
    expect(region(host, "Other computers")?.textContent).toContain("contracts");
    expect(localOnly(host).textContent).toContain("private");
    expect(localOnly(host).textContent).toContain("ditherit");
  });

  it("lists a computer's open folders by name, and opens one there", async () => {
    const { host, onOpen } = await render();
    const studio = deviceList(host, "Studio Mac")!;
    // A paused folder stays in view, but cannot be opened.
    expect(folderButtons(studio)).toEqual([
      ["Open design on Studio Mac", false], ["Open gone on Studio Mac", true], ["Open zines on Studio Mac", false]]);
    await act(async () => { getByRole(studio, "button", { name: "Open design on Studio Mac" }).click(); });
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({
      ref: { deployment: API, accountId: session.user_id, deviceId: STUDIO, folderId: "s-1" },
      name: "design", hostName: "Studio Mac", writable: true,
    }));
  });

  it("keeps an offline computer's folders in view without letting them open", async () => {
    const { host } = await render();
    expect(folderButtons(deviceList(host, "Office PC")!)).toEqual([["Open contracts on Office PC", true]]);
  });

  it("tells this computer's list which of its folders are open to the others", async () => {
    const { host, sharing } = await render();
    expect([...sharing()!.sharedFolderIds]).toEqual(["f-1", "f-2"]);
    expect(personal(host).textContent).not.toContain("folder open to your other computers");
  });

  it("retains recorded sharing through a failed catalog read instead of claiming local-only", async () => {
    const { host } = await render({ bridge: { listHostDevices: async () => { throw new Error("offline"); } },
      until: (mounted) => queryAllByRole(mounted, "status").length > 0 });
    expect(personal(host).textContent).toContain("ditherit");
    expect(localOnly(host).textContent).toContain("ditherit");
  });

  it("keeps known sharing and avoids duplicate remote cards when this computer's status is unavailable", async () => {
    const { host } = await render({ bridge: { getHostStatus: async () => { throw new Error("host unavailable"); } } });
    expect(personal(host).textContent).toContain("ditherit");
    expect(localOnly(host).textContent).toContain("ditherit");
    // This computer's own folder is not listed again as if it were on another computer.
    expect(queryAllByRole(personal(host), "button", { name: /^Open notes on / })).toEqual([]);
  });

  it("moves the card only after an explicit stop-sharing confirmation and updates again on sharing", async () => {
    const { host } = await render();
    await act(async () => forgetSharedFolder("f-1", "/fixture/ditherit"));
    expect(personal(host).textContent).toContain("ditherit");
    expect(localOnly(host).textContent).toContain("ditherit");
    await act(async () => rememberSharedFolder("/fixture/ditherit", "f-1"));
    expect(personal(host).textContent).toContain("ditherit");
    expect(localOnly(host).textContent).toContain("ditherit");
  });

});
