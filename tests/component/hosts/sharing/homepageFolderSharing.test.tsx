/** @vitest-environment happy-dom */
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HostCatalogDevice } from "../../../../shared/host-contract/types";
import type { DesktopCloudSession } from "../../../../src/lib/cloudApi";
import { HomepageComputers, useHomepageFolderSharing } from "../../../../src/features/hosts";
import { forgetSharedFolder } from "../../../../src/features/hosts/model/sharedFolders";
import { installDesktopBridge } from "../../../support/electron/desktopBridge";
import { HomeWithEntryFlow } from "../../../support/react/homeWithEntryFlow";
import { withTestLocalization } from "../../../support/react/localization";
import { createTestSurfaceAppearance } from "../../../support/react/surfaceAppearance";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const API = "https://fixture.puppyone.ai/api/v1";
const DEVICE = "11111111-1111-4111-8111-111111111111";
const DRAFT = "/fixture/home-share/draft";
const LINKED = "/fixture/home-share/linked";
const SHARED = "/fixture/home-share/shared";
const session = { user_id: "owner", session_generation: "one", api_base_url: API } as DesktopCloudSession;
const items = [
  { id: "draft", label: "Draft", localPath: DRAFT },
  { id: "linked", label: "Linked", localPath: LINKED, linkedCloudProject: { id: "existing", name: "Existing" } },
  { id: "shared", label: "Shared", localPath: SHARED, hostFolderId: "shared" },
];
const publish = vi.fn(async () => {});
const opened = vi.fn();
const returned = vi.fn();
const register = vi.fn();
let devices: HostCatalogDevice[];
let root: Root;

function Harness({ account = session }: { account?: DesktopCloudSession }) {
  const [path, setPath] = useState<string | null>(null);
  const sharing = useHomepageFolderSharing({ enabled: true, session: account, apiBase: API,
    workspacePath: path, workspaceName: path === LINKED ? "Linked" : "Draft",
    openProject: async (next) => { opened(next); setPath(next); },
    returnHome: async () => { returned(); setPath(null); } });
  return <>{!path && <HomeWithEntryFlow key={sharing.authority} appearance={createTestSurfaceAppearance()}
    projectItems={items} cloudSpaces={[{ id: "personal", name: "Me", kind: "personal", canCreateProjects: true }]}
    cloudSpacesStatus="ready" onPublishToSpace={publish} onShareLocalFolder={sharing.request}
    onChooseWorkspace={async () => {}} onOpenWorkspacePath={async () => {}} onOpenDroppedWorkspace={async () => {}}
    projectGroups={(base) => <HomepageComputers key={sharing.authority} session={account} apiBase={API} base={base} onOpen={() => {}} />} />}
    {sharing.dialog}</>;
}
async function render(account = session) {
  await act(async () => root.render(withTestLocalization(<Harness account={account} />)));
}
const group = (id: string) => document.querySelector<HTMLElement>(`[data-project-group="${id}"]`);
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === text)!;
const project = (name: string) => [...document.querySelectorAll<HTMLButtonElement>("button[draggable=true]")]
  .find((b) => (b.querySelector(".onboarding-project-tile-name") ?? b).textContent === name)!;
async function drag(element: Element, type: string) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: { effectAllowed: "", dropEffect: "", setData() {},
    getData: () => "/forged/root", files: [], types: ["text/plain"] } });
  await act(async () => { element.dispatchEvent(event); });
}
async function shareDraft() {
  await drag(project("Draft"), "dragstart");
  await drag(group("personal-shared")!, "drop");
}
beforeEach(() => {
  publish.mockClear(); opened.mockClear(); returned.mockClear(); register.mockReset();
  devices = [{ id: DEVICE, name: "This computer", platform: "darwin", state: "active", online: true,
    revision: 1, last_seen_at: null, folders: [{ id: "shared", name: "Shared", state: "active", revision: 1, capabilities: ["folder.read"] }] }];
  register.mockImplementation(async ({ rootPath, writable }: { rootPath: string; writable: boolean }) => {
    const folderId = rootPath === LINKED ? "new-linked" : "new-draft";
    devices[0] = { ...devices[0], folders: [...devices[0].folders, { id: folderId, name: "Draft", state: "active", revision: 1,
      capabilities: writable ? ["folder.read", "folder.write"] : ["folder.read"] }] };
    return { deviceId: DEVICE, folderId };
  });
  installDesktopBridge({ listHostDevices: async () => ({ devices }), registerHostFolder: register,
    getHostStatus: async () => ({ state: "online", deviceId: DEVICE, paused: false, running: [], folders: [] }),
    onHostStatus: () => () => {} } as never);
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); document.body.replaceChildren();
  forgetSharedFolder("new-draft", DRAFT); forgetSharedFolder("new-linked", LINKED);
});

describe("local folder drag into My Share Project", () => {
  it("opens the exact source, asks first, then returns Home with one shared card and no Cloud publication", async () => {
    await render(); await shareDraft();
    expect(opened).toHaveBeenCalledExactlyOnceWith(DRAFT);
    expect(register).not.toHaveBeenCalled(); expect(publish).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("not kept in the Cloud");
    await act(async () => button("Make available").click());
    expect(register).toHaveBeenCalledExactlyOnceWith({ rootPath: DRAFT, writable: false,
      expectedSession: { userId: "owner", generation: "one" } });
    expect(returned).toHaveBeenCalledOnce();
    expect(group("personal-shared")?.textContent).toContain("Draft");
    expect(group("local-only")?.textContent).not.toContain("Draft");
    expect([...document.querySelectorAll('[data-project-open]')].filter((b) => (b.querySelector(".onboarding-project-tile-name") ?? b).textContent === "Draft")).toHaveLength(1);
    expect(publish).not.toHaveBeenCalled();
  });
  it("returns an unshared folder unchanged when the dialog is cancelled", async () => {
    await render(); await shareDraft(); await act(async () => button("Cancel").click());
    expect(register).not.toHaveBeenCalled(); expect(group("local-only")?.textContent).toContain("Draft");
    expect(group("personal-shared")?.textContent).not.toContain("Draft");
  });
  it("does not move the card when native approval is declined", async () => {
    register.mockResolvedValue({ cancelled: true });
    await render(); await shareDraft(); await act(async () => button("Make available").click());
    expect(returned).not.toHaveBeenCalled(); expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => button("Cancel").click());
    expect(group("local-only")?.textContent).toContain("Draft");
  });
  it("keeps failures in the confirmation instead of pretending the folder is shared", async () => {
    register.mockRejectedValue(new Error("Host unavailable"));
    await render(); await shareDraft(); await act(async () => button("Make available").click());
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("Host unavailable");
    await act(async () => button("Cancel").click());
    expect(group("local-only")?.textContent).toContain("Draft");
  });
  it("rejects forged external paths and already-shared sources", async () => {
    await render(); await drag(group("personal-shared")!, "drop");
    await drag(project("Shared"), "dragstart"); await drag(group("personal-shared")!, "drop");
    expect(opened).not.toHaveBeenCalled(); expect(register).not.toHaveBeenCalled(); expect(publish).not.toHaveBeenCalled();
  });
  it("can share a linked local folder without rebinding or publishing its Cloud project", async () => {
    await render(); await drag(project("Linked"), "dragstart"); await drag(group("personal-shared")!, "drop");
    expect(opened).toHaveBeenCalledExactlyOnceWith(LINKED);
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Linked");
    expect(publish).not.toHaveBeenCalled();
  });
  it("reveals an empty personal area for a drag, without needing a hosted personal destination", async () => {
    devices[0] = { ...devices[0], folders: [] };
    await render(); expect(group("personal-shared")).toBeNull();
    await shareDraft(); expect(opened).toHaveBeenCalledExactlyOnceWith(DRAFT);
  });
  it("offers a keyboard-accessible equivalent even when the personal area is empty", async () => {
    devices[0] = { ...devices[0], folders: [] };
    await render();
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Open on my other computers…"]')!.click());
    const entry = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((b) => b.textContent === "Draft")!;
    expect(document.activeElement).toBe(entry);
    await act(async () => entry.click()); expect(opened).toHaveBeenCalledExactlyOnceWith(DRAFT);
  });
  it("discards the drag when the account generation changes", async () => {
    await render(); await drag(project("Draft"), "dragstart");
    await render({ ...session, session_generation: "two" });
    await drag(group("personal-shared")!, "drop"); expect(opened).not.toHaveBeenCalled();
  });
});
