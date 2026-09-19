/** @vitest-environment happy-dom */
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createWorkspaceFolder, qualifyDataResourcePath } from "@puppyone/shared-ui";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useInitialProjectDocument } from "../../../../src/features/app-shell/useInitialProjectDocument";
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
function Harness(props: Parameters<typeof useInitialProjectDocument>[0]) { useInitialProjectDocument(props); return null; }
function mount() { const host = document.createElement("div"); document.body.append(host); root = createRoot(host); return host; }
async function flush() { await Promise.resolve(); await Promise.resolve(); }
function setName(host: HTMLElement, name: string) {
  const input = host.querySelector("input")!;
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, name); input.dispatchEvent(new Event("input", { bubbles: true })); });
}

describe("committed project opening intent", () => {
  it("opens once under StrictMode and targets the receipt's folder in a multi-root workspace", async () => {
    mount();
    const other = createWorkspaceFolder({ id: "other", name: "Other", path: "/projects/Other", status: "recording" });
    const props = { receipt, folders: [other, folder], openDocument: vi.fn(), consume: vi.fn(), onError: vi.fn() };
    await act(async () => { root!.render(<StrictMode><Harness {...props} /></StrictMode>); await flush(); });
    await act(async () => { root!.render(<StrictMode><Harness {...props} folders={[other, folder]} /></StrictMode>); await flush(); });
    expect(props.consume).toHaveBeenCalledExactlyOnceWith(receipt.operationId);
    expect(props.openDocument).toHaveBeenCalledExactlyOnceWith(
      qualifyDataResourcePath(folder.uri, "Getting Started.md"),
      expect.objectContaining({ workspaceFolderId: folder.id }),
    );
  });

  it("does nothing for existing folders, Blank, or an unrelated active workspace", async () => {
    mount();
    const props = { receipt: null, folders: [folder], openDocument: vi.fn(), consume: vi.fn(), onError: vi.fn() };
    await act(async () => { root!.render(<Harness {...props} />); await flush(); });
    await act(async () => { root!.render(<Harness {...props} receipt={receipt} folders={[]} />); await flush(); });
    expect(props.consume).not.toHaveBeenCalled();
    await act(async () => { root!.render(<Harness {...props} receipt={{ ...receipt, initialOpenPath: null }} />); await flush(); });
    expect(props.consume).toHaveBeenCalledOnce();
    expect(props.openDocument).not.toHaveBeenCalled();
  });

  it("reports an opening failure without regenerating the document", async () => {
    mount();
    const props = { receipt, folders: [folder], openDocument: vi.fn(async () => { throw new Error("Document unavailable"); }), consume: vi.fn(), onError: vi.fn() };
    await act(async () => { root!.render(<Harness {...props} />); await flush(); });
    expect(props.onError).toHaveBeenCalledWith("Document unavailable");
    expect(props.openDocument).toHaveBeenCalledOnce();
  });
});

describe("project template selection", () => {
  it("keeps one default-location request under StrictMode and supports true Blank", async () => {
    const host = mount();
    const onSubmit = vi.fn(async (request: WorkspaceCreateProjectRequest): Promise<WorkspaceCreateProjectResult> => ({
      initialization: { ...receipt, operationId: request.operationId, initialOpenPath: null, createdPaths: [] },
      opening: { status: "opened", result: { status: "opened-current", workspaceId: "notes", path: receipt.path, workspace: folder.workspace } },
    }));
    const onDefaultLocation = vi.fn(async () => ({ grantId: "location", path: "/projects" }));
    const onClose = vi.fn();
    await act(async () => { root!.render(withTestLocalization(<StrictMode><OnboardingProjectEntryDialog onClose={onClose} onDefaultLocation={onDefaultLocation} onSubmit={onSubmit} /></StrictMode>)); await flush(); });
    expect(onDefaultLocation).toHaveBeenCalledOnce();
    const select = host.querySelector("select")!;
    expect(select.value).toBe("get-started");
    act(() => { select.value = "blank"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    setName(host, "Notes");
    await act(async () => { host.querySelector<HTMLButtonElement>('button[type="submit"]')!.click(); await flush(); });
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ name: "Notes", source: { kind: "blank" }, operationId: expect.any(String) }));
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
