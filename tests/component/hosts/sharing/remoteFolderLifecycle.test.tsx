/** @vitest-environment happy-dom */
import React, { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DataPort } from "@puppyone/shared-ui";
import { createDeviceDataService } from "../../../../src/features/hosts/data/deviceDataPort";
import { createPendingCloudDataService } from "../../../../src/features/cloud/workbench/pendingCloudDataService";
import { useRemoteFolderWorkbench, type RemoteFolderService } from "../../../../src/features/remote-workbench";
import { DEFAULT_FILES_VISIBILITY_SETTINGS } from "../../../../src/preferences";
import { initializeDesktopPreferences } from "../../../../src/preferencesStore";
import type { DesktopCloudSession } from "../../../../src/lib/cloudApi";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const ref = { deployment: "https://qubits-api.puppyone.ai/api/v1",
  accountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", deviceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  folderId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" };
const pendingService = createPendingCloudDataService(null, "Notes");
const requestHostFolder = vi.fn(async () => ({ ok: true, result: { entries: [
  { name: "note.md", kind: "file", size: 4, modified_ns: "1" },
] } }));
let root: Root;
let container: HTMLDivElement;
let workbench: ReturnType<typeof useRemoteFolderWorkbench<RemoteFolderService>>;

function Directory({ dataPort }: { dataPort: DataPort | null }) {
  const [listing, setListing] = useState("loading");
  useEffect(() => {
    let current = true;
    void (async () => {
      try {
        const nodes = await dataPort?.listChildren(null);
        if (current) setListing(nodes?.map(node => node.name).join(",") ?? "unavailable");
      } catch (error) { if (current) setListing(error instanceof Error ? error.message : String(error)); }
    })();
    return () => { current = false; };
  }, [dataPort]);
  return <output>{listing}</output>;
}

function Harness({ generation = "first" }: { generation?: string }) {
  const session = { user_id: ref.accountId, api_base_url: ref.deployment,
    session_generation: generation } as DesktopCloudSession;
  workbench = useRemoteFolderWorkbench<RemoteFolderService>({ serviceKey: generation,
    createService: isCurrent => createDeviceDataService({ ref, name: "Notes", writable: false,
      session, apiBase: ref.deployment, isCurrent }), pendingService, active: true,
    filesVisibilitySettings: DEFAULT_FILES_VISIBILITY_SETTINGS });
  return <Directory dataPort={workbench.dataPort} />;
}

beforeEach(() => {
  localStorage.clear(); initializeDesktopPreferences(); requestHostFolder.mockClear();
  Object.assign(window, { puppyoneDesktop: { requestHostFolder } });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount()); container.remove(); localStorage.clear();
  delete (window as unknown as { puppyoneDesktop?: unknown }).puppyoneDesktop;
});

async function render(generation = "first") {
  await act(async () => root.render(withTestLocalization(<React.StrictMode><Harness generation={generation} /></React.StrictMode>)));
}

describe("remote folder admission lifecycle", () => {
  it("loads the initial directory under StrictMode's effect replay", async () => {
    await render();
    expect(container.textContent).toBe("note.md");
  });

  it("keeps the current folder usable after rerenders while rejecting old and unmounted sessions", async () => {
    await render();
    const previous = workbench.dataPort!;
    await render();
    await expect(previous.listChildren(null)).resolves.toHaveLength(1);
    await render("second");
    await expect(Promise.resolve().then(() => previous.listChildren(null))).rejects.toThrow("session changed");
    expect(container.textContent).toBe("note.md");
    const current = workbench.dataPort!;
    await act(async () => root.render(null));
    await expect(Promise.resolve().then(() => current.listChildren(null))).rejects.toThrow("session changed");
  });
});
