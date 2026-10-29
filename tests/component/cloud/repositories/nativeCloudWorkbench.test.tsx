import { workspaceFixtureBridge, fixtureWorkspaceWatch, fileVersion, liveEntry, liveWorkbench } from "../../../fixtures/cloud/repositories/liveWorkspace";
import { nativeSnapshot } from "../../../fixtures/cloud/repositories/nativeRepository";
/** @vitest-environment happy-dom */
import { act, useEffect, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DesktopWorkspaceLocationSurface } from "../../../../src/features/app-shell/DesktopWorkspaceLocationSurface";
import { DesktopCloudShell } from "../../../../src/components/DesktopCloudShell";
import { useNativeCloudWorkbench, type NativeCloudWorkbench } from "../../../../src/features/cloud/workbench/useNativeCloudWorkbench";
import { cloudCache } from "../../../../src/features/cloud/cache/cloudCache";
import type { DesktopCloudSession } from "../../../../src/lib/cloudApi";
import { withTestLocalization } from "../../../support/react/localization";
import { workspaceContentChangeMatchesResource } from "@puppyone/shared-ui";
import { captureCloudWorkspaceShareResource } from "../../../../src/features/cloud/share/cloudWorkspaceShareResource";

vi.mock("../../../../src/platform/useDesktopPlatformCapabilities", () => ({ useDesktopPlatformCapabilities: () => ({ platform: "macos", windowChrome: { mode: "overlay" } }) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const API = "https://cloud-fixture.puppyone.ai/api/v1";
const session: DesktopCloudSession = { api_base_url: API, user_id: "owner", user_email: "owner@example.com",
  session_generation: "first", expires_in: 3600, expires_at: Date.now() + 3_600_000, status: "authenticated" };
const context = { status: "resolved" as const, projectId: "project", projectName: "Shared project",
  target: { kind: "project_root" as const, project_id: "project" }, capabilities: ["content.read", "content.write"] };
let root: Root | null = null;
let mounted = 0;
let cloud: NativeCloudWorkbench;
let bridge: ReturnType<typeof vi.fn<(request: any) => unknown>>;

function LocalEditor() {
  const [text, setText] = useState("Local original");
  useEffect(() => { mounted++; }, []);
  return <input aria-label="local readme.md" value={text} onInput={(event) => setText(event.currentTarget.value)} />;
}
// The window shows a local folder, or a Cloud project opened as its own
// project in the retained shell (puppy-issues ADR-001). The Cloud project is
// committed for one folder identity and account; anything else returns home.
function Harness({ currentSession = session, localIdentity = "local-project", enabled = true }: {
  currentSession?: DesktopCloudSession | null; localIdentity?: string; enabled?: boolean;
}) {
  const [selection, setSelection] = useState<{ scope: string; account: string } | null>(null);
  const active = enabled && selection?.scope === localIdentity && currentSession !== null && selection.account === currentSession.user_id;
  const location = active ? "cloud" : "local";
  useEffect(() => { if (selection && !active) setSelection(null); }, [active, selection]);
  cloud = useNativeCloudWorkbench({ context, session: currentSession, apiBaseUrl: API, active,
    filesVisibilitySettings: { showHiddenFiles: true, excludePatterns: [] } });
  return <>
    <button type="button" onClick={() => { if (currentSession) setSelection({ scope: localIdentity, account: currentSession.user_id }); }}>
      Open Cloud project</button>
    <button type="button" onClick={() => setSelection(null)}>Open folder</button>
    <DesktopWorkspaceLocationSurface location={location} local={<LocalEditor />}
      cloud={cloud.dataPort && cloud.visited ? <div data-cloud-storage={cloud.dataPort.documentPersistence?.storageIdentity}>{cloud.editorWorkbench.state.editors.map((editor) => <span key={editor.id}>{editor.label}</span>)}</div> : null} />
  </>;
}

const render = async (content: ReactNode) => {
  if (!root) { const container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); }
  await act(async () => { root!.render(withTestLocalization(content)); });
};
const click = async (label: string) => {
  const button = [...document.querySelectorAll("button")].find((item) => item.textContent?.trim() === label)!;
  expect(button).toBeTruthy();
  await act(async () => { button.click(); });
};
const surface = (name: string) => document.querySelector<HTMLElement>(`[data-workspace-location="${name}"]`)!;
beforeEach(() => cloudCache.clear());
afterEach(() => { act(() => root?.unmount()); root = null; document.body.innerHTML = ""; window.localStorage.clear(); vi.restoreAllMocks(); mounted = 0; });

function installBridge() {
  bridge = vi.fn(async (request) => {
    const path = new URL(request.path, API).searchParams.get("path");
    if (request.path.includes("/stat")) return { exists: true, type: "markdown", path, name: "readme.md", ...nativeSnapshot("cloud-head") };
    if (request.path.includes("/file?")) return { path, type: "markdown", content_text: "Cloud original", ...nativeSnapshot("cloud-head") };
    return { entries: [{ type: "markdown", name: "readme.md", path: "readme.md" }], ...nativeSnapshot("cloud-head") };
  });
  window.puppyoneDesktop = { requestCloudSessionApi: workspaceFixtureBridge(bridge), ...fixtureWorkspaceWatch() } as unknown as NonNullable<typeof window.puppyoneDesktop>;
}

describe("native Cloud workbench for a Cloud project opened beside a local folder", () => {
  it("shares the active tab after a folder selection and the root after closing the last tab", async () => {
    installBridge(); await render(<Harness />); await click("Open Cloud project");
    const [node] = await cloud.dataPort!.listChildren(null);
    await act(async () => cloud.onActivePathChange(node!.path, node));
    await act(async () => cloud.setActiveNode({ id: "folder", name: "notes", path: "notes", type: "folder" }));
    expect(captureCloudWorkspaceShareResource(cloud)?.path).toBe("notes");
    await act(async () => cloud.editorWorkbench.activate(cloud.editorWorkbench.activeEditorId!));
    expect(captureCloudWorkspaceShareResource(cloud)?.path).toBe("readme.md");
    await act(async () => cloud.onActivePathChange("other.md", { id: "other", path: "other.md", name: "other.md", type: "markdown" }));
    expect(captureCloudWorkspaceShareResource(cloud)?.path).toBe("other.md");
    await act(async () => cloud.setActiveNode({ id: "folder", name: "notes", path: "notes", type: "folder" }));
    const first = cloud.editorWorkbench.state.editors.find(editor => editor.resource === node!.path)!;
    await act(async () => cloud.editorWorkbench.activate(first.id));
    expect(captureCloudWorkspaceShareResource(cloud)?.path).toBe("readme.md");
    await act(async () => cloud.editorWorkbench.clear());
    expect(captureCloudWorkspaceShareResource(cloud)).toMatchObject({ path: "", directory: true });
  });
  it("notifies opened Cloud documents after publication using an owned root", async () => {
    installBridge(); await render(<Harness />); await click("Open Cloud project");
    const [node] = await cloud.dataPort!.listChildren(null);
    const before = cloud.refreshToken.sequence;
    await act(async () => cloud.refresh());
    expect(workspaceContentChangeMatchesResource(cloud.refreshToken, node!.path, before)).toBe(true);
    expect(workspaceContentChangeMatchesResource(cloud.refreshToken, "puppyone-workspace://different-root/readme.md", before)).toBe(false);
  });
  it("refreshes from native file events without focus polling or Git publication", async () => {
    installBridge();
    let listener!: (event: {id: string; type: "change"; generation: string}) => void;
    let subscription!: {id: string; generation: string};
    window.puppyoneDesktop!.onCloudWorkspaceEvent = callback => { listener = callback; return () => {}; };
    window.puppyoneDesktop!.watchCloudWorkspace = async input => { subscription = input; return { id: input.id }; };
    await render(<Harness />); await click("Open Cloud project");
    const initial = cloud.refreshToken.sequence;
    await act(async () => listener({ ...subscription, type: "change" }));
    expect(cloud.refreshToken.sequence).toBe(initial + 1);
    await click("Open folder");
    await act(async () => listener({ ...subscription, type: "change" }));
    expect(cloud.refreshToken.sequence).toBe(initial + 1);
  });

  it("does not let a slow path lookup replace the user's newer file selection", async () => {
    installBridge(); await render(<Harness />); await click("Open Cloud project");
    const [node] = await cloud.dataPort!.listChildren(null);
    cloud.service!.invalidateReads();
    let finish!: (value: unknown) => void;
    bridge.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    let pending!: Promise<void>;
    await act(async () => { pending = cloud.onActivePathChange("slow.md"); });
    await act(async () => cloud.onActivePathChange(node!.path, node));
    await act(async () => { finish({ entries: [liveEntry("slow.md", "slow")] }); await pending; });
    expect(cloud.editorWorkbench.activePath).toBe(node!.path);
  });

  it("shows committed content without an arrival cover and retains Header and drafts", async () => {
    const shell = (location: "local" | "cloud", active = true) => <DesktopCloudShell workspaceLocation={location} active={active}>
      <input aria-label="Retained content" defaultValue="Unsaved draft" />
    </DesktopCloudShell>;
    await render(shell("local"));
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Retained content"]')!;
    input.value = "Local draft";
    await render(shell("cloud"));
    expect(document.querySelector(".desktop-titlebar")?.getAttribute("data-workspace-kind")).toBe("cloud");
    expect(document.querySelector(".desktop-shell")?.getAttribute("data-workspace-kind")).toBe("cloud");
    const reveal = document.querySelector(".desktop-cloud-header-reveal");
    expect(reveal).not.toBeNull();
    for (const [location, active] of [["cloud", true], ["cloud", true], ["cloud", false]] as const) {
      await render(shell(location, active));
      expect(document.querySelector(".desktop-cloud-header-reveal")).toBe(reveal);
      expect(document.querySelector(".desktop-cloud-entry-light, .desktop-cloud-entry-sweep")).toBeNull();
      expect(document.querySelector('input[aria-label="Retained content"]')).toBe(input);
      expect(input.value).toBe("Local draft");
    }
    await render(shell("local"));
    expect(document.querySelector(".desktop-cloud-header-reveal")).toBeNull();
    expect(document.querySelector(".desktop-titlebar")?.getAttribute("data-workspace-kind")).toBeNull();
    await render(shell("cloud"));
    expect(document.querySelector(".desktop-cloud-header-reveal")).not.toBe(reveal);
    expect(document.querySelector(".desktop-cloud-entry-light, .desktop-cloud-entry-sweep")).toBeNull();
    expect(input.value).toBe("Local draft");
  });

  it("shows the Cloud project without a dialog and restores the exact local editor host and draft", async () => {
    installBridge(); await render(<Harness />);
    const local = document.querySelector<HTMLInputElement>('input[aria-label="local readme.md"]')!;
    // Native text inputs retain their DOM working state while the provider is hidden.
    act(() => { local.value = "Local unsaved draft"; local.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(bridge).not.toHaveBeenCalled();
    await click("Open Cloud project");
    expect(surface("local").hidden).toBe(true); expect(surface("cloud").hidden).toBe(false);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    const [node] = await cloud.dataPort!.listChildren(null);
    await act(async () => { await cloud.onActivePathChange(node!.path, node); });
    expect(cloud.editorWorkbench.activePath).toBe(node!.path);
    expect((await cloud.dataPort!.readFile!(node!.path)).content).toBe("Cloud original");
    const cloudHost = document.querySelector('[data-cloud-storage]');
    await click("Open folder");
    expect(surface("local").hidden).toBe(false); expect(surface("cloud").hidden).toBe(true);
    expect(document.querySelector('input[aria-label="local readme.md"]')).toBe(local);
    expect(local.value).toBe("Local unsaved draft"); expect(mounted).toBe(1);
    await click("Open Cloud project");
    expect(document.querySelector('[data-cloud-storage]')).toBe(cloudHost);
    expect(cloud.editorWorkbench.activePath).toBe(node!.path);
  });

  it("changes the storage namespace on account change and revokes the previous provider", async () => {
    installBridge(); await render(<Harness />); await click("Open Cloud project");
    const previousPort = cloud.dataPort!; const previousId = cloud.service!.workspace.id;
    await render(<Harness currentSession={{ ...session, user_id: "another-account", session_generation: "second" }} />);
    expect(cloud.service!.workspace.id).not.toBe(previousId);
    expect(surface("local").hidden).toBe(false);
    await expect(previousPort.listChildren(null)).rejects.toThrow(/session changed/);
  });

  it("separates editor tabs across repository changes", async () => {
    installBridge(); await render(<Harness />); await click("Open Cloud project");
    const [node] = await cloud.dataPort!.listChildren(null);
    await act(async () => { await cloud.onActivePathChange(node!.path, node); });
    expect(cloud.editorWorkbench.state.editors).toHaveLength(1);
    await render(<Harness currentSession={null} />);
    expect(cloud.dataPort).toBeNull(); expect(cloud.editorWorkbench.state.editors).toHaveLength(0);
    expect(surface("cloud").querySelector('[data-cloud-storage]')).toBeNull();
    expect(surface("local").hidden).toBe(false);
    expect(cloud.surfaceService.workspace.id).not.toBe(cloud.service?.workspace.id);
    await render(<Harness />);
    expect(surface("local").hidden).toBe(false);
    expect(cloud.surfaceService.folder.capabilities.execute).toBe(false);
  });
});
