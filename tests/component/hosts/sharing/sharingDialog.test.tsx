/** @vitest-environment happy-dom */
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HostCatalogDevice, HostFolderCapability } from "../../../../shared/host-contract/types";
import { useHostCatalog } from "../../../../src/features/hosts/data/useHostCatalog";
import { HostFolderSharingDialog, type HostFolderSharingTarget } from "../../../../src/features/hosts/ui/HostFolderSharingDialog";
import { useHostFolderPlace } from "../../../../src/features/hosts";
import { rememberSharedFolder } from "../../../../src/features/hosts/model/sharedFolders";
import { ProjectAudienceRows } from "../../../../src/components/project-audience";
import { installDesktopBridge } from "../../../support/electron/desktopBridge";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const THIS = "11111111-1111-4111-8111-111111111111";
const FOLDER = "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1";
const session = { user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", session_generation: "one" };
const expectedSession = { userId: session.user_id, generation: "one" };
let root: Root | null = null;
afterEach(() => { act(() => root?.unmount()); root = null; document.body.replaceChildren(); });

function catalogWith(capabilities: HostFolderCapability[]): HostCatalogDevice[] {
  return [{ id: THIS, name: "Mac", platform: "darwin", state: "active", revision: 1, online: true, last_seen_at: null,
    folders: [{ id: FOLDER, name: "notes", state: "active", revision: 7, capabilities }] }];
}

function Dialog({ target, onClose }: { target: HostFolderSharingTarget; onClose: () => void }) {
  const catalog = useHostCatalog(session);
  return <HostFolderSharingDialog target={target} catalog={catalog} onClose={onClose} />;
}

async function render(target: HostFolderSharingTarget, bridge: Record<string, unknown>, sandbox: "seatbelt" | null = "seatbelt") {
  installDesktopBridge({
    listHostDevices: async () => ({ devices: catalogWith(["folder.read"]) }),
    getHostStatus: async () => ({ state: "online", deviceId: THIS, paused: false, activeRequests: 0, watching: 0, sandbox,
      folders: [{ folderId: FOLDER, name: "notes", writable: true }] }),
    onHostStatus: () => () => {},
    ...bridge,
  } as never);
  const onClose = vi.fn();
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(withTestLocalization(<Dialog target={target} onClose={onClose} />)));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  return { onClose };
}

const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("button")]
  .find((item) => item.textContent === label) ?? null;
const radio = (label: string) => [...document.querySelectorAll("label.host-sharing-option")]
  .find((item) => item.textContent?.startsWith(label))?.querySelector("input") ?? null;
const toggle = (label: string) => document.querySelector<HTMLInputElement>(`.host-sharing-switches input[aria-label="${label}"]`);

describe("opening a folder on the owner's other computers", () => {
  it("shares view-only unless editing is chosen, and closes once the App has shared it", async () => {
    const registerHostFolder = vi.fn(async () => ({ deviceId: THIS, folderId: FOLDER }));
    const { onClose } = await render({ kind: "share", rootPath: "/Users/me/notes", name: "notes" }, { registerHostFolder });
    expect(radio("View only")?.checked).toBe(true);
    await act(async () => { radio("View and edit")?.click(); });
    await act(async () => { button("Make available")?.click(); });
    expect(registerHostFolder).toHaveBeenCalledWith({ rootPath: "/Users/me/notes", writable: true, expectedSession });
    expect(onClose).toHaveBeenCalled();
  });

  it("stays open when the person declines in the App's own question", async () => {
    const { onClose } = await render({ kind: "share", rootPath: "/Users/me/notes", name: "notes" },
      { registerHostFolder: async () => ({ cancelled: true }) });
    await act(async () => { button("Make available")?.click(); });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("changing what other computers may do with a shared folder", () => {
  const target: HostFolderSharingTarget = { kind: "settings", folderId: FOLDER, name: "notes", rootPath: "/Users/me/notes" };

  it("makes it view-only at the folder's current revision", async () => {
    const updateHostFolder = vi.fn(async () => ({ id: FOLDER, revision: 8 }));
    await render(target, { listHostDevices: async () => ({ devices: catalogWith(["folder.read", "folder.write"]) }), updateHostFolder });
    expect(radio("View and edit")?.checked).toBe(true);
    await act(async () => { radio("View only")?.click(); });
    expect(updateHostFolder).toHaveBeenCalledWith({ deviceId: THIS, folderId: FOLDER, name: "notes", writable: false,
      expectedRevision: 7, expectedSession });
  });

  it("allows one kind of run at a time and keeps the others as they are", async () => {
    const setHostExecution = vi.fn(async () => ({ id: FOLDER, revision: 8 }));
    await render(target, { listHostDevices: async () => ({ devices: catalogWith(["folder.read", "folder.write", "folder.git"]) }),
      setHostExecution });
    await act(async () => { toggle("Terminal")?.click(); });
    expect(setHostExecution).toHaveBeenCalledWith({ deviceId: THIS, folderId: FOLDER, terminal: true, git: true, agent: false,
      expectedRevision: 7, expectedSession });
  });

  it("offers no runs on a view-only folder, and none at all without a sandbox", async () => {
    await render(target, {});
    expect(toggle("Terminal")).toBeNull();
    act(() => root?.unmount());
    root = null;
    await render(target, { listHostDevices: async () => ({ devices: catalogWith(["folder.read", "folder.write"]) }) }, null);
    expect(toggle("Terminal")?.disabled).toBe(true);
  });

  it("stops sharing through the App and closes", async () => {
    const removeHostFolder = vi.fn(async () => ({ removed: true }));
    const { onClose } = await render(target, { removeHostFolder });
    await act(async () => { button("Stop sharing")?.click(); });
    expect(removeHostFolder).toHaveBeenCalledWith({ deviceId: THIS, folderId: FOLDER, expectedSession });
    expect(onClose).toHaveBeenCalled();
  });
});

describe("all my devices, in the folder's place menu", () => {
  const studio: HostCatalogDevice = { id: "22222222-2222-4222-8222-222222222222", name: "Studio Mac", platform: "darwin",
    state: "active", revision: 1, online: true, last_seen_at: null, folders: [] };
  const office: HostCatalogDevice = { ...studio, id: "33333333-3333-4333-8333-333333333333", name: "Office PC" };
  function Place({ recorded }: { recorded: string | null }) {
    const [dismissed, setDismissed] = useState(0);
    // Its own folder: this App remembers what it shared and stopped sharing above.
    const place = useHostFolderPlace({ enabled: true, session: session as never, rootPath: "/Users/me/place",
      recordedFolderId: recorded, name: "notes" });
    return <>
      <div data-dismissed={dismissed}>
        <ProjectAudienceRows audience={{ devices: place.devices }} onDismiss={() => setDismissed((count) => count + 1)} />
      </div>
      {place.dialog}
    </>;
  }

  async function renderPlace(recorded: string | null, bridge: Record<string, unknown> = {}) {
    installDesktopBridge({
      listHostDevices: async () => ({ devices: [...catalogWith(["folder.read", "folder.write"]), studio, office] }),
      getHostStatus: async () => ({ state: "online", deviceId: THIS, paused: false, activeRequests: 0, watching: 0,
        folders: recorded ? [{ folderId: FOLDER, name: "notes", writable: true }] : [] }),
      onHostStatus: () => () => {},
      ...bridge,
    } as never);
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root?.render(withTestLocalization(<Place recorded={recorded} />)));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    return host;
  }
  const devicesRow = (host: HTMLElement) => [...host.querySelectorAll<HTMLButtonElement>(".project-audience-tier")]
    .find((row) => row.textContent?.includes("All my devices"))!;

  it("turns a folder that is not shared yet on through the sharing dialog", async () => {
    const host = await renderPlace(null);
    const row = devicesRow(host);
    expect(row.getAttribute("aria-checked")).toBe("false");
    expect(row.textContent).toContain("Turn on");
    await act(async () => { row.click(); });
    expect(host.querySelector("[data-dismissed]")?.getAttribute("data-dismissed")).toBe("1");
    expect(button("Make available")).not.toBeNull();
  });

  it("names the other computers that can open a shared folder, and changes how in the same dialog", async () => {
    const host = await renderPlace(FOLDER);
    expect(devicesRow(host).getAttribute("aria-checked")).toBe("true");
    const who = host.querySelector<HTMLButtonElement>(".project-audience-detail")!;
    expect(who.textContent).toBe("Studio Mac and 1 other");
    await act(async () => { who.click(); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(button("Stop sharing")).not.toBeNull();
  });

  it("stops sharing from its own row after Main asks, and changes nothing when that is declined", async () => {
    const removeHostFolder = vi.fn(async () => ({ cancelled: true as const }));
    const host = await renderPlace(FOLDER, { removeHostFolder });
    expect(devicesRow(host).textContent).toContain("Stop");
    await act(async () => { devicesRow(host).click(); await Promise.resolve(); });
    expect(removeHostFolder).toHaveBeenCalledExactlyOnceWith({ deviceId: THIS, folderId: FOLDER, expectedSession });
    expect(devicesRow(host).getAttribute("aria-checked")).toBe("true");
  });

  it("unticks All my devices once stopping is done", async () => {
    const removeHostFolder = vi.fn(async () => ({ removed: true }));
    const host = await renderPlace(FOLDER, { removeHostFolder });
    await act(async () => { devicesRow(host).click(); await Promise.resolve(); });
    expect(devicesRow(host).getAttribute("aria-checked")).toBe("false");
    expect(devicesRow(host).textContent).toContain("Turn on");
    await act(async () => rememberSharedFolder("/Users/me/place", FOLDER));
  });

  it("opens the folder's sharing settings when stopping fails, to try again there", async () => {
    const removeHostFolder = vi.fn(async () => { throw new Error("denied"); });
    const host = await renderPlace(FOLDER, { removeHostFolder });
    await act(async () => { devicesRow(host).click(); await Promise.resolve(); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(devicesRow(host).getAttribute("aria-checked")).toBe("true");
    expect(button("Stop sharing")).not.toBeNull();
  });
});
