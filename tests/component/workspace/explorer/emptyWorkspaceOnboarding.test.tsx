/** @vitest-environment happy-dom */
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createWorkspaceFolder, qualifyDataResourcePath, type DataPort } from "@puppyone/shared-ui";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceEntryBootstrap } from "../../../../src/features/app-shell/useWorkspaceEntryBootstrap";
import type { WorkspaceEntryIntent } from "../../../../src/features/app-shell/workspaceEntryBootstrap";
import { OnboardingProjectEntryDialog } from "../../../../src/components/OnboardingProjectEntryDialog";
import type { ProjectInitializationReceipt, WorkspaceCreateProjectRequest, WorkspaceCreateProjectResult } from "../../../../src/types/electron";
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
  const input = host.querySelector("input")!;
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
      revealAgentWorkbench: vi.fn(),
      onError: vi.fn(),
    };
    await act(async () => { root!.render(<StrictMode><Harness {...props} /></StrictMode>); await flush(); });
    await act(async () => { root!.render(<StrictMode><Harness {...props} folders={[other, folder]} /></StrictMode>); await flush(); });
    expect(props.consume).toHaveBeenCalledExactlyOnceWith(intent.id);
    expect(props.openDocument).toHaveBeenCalledExactlyOnceWith(
      preferredPath,
      expect.objectContaining({ workspaceFolderId: folder.id }),
    );
    expect(props.revealAgentWorkbench).toHaveBeenCalledExactlyOnceWith();
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
      revealAgentWorkbench: vi.fn(),
      onError: vi.fn(),
    };
    await act(async () => { root!.render(<Harness {...props} />); await flush(); });
    expect(props.openDocument).toHaveBeenCalledWith(readmePath, expect.objectContaining({ name: "README.md" }));
    expect(props.consume).toHaveBeenCalledOnce();
    expect(props.revealAgentWorkbench).toHaveBeenCalledOnce();
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
      revealAgentWorkbench: vi.fn(),
      onError: vi.fn(),
    };
    await act(async () => { root!.render(<Harness {...props} />); await flush(); });
    expect(props.dataPort.listChildren).not.toHaveBeenCalled();
    expect(props.openDocument).not.toHaveBeenCalled();
    expect(props.revealAgentWorkbench).toHaveBeenCalledTimes(kind === "switched" ? 0 : 1);
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
    await act(async () => { root!.render(withTestLocalization(<StrictMode><OnboardingProjectEntryDialog onClose={onClose} onDefaultLocation={onDefaultLocation} onSubmit={onSubmit} /></StrictMode>)); await flush(); });
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
    await act(async () => { root!.render(withTestLocalization(<OnboardingProjectEntryDialog onClose={vi.fn()} onDefaultLocation={async () => ({ grantId: "location", path: "/projects" })} onSubmit={onSubmit} />)); await flush(); });
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
