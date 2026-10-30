/** @vitest-environment happy-dom */
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createWorkspaceFolder, qualifyDataResourcePath, type DataPort } from "@puppyone/shared-ui";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceEntryBootstrap } from "../../../../src/features/app-shell/useWorkspaceEntryBootstrap";
import type { WorkspaceEntryIntent } from "../../../../src/features/app-shell/workspaceEntryBootstrap";
import { OnboardingProjectEntryDialog } from "../../../../src/components/OnboardingProjectEntryDialog";
import { ProjectEntryFlow, useProjectEntryFlow, type ProjectEntryFlowController } from "../../../../src/features/app-shell/ProjectEntryFlow";
import { desktopPreferencesStore, initializeDesktopPreferences } from "../../../../src/preferencesStore";
import type { MarketplaceTemplateDetail, ProjectInitializationReceipt, WorkspaceCreateProjectRequest, WorkspaceCreateProjectResult } from "../../../../src/types/electron";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
afterEach(() => { act(() => root?.unmount()); root = null; document.body.replaceChildren(); });

const folder = createWorkspaceFolder({ id: "notes", name: "Notes", path: "/projects/Notes", status: "recording" });
const receipt: ProjectInitializationReceipt = {
  operationId: "operation-one", outcome: "committed", path: "/projects/Notes", name: "Notes",
  createdPaths: ["Getting Started.md"], initialOpenPath: "Getting Started.md", template: null,
};
const intent: WorkspaceEntryIntent = {
  id: "entry-one",
  kind: "created",
  workspacePath: receipt.path,
  preferredOpenPath: receipt.initialOpenPath,
};
function Harness(props: Parameters<typeof useWorkspaceEntryBootstrap>[0]) { useWorkspaceEntryBootstrap(props); return null; }
function mount() { const host = document.createElement("div"); document.body.append(host); root = createRoot(host); return host; }
async function flush() { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }
function setName(host: HTMLElement, name: string) {
  // The project name field, not the optional template-link checkbox above it.
  const input = host.querySelector<HTMLInputElement>('input[type="text"]')!;
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, name); input.dispatchEvent(new Event("input", { bubbles: true })); });
}

describe("workspace entry bootstrap", () => {
  it("opens a template's preferred document once and targets its folder in a multi-root workspace", async () => {
    mount();
    const other = createWorkspaceFolder({ id: "other", name: "Other", path: "/projects/Other", status: "recording" });
    const preferredPath = qualifyDataResourcePath(folder.uri, "Getting Started.md");
    const props = {
      intent,
      folders: [other, folder],
      dataPort: {
        listChildren: vi.fn(async () => []),
        resolveNode: vi.fn(async (path: string) => path === preferredPath
          ? { id: path, name: "Getting Started.md", path, type: "markdown" as const, workspaceFolderId: folder.id }
          : null),
      },
      editorHydrated: true,
      hasOpenEditors: false,
      openDocument: vi.fn(),
      consume: vi.fn(),
      onError: vi.fn(),
    };
    await act(async () => { root!.render(<StrictMode><Harness {...props} /></StrictMode>); await flush(); });
    await act(async () => { root!.render(<StrictMode><Harness {...props} folders={[other, folder]} /></StrictMode>); await flush(); });
    expect(props.consume).toHaveBeenCalledExactlyOnceWith(intent.id);
    expect(props.openDocument).toHaveBeenCalledExactlyOnceWith(
      preferredPath,
      expect.objectContaining({ workspaceFolderId: folder.id }),
    );
  });

  it("opens README for an existing folder when there is no restored editor session", async () => {
    mount();
    const readmePath = qualifyDataResourcePath(folder.uri, "README.md");
    const props = {
      intent: { ...intent, kind: "opened" as const, preferredOpenPath: null },
      folders: [folder],
      dataPort: {
        listChildren: vi.fn(async () => [
          { id: "z", name: "z.txt", path: qualifyDataResourcePath(folder.uri, "z.txt"), type: "text" as const },
          { id: "readme", name: "README.md", path: readmePath, type: "markdown" as const },
        ]),
      } satisfies Pick<DataPort, "listChildren" | "resolveNode">,
      editorHydrated: true,
      hasOpenEditors: false,
      openDocument: vi.fn(),
      consume: vi.fn(),
      onError: vi.fn(),
    };
    await act(async () => { root!.render(<Harness {...props} />); await flush(); });
    expect(props.openDocument).toHaveBeenCalledWith(readmePath, expect.objectContaining({ name: "README.md" }));
    expect(props.consume).toHaveBeenCalledOnce();
  });

  it.each(["restored", "switched"] as const)("preserves an existing editor session on %s entry", async (kind) => {
    mount();
    const props = {
      intent: { ...intent, kind, preferredOpenPath: null },
      folders: [folder],
      dataPort: { listChildren: vi.fn(async () => []) },
      editorHydrated: true,
      hasOpenEditors: true,
      openDocument: vi.fn(),
      consume: vi.fn(),
      onError: vi.fn(),
    };
    await act(async () => { root!.render(<Harness {...props} />); await flush(); });
    expect(props.dataPort.listChildren).not.toHaveBeenCalled();
    expect(props.openDocument).not.toHaveBeenCalled();
    expect(props.consume).toHaveBeenCalledWith(intent.id);
  });
});

describe("project template selection", () => {
  it("keeps one default-location request under StrictMode and always creates the guide", async () => {
    const host = mount();
    const onSubmit = vi.fn(async (request: WorkspaceCreateProjectRequest): Promise<WorkspaceCreateProjectResult> => ({
      initialization: { ...receipt, operationId: request.operationId, initialOpenPath: null, createdPaths: [] },
      opening: { status: "opened", result: { status: "opened-current", workspaceId: "notes", path: receipt.path, workspace: folder.workspace } },
    }));
    const onDefaultLocation = vi.fn(async () => ({ grantId: "location", path: "/projects" }));
    const onClose = vi.fn();
    await act(async () => { root!.render(withTestLocalization(<StrictMode><OnboardingProjectEntryDialog templateLinks={false} onClose={onClose} onDefaultLocation={onDefaultLocation} onSubmit={onSubmit} /></StrictMode>)); await flush(); });
    expect(onDefaultLocation).toHaveBeenCalledOnce();
    expect(host.querySelector("select")).toBeNull();
    setName(host, "Notes");
    await act(async () => { host.querySelector<HTMLButtonElement>('button[type="submit"]')!.click(); await flush(); });
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      name: "Notes",
      source: { kind: "template", ref: { sourceId: "builtin", id: "puppyone.project.getting-started", version: 1 } },
      operationId: expect.any(String),
    }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("retains the exact operation when creation committed but opening failed", async () => {
    const host = mount();
    const onSubmit = vi.fn(async (request: WorkspaceCreateProjectRequest): Promise<WorkspaceCreateProjectResult> => ({
      initialization: { ...receipt, operationId: request.operationId },
      opening: { status: "failed", message: "Window unavailable" },
    }));
    await act(async () => { root!.render(withTestLocalization(<OnboardingProjectEntryDialog templateLinks={false} onClose={vi.fn()} onDefaultLocation={async () => ({ grantId: "location", path: "/projects" })} onSubmit={onSubmit} />)); await flush(); });
    setName(host, "Notes");
    await act(async () => { host.querySelector<HTMLButtonElement>('button[type="submit"]')!.click(); await flush(); });
    expect(host.textContent).toContain("Project created at /projects/Notes");
    expect(host.querySelector("input")!.disabled).toBe(true);
    expect(host.querySelector('button[type="submit"]')!.textContent).toBe("Open created project");
    await act(async () => { host.querySelector<HTMLButtonElement>('button[type="submit"]')!.click(); await flush(); });
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onSubmit.mock.calls[1]![0]).toBe(onSubmit.mock.calls[0]![0]);
  });
});

describe("marketplace template links", () => {
  const link = "https://www.puppyone.ai/t/b91aaade-bc9e-4dfd-8f23-11f06ec00301";
  const detail: MarketplaceTemplateDetail = {
    id: "template-one", releaseId: "release-one", name: "Hiring Tracker", description: "Roles and candidates.",
    version: "1.0.0", author: "PuppyOne", locale: "en", shareUrl: link, fileCount: 12, icon: null, requiresSignIn: false,
  };
  type TemplateBridge = Record<"readTemplateImportIntent" | "acknowledgeTemplateImportIntent" | "onTemplateImportRequested"
    | "resolveTemplateLink" | "readCloudAuthState", ReturnType<typeof vi.fn>>;
  let flow: ProjectEntryFlowController;
  const created = {
    initialization: { path: "/projects/Hiring Tracker", initialOpenPath: "README.md" },
    opening: { status: "opened", result: { status: "opened-current" } },
  };
  const onCreateProject = vi.fn(async () => created);
  function FlowHarness({ projectIsOpen = false }: { projectIsOpen?: boolean }) {
    flow = useProjectEntryFlow();
    return <ProjectEntryFlow controller={flow} onOpenFolder={vi.fn()} onCreateProject={onCreateProject as never} projectIsOpen={projectIsOpen}
      onChooseLocation={async () => null} onDefaultLocation={async () => ({ grantId: "location", path: "/projects" })} />;
  }
  function installBridge(overrides: Partial<TemplateBridge> = {}): TemplateBridge {
    // Main holds a link until it is acknowledged, then forgets it.
    let intent: { id: string; url: string } | null = { id: "intent-one", url: link };
    const bridge: TemplateBridge = {
      readTemplateImportIntent: vi.fn(async () => intent),
      acknowledgeTemplateImportIntent: vi.fn(async () => { intent = null; }),
      onTemplateImportRequested: vi.fn(() => () => {}),
      resolveTemplateLink: vi.fn(async () => detail),
      readCloudAuthState: vi.fn(async () => ({ status: "signed-out", session: null })),
      ...overrides,
    };
    Object.assign(window, { puppyoneDesktop: bridge });
    return bridge;
  }
  function preferences(cloud: boolean) {
    localStorage.clear();
    initializeDesktopPreferences();
    desktopPreferencesStore.getState().setExperimentalSettings((settings) => ({ ...settings, enableCloudWorkspace: cloud }));
  }
  const paste = (target: EventTarget, text: string) => {
    const event = Object.assign(new Event("paste", { bubbles: true, cancelable: true }), { clipboardData: { getData: () => text } });
    target.dispatchEvent(event);
    return event;
  };
  const submitButton = (host: HTMLElement) => host.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  afterEach(() => { Reflect.deleteProperty(window, "puppyoneDesktop"); localStorage.clear(); onCreateProject.mockClear(); });

  it("opens a store link as its card with Cloud off, and reads no account", async () => {
    preferences(false);
    const bridge = installBridge();
    const host = mount();
    await act(async () => { root!.render(withTestLocalization(<FlowHarness />)); await flush(); await flush(); });

    expect(bridge.acknowledgeTemplateImportIntent).toHaveBeenCalledWith("intent-one");
    expect(bridge.resolveTemplateLink).toHaveBeenCalledWith({ url: link, locale: "en" });
    expect(host.textContent).toContain("Hiring Tracker");
    expect(host.textContent).toContain("PuppyOne · 12 files");
    expect(host.querySelector(".onboarding-entry-template-destination bdi")!.textContent).toBe("projects/Hiring Tracker");
    expect(host.querySelector("input")).toBeNull();
    expect(submitButton(host).textContent).toBe("Get a copy");
    expect(submitButton(host).disabled).toBe(false);
    expect(bridge.readCloudAuthState).not.toHaveBeenCalled();
  });

  it("gets a copy in one action, under the template's own name", async () => {
    preferences(false);
    installBridge();
    const host = mount();
    await act(async () => { root!.render(withTestLocalization(<FlowHarness />)); await flush(); await flush(); });
    await act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await flush(); });

    expect(onCreateProject).toHaveBeenCalledOnce();
    expect(onCreateProject.mock.calls[0]).toMatchObject([{
      name: "Hiring Tracker", locationGrantId: "location", numberIfTaken: true, openInNewWindow: false,
      source: { kind: "template", ref: { sourceId: "marketplace", id: "template-one", releaseId: "release-one" } },
    }]);
    expect(host.querySelector("form")).toBeNull();
  });

  it("leaves an open Project where it is", async () => {
    preferences(false);
    installBridge();
    const host = mount();
    await act(async () => { root!.render(withTestLocalization(<FlowHarness projectIsOpen />)); await flush(); await flush(); });
    await act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await flush(); });
    expect(onCreateProject.mock.calls[0]).toMatchObject([{ openInNewWindow: true }]);
  });

  it("lets the name and place be changed, without asking first", async () => {
    preferences(false);
    installBridge();
    const host = mount();
    await act(async () => { root!.render(withTestLocalization(<FlowHarness />)); await flush(); await flush(); });
    await act(async () => { host.querySelector<HTMLButtonElement>(".onboarding-entry-template-destination button")!.click(); await flush(); });
    expect(host.querySelector<HTMLInputElement>(".onboarding-entry-create-input")!.value).toBe("Hiring Tracker");
    expect(host.querySelector(".onboarding-entry-location-path")!.textContent).toBe("/projects");
  });

  it("asks for an account only for a template that needs one", async () => {
    preferences(false);
    const bridge = installBridge({ resolveTemplateLink: vi.fn(async () => ({ ...detail, requiresSignIn: true })) });
    const host = mount();
    await act(async () => { root!.render(withTestLocalization(<FlowHarness />)); await flush(); await flush(); });
    expect(bridge.readCloudAuthState).toHaveBeenCalled();
    expect(host.textContent).toContain("Sign in to use this template");
    expect(submitButton(host).disabled).toBe(true);
  });

  it("explains a link that cannot be read and offers to try again", async () => {
    preferences(false);
    const resolveTemplateLink = vi.fn(async () => { throw new Error("The template store is temporarily unavailable."); });
    installBridge({ resolveTemplateLink });
    const host = mount();
    await act(async () => { root!.render(withTestLocalization(<FlowHarness />)); await flush(); await flush(); });
    expect(host.querySelector('[role="alert"]')!.textContent).toContain("temporarily unavailable");
    expect(submitButton(host)).toBeNull();
    resolveTemplateLink.mockImplementation((async () => detail) as never);
    await act(async () => { [...host.querySelectorAll("button")].find((button) => button.textContent === "Retry")!.click(); await flush(); });
    expect(host.textContent).toContain("Hiring Tracker");
  });

  it("opens a pasted template link, and leaves every other paste alone", async () => {
    preferences(false);
    const bridge = installBridge({ readTemplateImportIntent: vi.fn(async () => null) });
    const host = mount();
    await act(async () => { root!.render(withTestLocalization(<FlowHarness />)); await flush(); });
    const field = document.body.appendChild(document.createElement("input"));

    let other!: Event;
    await act(async () => { other = paste(document.body, "just some copied text"); await flush(); });
    expect(other.defaultPrevented).toBe(false);
    await act(async () => { other = paste(field, link); await flush(); });
    expect(other.defaultPrevented).toBe(false);
    expect(bridge.resolveTemplateLink).not.toHaveBeenCalled();
    expect(host.querySelector("form")).toBeNull();

    await act(async () => { other = paste(document.body, `  ${link}\n`); await flush(); await flush(); });
    expect(other.defaultPrevented).toBe(true);
    expect(bridge.resolveTemplateLink).toHaveBeenCalledWith({ url: link, locale: "en" });
    expect(host.textContent).toContain("Hiring Tracker");
    field.remove();
  });
});
