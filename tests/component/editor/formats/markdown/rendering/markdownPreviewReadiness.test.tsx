import { requireEditorView } from "../../../../../support/editor/editorView";
/**
 * @vitest-environment happy-dom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MarkdownCodeMirrorEditor } from "../../../../../../packages/shared-ui/src/editor/markdown/MarkdownCodeMirrorEditor";
import { markdownLivePreviewDecorations } from "../../../../../../packages/shared-ui/src/editor/markdown/core/decorations/livePreviewDecorations";
import * as markdownExtensions from "../../../../../../packages/shared-ui/src/editor/markdown/markdownCodeMirrorExtensions";
import { testT, withTestLocalization } from "../../../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type ScheduledTask = () => void;

let root: Root | null = null;
let tasks: ScheduledTask[] = [];
let frames = new Map<number, FrameRequestCallback>();
let nextFrameId = 1;

beforeEach(() => {
  tasks = [];
  frames = new Map();
  nextFrameId = 1;
  vi.stubGlobal("scheduler", {
    postTask(task: ScheduledTask, options?: { signal?: AbortSignal }) {
      tasks.push(() => {
        if (!options?.signal?.aborted) task();
      });
      return Promise.resolve();
    },
  });
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    const id = nextFrameId;
    nextFrameId += 1;
    frames.set(id, callback);
    return id;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
    frames.delete(id);
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Markdown Live Preview presentation readiness", () => {
  it("keeps canonical source pending until the same revision projection commits", async () => {
    const onPreviewReady = vi.fn();
    const container = await renderEditor(
      <MarkdownCodeMirrorEditor
        value="# Heading\n\nParagraph with **bold** text."
        readOnly={false}
        livePreview
        documentPath="note.md"
        onPreviewReady={onPreviewReady}
      />,
    );

    const host = getHost(container);
    expect(host.dataset.previewState).toBe("pending");
    expect(host.getAttribute("aria-busy")).toBe("true");
    expect(getEditorView(container).state.doc.toString()).toContain("# Heading");

    await flushScheduledTasks();
    await flushAnimationFrames();

    expect(host.dataset.previewState).toBe("ready");
    expect(host.getAttribute("aria-busy")).toBe("false");
    expect(onPreviewReady).toHaveBeenCalledTimes(1);
  });

  it("reconfirms readiness when the canonical revision changes before paint", async () => {
    const onPreviewReady = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const render = (value: string) => (
      <MarkdownCodeMirrorEditor
        value={value}
        readOnly={false}
        livePreview
        documentPath="revision.md"
        onPreviewReady={onPreviewReady}
      />
    );

    await act(async () => root?.render(withTestLocalization(render("# First"))));
    await flushScheduledTasks();
    await act(async () => root?.render(withTestLocalization(render("# Second"))));
    await flushAnimationFrames();

    expect(getHost(container).dataset.previewState).toBe("ready");
    expect(getEditorView(container).state.doc.toString()).toBe("# Second");
    expect(onPreviewReady).toHaveBeenCalledTimes(1);
  });

  it("never lets stale activation reveal a superseded document", async () => {
    const onPreviewReady = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    const render = (documentPath: string, value: string) => (
      <MarkdownCodeMirrorEditor
        value={value}
        readOnly={false}
        livePreview
        documentPath={documentPath}
        onPreviewReady={onPreviewReady}
      />
    );

    await act(async () => root?.render(withTestLocalization(render("first.md", "# First"))));
    await act(async () => root?.render(withTestLocalization(render("second.md", "# Second"))));
    expect(getHost(container).dataset.previewState).toBe("pending");

    await flushScheduledTasks();
    await flushAnimationFrames();

    expect(getHost(container).dataset.previewState).toBe("ready");
    expect(getEditorView(container).state.doc.toString()).toBe("# Second");
    expect(onPreviewReady).toHaveBeenCalledTimes(1);
  });

  it("shows intentional source mode immediately and removes Live Preview extensions", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const render = (livePreview: boolean) => (
      <MarkdownCodeMirrorEditor
        value="# Heading"
        readOnly={false}
        livePreview={livePreview}
        documentPath="mode.md"
      />
    );

    await act(async () => root?.render(withTestLocalization(render(true))));
    await flushScheduledTasks();
    await flushAnimationFrames();
    const view = getEditorView(container);
    expect(view.state.field(markdownLivePreviewDecorations, false)).toBeDefined();

    await act(async () => root?.render(withTestLocalization(render(false))));

    expect(getHost(container).dataset.previewState).toBe("source");
    expect(getHost(container).getAttribute("aria-busy")).toBe("false");
    expect(view.state.field(markdownLivePreviewDecorations, false)).toBeUndefined();
  });

  it("falls back explicitly to source when Live Preview activation fails", async () => {
    const activationError = new Error("preview activation fixture");
    const onPreviewError = vi.fn();
    vi.spyOn(markdownExtensions, "markdownLivePreviewCoreExtension").mockImplementation(() => {
      throw activationError;
    });

    const container = await renderEditor(
      <MarkdownCodeMirrorEditor
        value="# Recoverable source"
        readOnly={false}
        livePreview
        documentPath="failure.md"
        onPreviewError={onPreviewError}
      />,
    );
    await flushScheduledTasks();

    const host = getHost(container);
    expect(host.dataset.previewState).toBe("error");
    expect(host.dataset.previewMessage).toBe(testT("editor.markdown.previewUnavailable"));
    expect(getEditorView(container).state.doc.toString()).toBe("# Recoverable source");
    expect(onPreviewError).toHaveBeenCalledWith(activationError);
  });

  it("uses a cancellable timer fallback when Scheduler rejects activation", async () => {
    const consoleWarning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("scheduler", {
      postTask() {
        return Promise.reject(new Error("scheduler fixture rejection"));
      },
    });

    const container = await renderEditor(
      <MarkdownCodeMirrorEditor
        value="# Scheduler fallback"
        readOnly={false}
        livePreview
        documentPath="scheduler.md"
      />,
    );
    await flushTimerTurns(3);
    await flushAnimationFrames();

    expect(getHost(container).dataset.previewState).toBe("ready");
    expect(consoleWarning).toHaveBeenCalledWith(
      "Unable to schedule Markdown activation task; using timer fallback:",
      expect.any(Error),
    );
  });
});

async function renderEditor(element: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root?.render(withTestLocalization(element)));
  return container;
}

function getHost(container: HTMLElement) {
  const host = container.querySelector<HTMLElement>(".markdown-codemirror-editor");
  if (!host) throw new Error("Markdown editor host did not mount.");
  return host;
}

function getEditorView(container: HTMLElement) {
  const editor = container.querySelector<HTMLElement>(".cm-editor");
  if (!editor) throw new Error("CodeMirror editor did not mount.");
  return requireEditorView(editor);
}

async function flushScheduledTasks() {
  await act(async () => {
    for (let iteration = 0; tasks.length > 0 && iteration < 20; iteration += 1) {
      const task = tasks.shift();
      task?.();
      await Promise.resolve();
    }
  });
  if (tasks.length > 0) throw new Error("Markdown activation tasks did not settle.");
}

async function flushAnimationFrames() {
  await act(async () => {
    for (let iteration = 0; frames.size > 0 && iteration < 20; iteration += 1) {
      const pending = [...frames.values()];
      frames.clear();
      for (const frame of pending) frame(performance.now());
      await Promise.resolve();
    }
  });
  if (frames.size > 0) throw new Error("Markdown animation frames did not settle.");
}

async function flushTimerTurns(count: number) {
  for (let turn = 0; turn < count; turn += 1) {
    await act(async () => {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    });
  }
}
