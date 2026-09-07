/**
 * @vitest-environment happy-dom
 */
import React, { useState } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EXPLORER_REFERENCE_DRAG_TYPE } from "@puppyone/shared-ui";
import type {
  AgentDraftReference,
  AgentPromptReferenceMention,
  AgentReferenceInputCapabilities,
} from "../src/features/desktop-agent/domain/agent-contract";
import { AgentComposer } from "../src/features/desktop-agent/ui/AgentComposer";
import { AgentPanelLayout } from "../src/features/desktop-agent/ui/AgentPanelLayout";
import {
  useAgentReferenceIngestion,
  type AgentWorkspaceReferenceResolver,
} from "../src/features/desktop-agent/ui/useAgentReferenceIngestion";
import { renderWithTestLocalization } from "./testLocalization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("Desktop Agent reference ingestion", () => {
  it("uses the whole Chat as a silent drop target without changing UI before release", async () => {
    const controller = controllerFixture();
    const container = render(<IngestionHarness controller={controller} />);
    const boundary = container.querySelector<HTMLElement>(".desktop-agent-boundary")!;
    const transfer = typedWorkspaceTransfer("workspace-1", ["README.md", "src"]);

    act(() => boundary.dispatchEvent(dragEvent("dragover", transfer)));
    expect(transfer.dropEffect).toBe("copy");
    expect(container.querySelector(".desktop-agent-reference-drop-overlay")).toBeNull();
    expect(boundary.hasAttribute("data-drop-active")).toBe(false);
    expect(boundary.hasAttribute("data-drop-valid")).toBe(false);
    await act(async () => boundary.dispatchEvent(dragEvent("drop", transfer)));
    await vi.waitFor(() => expect(controller.addWorkspacePaths).toHaveBeenCalledWith(
      ["README.md", "src"],
      expect.any(Map),
    ));
    expect(controller.submit).not.toHaveBeenCalled();
    expect(container.querySelector("[role='status']")?.textContent).toContain("2 references");
  });

  it("marks cross-workspace drags invalid and never grants their paths", async () => {
    const controller = controllerFixture();
    const container = render(<IngestionHarness controller={controller} />);
    const boundary = container.querySelector<HTMLElement>(".desktop-agent-boundary")!;
    const transfer = typedWorkspaceTransfer("another-workspace", ["secret.md"]);
    act(() => boundary.dispatchEvent(dragEvent("dragover", transfer)));
    expect(transfer.dropEffect).toBe("none");
    expect(container.querySelector(".desktop-agent-reference-drop-overlay")).toBeNull();
    await act(async () => boundary.dispatchEvent(dragEvent("drop", transfer)));
    expect(controller.addWorkspacePaths).not.toHaveBeenCalled();
    expect(container.querySelector("[role='status']")?.textContent).toContain("another workspace");
  });

  it("resolves Workbench resource URIs before requesting native workspace authorization", async () => {
    const controller = controllerFixture();
    const resource = "puppyone-local://workspace/folder-1/guanqun.md";
    const resolveWorkspaceReference: AgentWorkspaceReferenceResolver = vi.fn(() => ({
      workspaceRoot: "/workspace",
      referencePath: "guanqun.md",
    }));
    const container = render(<IngestionHarness
      controller={controller}
      resolveWorkspaceReference={resolveWorkspaceReference}
    />);
    const boundary = container.querySelector<HTMLElement>(".desktop-agent-boundary")!;

    await act(async () => boundary.dispatchEvent(dragEvent(
      "drop",
      typedWorkspaceTransfer("workspace-1", [resource]),
    )));

    await vi.waitFor(() => expect(controller.addWorkspacePaths).toHaveBeenCalledWith(
      [resource],
      expect.any(Map),
    ));
    expect(resolveWorkspaceReference).toHaveBeenCalledWith(resource);
    expect(controller.addWorkspacePaths).not.toHaveBeenCalledWith([resource]);
  });

  it("intercepts a Workspace Resource URI inside CodeMirror before native drop inserts visible URI text", async () => {
    const controller = controllerFixture();
    const resource = "puppyone-local://workspace/folder-1/notes.md";
    const resolveWorkspaceReference: AgentWorkspaceReferenceResolver = vi.fn(() => ({
      workspaceRoot: "/workspace",
      referencePath: "notes.md",
    }));
    const container = render(<IngestionHarness
      controller={controller}
      withComposer
      resolveWorkspaceReference={resolveWorkspaceReference}
    />);
    const promptEditor = container.querySelector<HTMLElement>(".cm-content")!;
    const transfer = fakeDataTransfer({
      [EXPLORER_REFERENCE_DRAG_TYPE]: JSON.stringify({
        version: 1,
        workspaceId: "workspace-1",
        entries: [{ path: resource, name: "notes.md", entryType: "file" }],
      }),
      "text/plain": resource,
    });
    const drop = dragEvent("drop", transfer);

    await act(async () => promptEditor.dispatchEvent(drop));

    await vi.waitFor(() => expect(controller.addWorkspacePaths).toHaveBeenCalledWith(
      [resource],
      expect.any(Map),
    ));
    expect(controller.addWorkspacePaths).toHaveBeenCalledTimes(1);
    expect(drop.defaultPrevented).toBe(true);
    expect(promptEditor.textContent).not.toContain("puppyone-local://");
  });

  it("loads an authorized visual preview for a workspace image without putting its URL in the path", async () => {
    const controller = controllerFixture();
    const resource = "puppyone-local://workspace/folder-1/capture.png";
    const loadVisualPreview = vi.fn(async () => ({ url: "puppyone-local://preview/capture" }));
    const resolveWorkspaceReference: AgentWorkspaceReferenceResolver = vi.fn(async () => ({
      workspaceRoot: "/workspace",
      referencePath: "capture.png",
      loadVisualPreview,
    }));
    const container = render(<IngestionHarness
      controller={controller}
      resolveWorkspaceReference={resolveWorkspaceReference}
    />);
    const boundary = container.querySelector<HTMLElement>(".desktop-agent-boundary")!;

    await act(async () => boundary.dispatchEvent(dragEvent(
      "drop",
      typedWorkspaceTransfer("workspace-1", [resource]),
    )));

    await vi.waitFor(() => expect(controller.addWorkspacePaths).toHaveBeenCalled());
    const [paths, previews] = controller.addWorkspacePaths.mock.calls[0]!;
    expect(paths).toEqual([resource]);
    expect(previews.get(resource)?.url).toBe("puppyone-local://preview/capture");
    expect(loadVisualPreview).toHaveBeenCalledTimes(1);
  });

  it("preserves another attached root's URI through native authorization", async () => {
    const controller = controllerFixture();
    const resource = "puppyone-local://workspace/folder-2/secret.md";
    const loadVisualPreview = vi.fn(async () => ({ url: "puppyone-local://preview/secret" }));
    const resolveWorkspaceReference: AgentWorkspaceReferenceResolver = vi.fn(() => ({
      workspaceRoot: "/another-root",
      referencePath: "secret.md",
      loadVisualPreview,
    }));
    const container = render(<IngestionHarness
      controller={controller}
      resolveWorkspaceReference={resolveWorkspaceReference}
    />);
    const boundary = container.querySelector<HTMLElement>(".desktop-agent-boundary")!;

    await act(async () => boundary.dispatchEvent(dragEvent(
      "drop",
      typedWorkspaceTransfer("workspace-1", [resource]),
    )));

    expect(controller.addWorkspacePaths).toHaveBeenCalledWith([resource], expect.any(Map));
    expect(loadVisualPreview).toHaveBeenCalledOnce();
  });

  it("routes Finder drop, picker and every semantically supported pasted File through one staging method", async () => {
    const controller = controllerFixture();
    const container = render(<IngestionHarness controller={controller} withComposer />);
    const boundary = container.querySelector<HTMLElement>(".desktop-agent-boundary")!;
    const promptEditor = container.querySelector<HTMLElement>(".cm-content")!;
    const image = new File(["image"], "capture.png", { type: "image/png" });
    const markdown = new File(["# Notes"], "notes.md", { type: "text/markdown" });

    await act(async () => boundary.dispatchEvent(dragEvent("drop", fileTransfer([image]))));
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", { configurable: true, value: [image] });
    act(() => input.dispatchEvent(new Event("change", { bubbles: true })));
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: fileTransfer([image]) });
    act(() => promptEditor.dispatchEvent(paste));
    const textPaste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(textPaste, "clipboardData", { value: fileTransfer([markdown]) });
    act(() => promptEditor.dispatchEvent(textPaste));

    await vi.waitFor(() => expect(controller.stageExternalFiles).toHaveBeenCalledTimes(4));
    expect(controller.stageExternalFiles.mock.calls.slice(0, 3).every(([files]) => files[0] === image)).toBe(true);
    expect(controller.stageExternalFiles.mock.calls[3]?.[0][0]).toBe(markdown);
  });

  it("opens the file picker directly from plus and keeps status-aware retryable chips", () => {
    const onRetryReference = vi.fn();
    const onRemoveReference = vi.fn();
    const onAddExternalFiles = vi.fn();
    const container = render(<AgentComposer
      draft=""
      onDraftChange={vi.fn()}
      disabled={false}
      running={false}
      stopping={false}
      submitting={false}
      referenceCapabilities={capabilities()}
      references={[{
        id: "failed-ref",
        kind: "workspace-entry",
        entryType: "file",
        relativePath: "missing.md",
        displayName: "missing.md",
        status: "error",
        error: { code: "workspace-resolution-failed", message: "File no longer exists" },
      }]}
      onAddExternalFiles={onAddExternalFiles}
      onRetryReference={onRetryReference}
      onRemoveReference={onRemoveReference}
      onSubmit={vi.fn(async () => true)}
      onStop={vi.fn()}
    />);
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="Add files from computer"]')!;
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const openFilePicker = vi.spyOn(fileInput, "click").mockImplementation(() => undefined);
    expect(trigger.className).toBe("desktop-agent-reference-trigger");
    expect(trigger.hasAttribute("aria-haspopup")).toBe(false);
    act(() => trigger.click());
    expect(openFilePicker).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="menu"]')).toBeNull();

    const retry = container.querySelector<HTMLButtonElement>('button[aria-label*="Retry reference"]')!;
    const failedCard = container.querySelector(".desktop-agent-reference-card.is-error");
    expect(failedCard?.getAttribute("title")).toContain("This workspace item could not be added");
    expect(failedCard?.getAttribute("title")).toContain("File no longer exists");
    expect(container.textContent).not.toContain("File no longer exists");
    expect(container.querySelector(".desktop-agent-reference-card-copy small")?.textContent)
      .toContain("This workspace item could not be added");
    act(() => retry.click());
    expect(onRetryReference).toHaveBeenCalledWith("failed-ref");
    expect((container.querySelector('button[aria-label="Send message"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it("renders images in the media area and Markdown as an atomic inline prompt mention", async () => {
    const onSelectEffort = vi.fn();
    const onDraftDocumentChange = vi.fn();
    const container = render(<AgentComposer
      draft="Describe this image"
      onDraftChange={vi.fn()}
      onDraftDocumentChange={onDraftDocumentChange}
      disabled={false}
      running={false}
      stopping={false}
      submitting={false}
      sessionControls={[
        {
          id: "model",
          value: "gpt-5.6",
          options: [{ value: "gpt-5.6", label: "GPT-5.6", description: "OpenAI · GPT-5.6" }],
        },
        {
          id: "effort",
          value: "high",
          options: [{ value: "low", label: "low" }, { value: "high", label: "high" }],
        },
      ]}
      onSelectSessionControl={(id, value) => {
        if (id === "effort") onSelectEffort(value);
      }}
      referenceCapabilities={capabilities()}
      references={[
        {
          id: "markdown-ref",
          kind: "workspace-entry",
          entryType: "file",
          relativePath: "docs/SECURITY.md",
          displayName: "SECURITY.md",
          mime: "text/markdown",
          size: 12,
          status: "ready",
        },
        {
          id: "image-ref",
          kind: "staged-attachment",
          displayName: "capture.png",
          mime: "image/png",
          size: 5,
          status: "ready",
        },
      ]}
      getReferencePreviewUrl={(id) => id === "image-ref" ? "blob:agent-preview" : null}
      onRemoveReference={vi.fn()}
      onSubmit={vi.fn(async () => true)}
      onStop={vi.fn()}
    />);

    const composer = container.querySelector(".desktop-agent-composer")!;
    const cards = composer.querySelector(".desktop-agent-reference-cards")!;
    const imageCard = composer.querySelector(".desktop-agent-reference-card.is-image-card")!;
    const preview = imageCard.querySelector<HTMLImageElement>(".desktop-agent-reference-image-preview img");
    const promptEditor = composer.querySelector(".desktop-agent-prompt-editor")!;
    const toolbar = composer.querySelector(".desktop-agent-composer-trailing")!;
    const leading = toolbar.querySelector(".desktop-agent-composer-leading")!;
    const actions = toolbar.querySelector(".desktop-agent-composer-actions")!;
    const attachment = toolbar.querySelector(".desktop-agent-reference-trigger")!;
    const modelPicker = leading.querySelector(".desktop-agent-composer-picker.is-model")!;
    const effortPicker = leading.querySelector(".desktop-agent-composer-picker.is-effort")!;
    const send = actions.querySelector(".desktop-agent-composer-action")!;
    const modelTrigger = modelPicker.querySelector<HTMLButtonElement>('[aria-label="Agent model"]')!;
    const effortTrigger = effortPicker.querySelector<HTMLButtonElement>('[aria-label="Reasoning effort"]')!;
    const remove = imageCard.querySelector<HTMLButtonElement>(".desktop-agent-reference-card-actions button:last-child")!;
    await vi.waitFor(() => expect(composer.querySelector(".desktop-agent-prompt-mention")?.textContent).toContain("@docs/SECURITY.md"));
    const mention = composer.querySelector(".desktop-agent-prompt-mention");
    expect(mention?.getAttribute("title")).toBe("docs/SECURITY.md");
    expect(mention?.getAttribute("data-reference-kind")).toBe("workspace-entry");
    expect(mention?.getAttribute("data-atomic")).toBe("true");
    expect(mention?.getAttribute("contenteditable")).toBe("false");
    expect(onDraftDocumentChange).toHaveBeenCalledWith(
      expect.stringContaining("@docs/SECURITY.md"),
      [expect.objectContaining({ referenceId: "markdown-ref", start: expect.any(Number), end: expect.any(Number) })],
    );
    expect(onDraftDocumentChange.mock.calls.some(([, mentions]) => (
      mentions.some((mention: { referenceId: string }) => mention.referenceId === "image-ref")
    ))).toBe(false);
    expect(composer.querySelector(".desktop-agent-reference-card.is-file-card")).toBeNull();
    expect(preview?.getAttribute("src")).toBe("blob:agent-preview");
    expect(cards.compareDocumentPosition(promptEditor) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(promptEditor.compareDocumentPosition(toolbar) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(leading.contains(attachment)).toBe(false);
    expect(actions.contains(attachment)).toBe(true);
    expect(leading.contains(modelPicker)).toBe(true);
    expect(leading.contains(effortPicker)).toBe(true);
    expect(modelTrigger.textContent).toContain("GPT-5.6");
    expect(effortTrigger.textContent).toBe("High");
    expect(modelTrigger.querySelector(".desktop-agent-picker-trigger-mark")).toBeNull();
    expect(effortTrigger.querySelector("svg")).toBeNull();
    expect(modelPicker.compareDocumentPosition(effortPicker) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(attachment.compareDocumentPosition(send) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(remove.closest(".desktop-agent-reference-card-actions")).not.toBeNull();
    act(() => effortTrigger.click());
    expect(document.querySelectorAll('.desktop-agent-picker-list [role="group"]')).toHaveLength(0);
    const light = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="option"]'))
      .find((option) => option.textContent?.includes("Light"))!;
    act(() => light.click());
    expect(onSelectEffort).toHaveBeenCalledWith("low");
  });

  it("announces partial batches while retaining the rejected item as an actionable error", async () => {
    const controller = controllerFixture();
    controller.stageExternalFiles.mockImplementationOnce(async () => {
      controller.getSnapshot.mockReturnValue({
        references: [{ id: "failed", status: "error", error: { message: "Unsupported type" } }],
      });
      return 0;
    });
    const container = render(<IngestionHarness controller={controller} />);
    const boundary = container.querySelector<HTMLElement>(".desktop-agent-boundary")!;
    await act(async () => boundary.dispatchEvent(dragEvent("drop", fileTransfer([
      new File(["pdf"], "paper.pdf", { type: "application/pdf" }),
    ]))));
    await vi.waitFor(() => expect(container.querySelector("[role='status']")?.textContent).toContain("1 could not be added"));
  });

  it("deletes an inline file mention atomically and releases its semantic reference", async () => {
    const onRemove = vi.fn();
    const container = render(<StructuredMentionHarness onRemove={onRemove} />);
    await vi.waitFor(() => expect(container.querySelector(".desktop-agent-prompt-mention")?.textContent).toBe("@notes.md"));
    const content = container.querySelector<HTMLElement>(".cm-content")!;

    act(() => content.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true })));

    await vi.waitFor(() => expect(onRemove).toHaveBeenCalledWith("ref-notes"));
    expect(container.querySelector(".desktop-agent-prompt-mention")).toBeNull();
    expect(content.querySelector(".cm-placeholder")).not.toBeNull();
  });
});

function IngestionHarness({
  controller,
  withComposer = false,
  resolveWorkspaceReference,
}: {
  controller: ReturnType<typeof controllerFixture>;
  withComposer?: boolean;
  resolveWorkspaceReference?: AgentWorkspaceReferenceResolver;
}) {
  const ingestion = useAgentReferenceIngestion({
    controller: controller as never,
    workspaceId: "workspace-1",
    capabilities: capabilities(),
    resolveWorkspaceReference,
  });
  return <AgentPanelLayout
    ariaLabel="Agent Chat"
    conversation={<div>conversation</div>}
    announcement={ingestion.announcement}
    onDragOver={ingestion.onDragOver}
    onDrop={ingestion.onDrop}
    dock={withComposer ? <AgentComposer
      draft=""
      onDraftChange={vi.fn()}
      disabled={false}
      running={false}
      stopping={false}
      submitting={false}
      referenceCapabilities={capabilities()}
      onAddExternalFiles={ingestion.addExternalFiles}
      onPickWorkspaceReferences={ingestion.pickWorkspaceReferences}
      onDrop={ingestion.onEditorDrop}
      onPaste={ingestion.onPaste}
      onSubmit={vi.fn(async () => true)}
      onStop={vi.fn()}
    /> : null}
  />;
}

function StructuredMentionHarness({ onRemove }: { onRemove: (id: string) => void }) {
  const [draft, setDraft] = useState("");
  const [mentions, setMentions] = useState<AgentPromptReferenceMention[]>([]);
  const [references, setReferences] = useState<AgentDraftReference[]>([{
    id: "ref-notes",
    kind: "workspace-entry",
    entryType: "file",
    relativePath: "notes.md",
    displayName: "notes.md",
    mime: "text/markdown",
    size: 10,
    status: "ready",
  }]);
  return <AgentComposer
    draft={draft}
    draftMentions={mentions}
    onDraftChange={setDraft}
    onDraftDocumentChange={(value, nextMentions) => {
      setDraft(value);
      setMentions(nextMentions);
    }}
    disabled={false}
    running={false}
    stopping={false}
    submitting={false}
    references={references}
    referenceCapabilities={capabilities()}
    onRemoveReference={(id) => {
      setReferences((current) => current.filter((reference) => reference.id !== id));
      onRemove(id);
    }}
    onSubmit={vi.fn(async () => true)}
    onStop={vi.fn()}
  />;
}

function controllerFixture() {
  return {
    workspaceRoot: "/workspace",
    getSnapshot: vi.fn(() => ({ references: [] as Array<{ id: string; status: string; error?: { message: string } }> })),
    addWorkspacePaths: vi.fn(async (
      paths: string[],
      _previews: ReadonlyMap<string, { url: string }> = new Map(),
    ) => paths.length),
    addPathTextOrDraft: vi.fn(async () => false),
    stageExternalFiles: vi.fn(async (files: File[]) => files.length),
    pickWorkspaceReferences: vi.fn(async () => 1),
    submit: vi.fn(),
  };
}

function capabilities(): AgentReferenceInputCapabilities {
  return {
    schemaVersion: 1,
    workspace: { files: true, directories: true },
    attachments: {
      image: { accepted: true, mimeTypes: ["image/png"] },
      text: { accepted: true, mimeTypes: ["text/*", "application/json"], extensions: [".md"] },
      audio: { accepted: false },
      video: { accepted: false },
      binary: { accepted: false },
    },
    limits: {
      maxCount: 32,
      maxBytesPerReference: 25 * 1024 * 1024,
      maxTotalBytes: 25 * 1024 * 1024,
    },
    steer: false,
    attachmentOnly: false,
  };
}

function render(node: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => renderWithTestLocalization(root, node));
  return container;
}

function typedWorkspaceTransfer(workspaceId: string, paths: string[]) {
  return fakeDataTransfer({
    [EXPLORER_REFERENCE_DRAG_TYPE]: JSON.stringify({
      version: 1,
      workspaceId,
      entries: paths.map((path, index) => ({
        path,
        name: path,
        entryType: index === paths.length - 1 && path === "src" ? "directory" : "file",
      })),
    }),
  });
}

function fileTransfer(files: File[]) {
  return fakeDataTransfer({}, files, ["Files"]);
}

function fakeDataTransfer(values: Record<string, string>, files: File[] = [], types = Object.keys(values)): DataTransfer {
  return {
    effectAllowed: "copy",
    dropEffect: "none",
    files: files as unknown as FileList,
    items: files.map(() => ({ kind: "file" })) as unknown as DataTransferItemList,
    types,
    getData: (type: string) => values[type] ?? "",
    setData: () => undefined,
    clearData: () => undefined,
    setDragImage: () => undefined,
  } as DataTransfer;
}

function dragEvent(type: string, dataTransfer: DataTransfer) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
  return event;
}
