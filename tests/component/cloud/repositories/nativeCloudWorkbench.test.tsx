/** @vitest-environment happy-dom */
import { act, useEffect, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesktopWorkspaceLocationSurface } from "../../../../src/features/app-shell/DesktopWorkspaceLocationSurface";
import { DesktopProjectLocationControls } from "../../../../src/features/app-shell/DesktopWorkspaceSwitcher";
import { useNativeCloudWorkbench, type NativeCloudWorkbench } from "../../../../src/features/cloud/workbench/useNativeCloudWorkbench";
import type { DesktopCloudSession } from "../../../../src/lib/cloudApi";
import { withTestLocalization } from "../../../support/react/localization";

vi.mock("../../../../src/platform/useDesktopPlatformCapabilities", () => ({ useDesktopPlatformCapabilities: () => ({ platform: "macos" }) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const API = "https://cloud-fixture.puppyone.ai/api/v1";
const session: DesktopCloudSession = { api_base_url: API, user_id: "owner", user_email: "owner@example.com",
  session_generation: "first", expires_in: 3600, expires_at: Date.now() + 3_600_000, status: "authenticated" };
const context = { status: "resolved" as const, projectId: "project", projectName: "Shared project",
  target: { kind: "project_root" as const, project_id: "project" }, capabilities: ["content.read", "content.write"] };
let root: Root | null = null;
let mounted = 0;
let cloud: NativeCloudWorkbench;
let bridge: ReturnType<typeof vi.fn>;

function LocalEditor() {
  const [text, setText] = useState("Local original");
  useEffect(() => { mounted++; }, []);
  return <input aria-label="local readme.md" value={text} onInput={(event) => setText(event.currentTarget.value)} />;
}
function Harness({ linked = true, currentSession = session, localIdentity = "local-project" }: {
  linked?: boolean; currentSession?: DesktopCloudSession | null; localIdentity?: string;
}) {
  const [location, setLocation] = useState<"local" | "cloud">("local");
  cloud = useNativeCloudWorkbench({ context: linked ? context : { status: "local-only", projectId: null },
    session: currentSession, apiBaseUrl: API, localWorkspaceIdentity: localIdentity, active: location === "cloud",
    filesVisibilitySettings: { showHiddenFiles: true, excludePatterns: [] } });
  return <>
    <DesktopProjectLocationControls projectLocation={{ current: location, localAvailable: true, cloudState: linked ? "available" : "unavailable" }}
      onViewLocal={() => setLocation("local")} onViewCloud={() => setLocation("cloud")} />
    <DesktopWorkspaceLocationSurface location={location} local={<LocalEditor />}
      nativeCloud={cloud.dataPort && cloud.visited ? <div data-cloud-storage={cloud.dataPort.documentPersistence?.storageIdentity}>{cloud.editorWorkbench.state.editors.map((editor) => <span key={editor.id}>{editor.label}</span>)}</div> : null}
      cloudServices={{ sidebar: <nav>Cloud setup</nav>, main: <button>Create Cloud version</button> }} />
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
afterEach(() => { act(() => root?.unmount()); root = null; document.body.innerHTML = ""; window.localStorage.clear(); vi.restoreAllMocks(); mounted = 0; });

function installBridge() {
  bridge = vi.fn(async (request) => {
    const path = new URL(request.path, API).searchParams.get("path");
    if (request.path.includes("/stat")) return { exists: true, type: "markdown", path, name: "readme.md" };
    if (request.path.includes("/cat")) return { content_text: "Cloud original", head_commit_id: "cloud-head" };
    return { entries: [{ type: "markdown", name: "readme.md", path: "readme.md" }], head_commit_id: "cloud-head" };
  });
  window.puppyoneDesktop = { requestCloudSessionApi: bridge } as unknown as NonNullable<typeof window.puppyoneDesktop>;
}

describe("native Cloud workbench switching", () => {
  it("switches the main surface without a dialog and restores the exact local editor host and draft", async () => {
    installBridge(); await render(<Harness />);
    const local = document.querySelector<HTMLInputElement>('input[aria-label="local readme.md"]')!;
    // Native text inputs retain their DOM working state while the provider is hidden.
    act(() => { local.value = "Local unsaved draft"; local.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(bridge).not.toHaveBeenCalled();
    await click("Cloud");
    expect(surface("local").hidden).toBe(true); expect(surface("cloud").hidden).toBe(false);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.querySelector('button[data-project-location="cloud"]')?.getAttribute("aria-pressed")).toBe("true");
    const [node] = await cloud.dataPort!.listChildren(null);
    await act(async () => { await cloud.onActivePathChange(node!.path, node); });
    expect(cloud.editorWorkbench.activePath).toBe(node!.path);
    expect((await cloud.dataPort!.readFile!(node!.path)).content).toBe("Cloud original");
    const cloudHost = document.querySelector('[data-cloud-storage]');
    await click("This Mac");
    expect(surface("local").hidden).toBe(false); expect(surface("cloud").hidden).toBe(true);
    expect(document.querySelector('input[aria-label="local readme.md"]')).toBe(local);
    expect(local.value).toBe("Local unsaved draft"); expect(mounted).toBe(1);
    await click("Cloud");
    expect(document.querySelector('[data-cloud-storage]')).toBe(cloudHost);
    expect(cloud.editorWorkbench.activePath).toBe(node!.path);
  });

  it("offers creation inline for an unhosted project without starting a publication automatically", async () => {
    installBridge(); await render(<Harness linked={false} />); await click("Create Cloud");
    expect(surface("cloud").querySelector("main")?.textContent).toBe("Create Cloud version");
    expect(surface("local").hidden).toBe(true);
    expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(bridge).not.toHaveBeenCalled();
  });

  it("changes the storage namespace on account change and revokes the previous provider", async () => {
    installBridge(); await render(<Harness />); await click("Cloud");
    const previousPort = cloud.dataPort!; const previousId = cloud.service!.workspace.id;
    await render(<Harness currentSession={{ ...session, user_id: "another-account", session_generation: "second" }} />);
    expect(cloud.service!.workspace.id).not.toBe(previousId);
    await expect(previousPort.listChildren(null)).rejects.toThrow(/session changed/);
  });

  it("separates editor tabs across repository changes", async () => {
    installBridge(); await render(<Harness />); await click("Cloud");
    const [node] = await cloud.dataPort!.listChildren(null);
    await act(async () => { await cloud.onActivePathChange(node!.path, node); });
    expect(cloud.editorWorkbench.state.editors).toHaveLength(1);
    await render(<Harness currentSession={null} />);
    expect(cloud.dataPort).toBeNull(); expect(cloud.editorWorkbench.state.editors).toHaveLength(0);
    expect(surface("cloud").querySelector('[data-cloud-storage]')).toBeNull();
  });
});
