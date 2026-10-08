import { nativeSnapshot } from "../../../fixtures/cloud/repositories/nativeRepository";
/** @vitest-environment happy-dom */
import { act, useCallback, useEffect, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DesktopWorkspaceLocationSurface } from "../../../../src/features/app-shell/DesktopWorkspaceLocationSurface";
import { DesktopCloudShell } from "../../../../src/components/DesktopCloudShell";
import { DesktopProjectLocationControls } from "../../../../src/features/app-shell/DesktopProjectLocationSwitcher";
import { useNativeCloudWorkbench, type NativeCloudWorkbench } from "../../../../src/features/cloud/workbench/useNativeCloudWorkbench";
import { useCloudWorkspaceSwitch } from "../../../../src/features/cloud/workbench/useCloudWorkspaceSwitch";
import { CloudWorkspaceSwitchDialog } from "../../../../src/features/cloud/workbench/CloudWorkspaceSwitchDialog";
import { CloudWorkspacePreparation } from "../../../../src/features/cloud/workbench/CloudWorkspacePreparation";
import { cloudCache } from "../../../../src/features/cloud/cache/cloudCache";
import type { DesktopCloudSession } from "../../../../src/lib/cloudApi";
import { withTestLocalization } from "../../../support/react/localization";
import { workspaceContentChangeMatchesResource } from "@puppyone/shared-ui";

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
let bridge: ReturnType<typeof vi.fn>;

function LocalEditor() {
  const [text, setText] = useState("Local original");
  useEffect(() => { mounted++; }, []);
  return <input aria-label="local readme.md" value={text} onInput={(event) => setText(event.currentTarget.value)} />;
}
function Harness({ linked = true, currentSession = session, localIdentity = "local-project", enabled = true, initializationPending = false }: {
  linked?: boolean; currentSession?: DesktopCloudSession | null; localIdentity?: string;
  enabled?: boolean; initializationPending?: boolean;
}) {
  const [selection, setSelection] = useState<{ scope: string; account: string } | null>(null);
  const active = enabled && selection?.scope === localIdentity && currentSession !== null && selection.account === currentSession.user_id;
  const location = active ? "cloud" : "local";
  useEffect(() => { if (selection && !active) setSelection(null); }, [active, selection]);
  cloud = useNativeCloudWorkbench({ context: linked ? context : { status: "local-only", projectId: null },
    session: currentSession, apiBaseUrl: API, active,
    filesVisibilitySettings: { showHiddenFiles: true, excludePatterns: [] } });
  const onCommit = useCallback(() => {
    if (currentSession) setSelection({ scope: localIdentity, account: currentSession.user_id });
  }, [currentSession, localIdentity]);
  const controller = useCloudWorkspaceSwitch({ enabled, scope: localIdentity, session: currentSession,
    service: cloud.service, providerError: cloud.error, initializationPending, onCommit });
  return <>
    <DesktopProjectLocationControls projectLocation={{ current: location, requested: controller.requestedLocation, loading: controller.checking,
      localAvailable: true, cloudState: linked ? "available" : "unavailable" }}
      onViewLocal={() => { controller.cancel(); setSelection(null); }} onViewCloud={controller.request} />
    <DesktopWorkspaceLocationSurface location={location} local={<LocalEditor />}
      preparation={controller.pending && currentSession && linked ? <CloudWorkspacePreparation controller={controller} /> : undefined}
      cloud={cloud.dataPort && cloud.visited ? <div data-cloud-storage={cloud.dataPort.documentPersistence?.storageIdentity}>{cloud.editorWorkbench.state.editors.map((editor) => <span key={editor.id}>{editor.label}</span>)}</div> : null} />
    <CloudWorkspaceSwitchDialog controller={controller} preparingInPlace={Boolean(currentSession && linked)}
      gate={currentSession ? <button>Share to Cloud</button> : <button>Sign in</button>} />
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
    if (request.path.includes("/cat")) return { path, type: "markdown", content_text: "Cloud original", ...nativeSnapshot("cloud-head") };
    return { entries: [{ type: "markdown", name: "readme.md", path: "readme.md" }], ...nativeSnapshot("cloud-head") };
  });
  window.puppyoneDesktop = { requestCloudSessionApi: bridge } as unknown as NonNullable<typeof window.puppyoneDesktop>;
}

describe("native Cloud workbench switching", () => {
  it("notifies opened Cloud documents after publication using an owned root", async () => {
    installBridge(); await render(<Harness />); await click("Cloud");
    const [node] = await cloud.dataPort!.listChildren(null);
    const before = cloud.refreshToken.sequence;
    await act(async () => cloud.refresh());
    expect(workspaceContentChangeMatchesResource(cloud.refreshToken, node!.path, before)).toBe(true);
    expect(workspaceContentChangeMatchesResource(cloud.refreshToken, "puppyone-workspace://different-root/readme.md", before)).toBe(false);
  });
  it("coalesces focus refreshes and never refreshes the hidden Local-to-Cloud surface", async () => {
    let now = Date.now(); vi.spyOn(Date, "now").mockImplementation(() => now);
    installBridge(); await render(<Harness />); await click("Cloud");
    const initial = cloud.refreshToken.sequence;
    await act(async () => { window.dispatchEvent(new Event("focus")); window.dispatchEvent(new Event("focus")); });
    expect(cloud.refreshToken.sequence).toBe(initial);
    now += 30_001;
    await act(async () => { window.dispatchEvent(new Event("focus")); window.dispatchEvent(new Event("focus")); });
    expect(cloud.refreshToken.sequence).toBe(initial + 1);
    await click("This Mac"); now += 30_001;
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(cloud.refreshToken.sequence).toBe(initial + 1);
  });

  it("does not let a slow path lookup replace the user's newer file selection", async () => {
    installBridge(); await render(<Harness />); await click("Cloud");
    let finish!: (value: unknown) => void;
    bridge.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    let pending!: Promise<void>;
    await act(async () => { pending = cloud.onActivePathChange("slow.md"); });
    const [node] = await cloud.dataPort!.listChildren(null);
    await act(async () => cloud.onActivePathChange(node!.path, node));
    await act(async () => { finish({ exists: true, type: "markdown", path: "slow.md", name: "slow.md" }); await pending; });
    expect(cloud.editorWorkbench.activePath).toBe(node!.path);
  });

  it("shows committed content without an arrival cover and retains Header and drafts", async () => {
    const shell = (location: "local" | "cloud", active = true, requested?: "local" | "cloud") => <DesktopCloudShell workspaceLocation={location} requestedWorkspaceLocation={requested} active={active}>
      <input aria-label="Retained content" defaultValue="Unsaved draft" />
    </DesktopCloudShell>;
    await render(shell("local"));
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Retained content"]')!;
    input.value = "Local draft";
    await render(shell("local", true, "cloud"));
    expect(document.querySelector(".desktop-titlebar")?.getAttribute("data-workspace-kind")).toBe("cloud");
    expect(document.querySelector(".desktop-shell")?.getAttribute("data-workspace-kind")).toBeNull();
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
    await render(shell("local", true, "cloud"));
    await render(shell("local"));
    expect(document.querySelector(".desktop-titlebar")?.getAttribute("data-workspace-kind")).toBeNull();
    await render(shell("cloud"));
    expect(document.querySelector(".desktop-cloud-header-reveal")).not.toBe(reveal);
    expect(document.querySelector(".desktop-cloud-entry-light, .desktop-cloud-entry-sweep")).toBeNull();
    expect(input.value).toBe("Local draft");
  });

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

  it("preflights an authenticated linked switch without replacing the Header with a loading dialog", async () => {
    installBridge();
    let release!: (value: unknown) => void;
    const pending = new Promise((resolve) => { release = resolve; });
    let holdRoot = true;
    bridge.mockImplementation((request) => {
      if (holdRoot && request.path.includes("/ls")) { holdRoot = false; return pending; }
      return { entries: [], ...nativeSnapshot("cloud-head") };
    });
    await render(<Harness />);
    await click("Cloud");
    expect(surface("local").hidden).toBe(false);
    expect(document.querySelector('button[data-project-location="cloud"]')?.getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector('button[data-project-location="local"]')?.getAttribute("aria-current")).toBe("true");
    expect(document.querySelector('.desktop-project-location-tabs')?.getAttribute("aria-busy")).toBe("true");
    expect(document.querySelector('.desktop-cloud-preparation')).not.toBeNull();
    expect(document.querySelector('.desktop-cloud-preparation [data-testid="explorer-tree-skeleton"]')).not.toBeNull();
    expect(document.querySelector('.desktop-cloud-preparation [data-puppy-loader="pulse-grid"]')).not.toBeNull();
    expect(document.querySelector('.desktop-cloud-preparation')?.textContent).toBe("");
    expect(surface("local").hasAttribute("inert")).toBe(true);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => { release({ entries: [], ...nativeSnapshot("cloud-head") }); await pending; });
    await vi.waitFor(() => expect(surface("cloud").hidden).toBe(false));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("returns the slider to Local immediately and revokes a pending Cloud response", async () => {
    installBridge();
    let release!: (value: unknown) => void;
    bridge.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    await render(<Harness />);
    const local = document.querySelector('input[aria-label="local readme.md"]');
    await click("Cloud");
    expect(document.querySelector('button[data-project-location="cloud"]')?.getAttribute("aria-pressed")).toBe("true");
    await click("This Mac");
    expect(document.querySelector('button[data-project-location="local"]')?.getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector('.desktop-cloud-preparation')).toBeNull();
    await act(async () => release({ entries: [], ...nativeSnapshot("stale") }));
    expect(surface("cloud").hidden).toBe(true);
    expect(document.querySelector('input[aria-label="local readme.md"]')).toBe(local);
  });

  it("keeps the local workbench while an unhosted project awaits explicit creation", async () => {
    installBridge(); await render(<Harness linked={false} />); await click("Share to Cloud");
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Share to Cloud");
    expect(surface("local").hidden).toBe(false);
    expect(surface("cloud").hidden).toBe(true);
    expect(document.querySelector('[role="dialog"] aside, [role="dialog"] nav')).toBeNull();
    expect(bridge).not.toHaveBeenCalled();
    expect(cloud.surfaceService.folder.capabilities.read).toBe(false);
    expect(await cloud.surfaceService.dataPort.listChildren(null)).toEqual([]);
    expect(cloud.surfaceService.dataPort.documentPersistence).toBeUndefined();
    // Publishing completion prepares the same provider, rather than selecting early.
    await render(<Harness initializationPending />);
    expect(surface("local").hidden).toBe(false);
    expect(bridge).not.toHaveBeenCalled();
    await render(<Harness />);
    expect(surface("cloud").hidden).toBe(false);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("does not switch on a later publication completion after cancellation", async () => {
    installBridge(); await render(<Harness linked={false} />); await click("Share to Cloud");
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    await render(<Harness />);
    expect(surface("local").hidden).toBe(false);
    expect(bridge).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("waits for sign-in and actual file access before selecting Cloud", async () => {
    installBridge(); await render(<Harness currentSession={null} />); await click("Cloud");
    expect(surface("local").hidden).toBe(false);
    expect(surface("cloud").hidden).toBe(true);
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Sign in");
    expect(bridge).not.toHaveBeenCalled();
    await render(<Harness />);
    expect(bridge).toHaveBeenCalled();
    expect(surface("cloud").hidden).toBe(false);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("does not select Cloud when authentication returns after the dialog was dismissed", async () => {
    installBridge(); await render(<Harness currentSession={null} />); await click("Cloud");
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    await render(<Harness />);
    expect(surface("local").hidden).toBe(false);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(bridge).not.toHaveBeenCalled();
  });

  it("keeps local drafts on a failed file preflight and retries only on request", async () => {
    installBridge(); bridge.mockRejectedValueOnce(Object.assign(new Error("Denied"), { status: 403 }));
    await render(<Harness />); await click("Cloud");
    expect(surface("local").hidden).toBe(false);
    expect(document.querySelector('[role="alert"]')).not.toBeNull();
    expect(bridge).toHaveBeenCalledOnce();
    await click("Retry");
    expect(surface("cloud").hidden).toBe(false);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it.each(["cancel", "repository", "disabled", "account"])('revokes a pending file response on %s change', async (change) => {
    installBridge();
    let finish!: (value: unknown) => void;
    bridge.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await render(<Harness />); await click("Cloud");
    expect(surface("local").hidden).toBe(false);
    if (change === "cancel") await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    if (change === "repository") await render(<Harness localIdentity="another-project" />);
    if (change === "disabled") await render(<Harness enabled={false} />);
    if (change === "account") await render(<Harness currentSession={null} />);
    await act(async () => finish({ entries: [], ...nativeSnapshot("stale") }));
    expect(surface("local").hidden).toBe(false);
    if (change === "account") {
      await render(<Harness currentSession={{ ...session, user_id: "another-account", session_generation: "second" }} />);
      expect(cloud.service!.workspace.id).toContain("another-account");
      expect(surface("cloud").hidden).toBe(false);
    } else expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("changes the storage namespace on account change and revokes the previous provider", async () => {
    installBridge(); await render(<Harness />); await click("Cloud");
    const previousPort = cloud.dataPort!; const previousId = cloud.service!.workspace.id;
    await render(<Harness currentSession={{ ...session, user_id: "another-account", session_generation: "second" }} />);
    expect(cloud.service!.workspace.id).not.toBe(previousId);
    expect(surface("local").hidden).toBe(false);
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
    expect(surface("local").hidden).toBe(false);
    expect(cloud.surfaceService.workspace.id).not.toBe(cloud.service?.workspace.id);
    await render(<Harness />);
    expect(surface("local").hidden).toBe(false);
    expect(cloud.surfaceService.folder.capabilities.execute).toBe(false);
  });
});
