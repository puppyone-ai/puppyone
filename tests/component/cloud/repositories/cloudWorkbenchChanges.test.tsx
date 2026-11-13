/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkspaceResourceUri } from "@puppyone/shared-ui";
import { createCloudDataService } from "../../../../src/features/cloud/files/cloudDataPort";
import { createPendingCloudDataService } from "../../../../src/features/cloud/workbench/pendingCloudDataService";
import { useRemoteFolderWorkbench, type RemoteFolderService } from "../../../../src/features/remote-workbench";
import type { DesktopCloudSession } from "../../../../src/lib/cloudApi";
import { DEFAULT_FILES_VISIBILITY_SETTINGS } from "../../../../src/preferences";
import { initializeDesktopPreferences } from "../../../../src/preferencesStore";
import { installLiveWorkspaceBridge, type LiveWorkspaceBridge } from "../../../support/cloud/liveWorkspaceBridge";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const apiBaseUrl = "https://cloud-fixture.puppyone.ai/api/v1";
const session: DesktopCloudSession = { api_base_url: apiBaseUrl, user_id: "owner", user_email: "owner@example.com",
  session_generation: "one", expires_at: Date.now() + 3600000, expires_in: 3600, status: "authenticated" };
const context = { status: "resolved" as const, projectId: "project", projectName: "Project",
  target: { kind: "project_root" as const, project_id: "project" }, capabilities: ["content.read", "content.write"] };
const pendingService = createPendingCloudDataService(apiBaseUrl, "Project");

let live: LiveWorkspaceBridge;
let root: Root;
let container: HTMLDivElement;
let workbench: ReturnType<typeof useRemoteFolderWorkbench<RemoteFolderService>>;
let invalidateReads: ReturnType<typeof vi.fn<() => void>>;

function Harness() {
  workbench = useRemoteFolderWorkbench<RemoteFolderService>({ serviceKey: "cloud",
    createService: (isCurrent) => {
      const service = createCloudDataService({ session, context, apiBaseUrl, isCurrent });
      invalidateReads = vi.fn<() => void>(service.invalidateReads);
      return { ...service, invalidateReads };
    },
    pendingService, active: true, filesVisibilitySettings: DEFAULT_FILES_VISIBILITY_SETTINGS });
  return null;
}

beforeEach(async () => {
  localStorage.clear(); initializeDesktopPreferences();
  live = installLiveWorkspaceBridge({ "readme.md": "hello", "docs/guide.md": "guide" });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(withTestLocalization(<Harness />)));
  await vi.waitFor(() => expect(live.subscribed()).toBeTruthy());
});
afterEach(() => { act(() => root.unmount()); container.remove(); localStorage.clear(); vi.useRealTimers(); });

const entries = () => workbench.refreshToken.entries.map(({ rootUri, paths }) => ({ rootUri, paths }));
const folderUri = () => workbench.service!.folder.uri;

describe("Cloud workbench change routing", () => {
  it("records the paths a workspace change names, and an unnamed change as unscoped", async () => {
    await act(async () => live.emit({ type: "change", paths: ["docs/guide.md", "readme.md"] }));
    await act(async () => live.emit({ type: "change" }));
    expect(entries()).toEqual([
      { rootUri: folderUri(), paths: ["docs/guide.md", "readme.md"] },
      { rootUri: folderUri(), paths: null },
    ]);
  });

  it("refreshes only the resources an own action names, without dropping other caches", async () => {
    const created = createWorkspaceResourceUri(folderUri(), "docs/new.md");
    await act(async () => workbench.refresh([created]));
    expect(entries()).toEqual([{ rootUri: folderUri(), paths: ["docs/new.md"] }]);
    expect(invalidateReads).not.toHaveBeenCalled();
  });

  it("treats a refresh without resources, or bound to a button event, as unscoped", async () => {
    await act(async () => workbench.refresh());
    await act(async () => (workbench.refresh as (value: unknown) => void)({ type: "click" }));
    expect(entries()).toEqual([{ rootUri: folderUri(), paths: null }, { rootUri: folderUri(), paths: null }]);
    expect(invalidateReads).toHaveBeenCalledTimes(2);
  });

  it("records a file created from the Explorer as that one resource", async () => {
    await act(async () => workbench.actions.openCreateEntryMenu("docs", { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }));
    await act(async () => workbench.actions.createEntry("markdown"));
    const created = [...live.files.keys()].find((path) => path.startsWith("docs/") && path !== "docs/guide.md");
    expect(created).toBeTruthy();
    expect(entries()).toEqual([{ rootUri: folderUri(), paths: [created] }]);
    expect(invalidateReads).not.toHaveBeenCalled();
  });

  it("records both paths of an Explorer rename and every deleted resource", async () => {
    const guide = (await workbench.dataPort!.listChildren(createWorkspaceResourceUri(folderUri(), "docs")))
      .find((node) => node.name === "guide.md")!;
    const anchor = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 } as DOMRect;
    await act(async () => workbench.actions.openNodeActionMenu(guide, anchor));
    await act(async () => workbench.actions.setNodeActionMenu((menu) => menu && { ...menu, renameNameValue: "manual" }));
    await act(async () => workbench.actions.renameNodeFromMenu());
    expect(live.files.get("docs/manual.md")).toBe("guide");
    expect(entries()).toEqual([{ rootUri: folderUri(), paths: ["docs/guide.md", "docs/manual.md"] }]);

    const readme = (await workbench.dataPort!.listChildren(null)).find((node) => node.name === "readme.md")!;
    Object.assign(window, { confirm: vi.fn(() => true) });
    await act(async () => workbench.actions.openNodeActionMenu(readme, anchor));
    await act(async () => workbench.actions.deleteNodeFromMenu());
    expect(live.files.has("readme.md")).toBe(false);
    expect(entries().at(-1)).toEqual({ rootUri: folderUri(), paths: ["readme.md"] });
    expect(invalidateReads).not.toHaveBeenCalled();
  });

  it("settles history-like views once file activity has been quiet for two seconds", async () => {
    vi.useFakeTimers();
    expect(workbench.contentSettledKey).toBe("0");
    for (let index = 0; index < 5; index++) {
      await act(async () => { live.emit({ type: "change", paths: ["readme.md"] }); await vi.advanceTimersByTimeAsync(500); });
    }
    expect(workbench.contentSettledKey).toBe("0");
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(workbench.contentSettledKey).toBe(String(workbench.refreshToken.sequence));
  });
});
