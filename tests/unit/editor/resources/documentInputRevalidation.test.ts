import { describe, expect, it, vi } from "vitest";
import { createWorkspaceContentChange, type DataPort, type DocumentDataNode, type FileContent } from "@puppyone/shared-ui";
import { getDocumentInputRuntime, retireDocumentInputs } from "../../../../src/shared-ui/editor/resource/DocumentInputRuntime";
import { getEditorStorageIdentity } from "../../../../src/shared-ui/editor/resource/editorStorageIdentity";

function textPort(initial: string) {
  let disk = initial;
  let version = 1;
  const readFile = vi.fn(async (path: string): Promise<FileContent> =>
    ({ path, name: path, type: "markdown", content: disk, version: `v${version}` }));
  const port: DataPort = { listChildren: async () => [], readFile };
  return {
    port, readFile,
    write(content: string) { disk = content; version += 1; },
  };
}

describe("document input revalidation", () => {
  it("presents loading only for the first read", async () => {
    let resolveRead!: (content: FileContent) => void;
    const readFile = vi.fn((path: string) => new Promise<FileContent>((resolve) => { resolveRead = resolve; })
      .then((content) => ({ ...content, path })));
    const port: DataPort = { listChildren: async () => [], readFile };
    const node: DocumentDataNode = { id: "first-load.md", name: "first-load.md", path: "first-load.md", type: "markdown" };
    const runtime = getDocumentInputRuntime(port, node);
    const stop = runtime.subscribe(() => {});
    try {
      await vi.waitFor(() => expect(readFile).toHaveBeenCalledTimes(1));
      expect(runtime.getSnapshot()).toMatchObject({ loading: true, content: null });
      resolveRead({ path: "first-load.md", name: "first-load.md", type: "markdown", content: "first", version: "v1" });
      await vi.waitFor(() => expect(runtime.getSnapshot().content?.content).toBe("first"));
      expect(runtime.getSnapshot().loading).toBe(false);
    } finally { stop(); retireDocumentInputs(getEditorStorageIdentity(port)); }
  });

  it("re-reads identical bytes silently: no loading flash, no new content object, no notification", async () => {
    const { port, readFile } = textPort("same bytes");
    const node: DocumentDataNode = { id: "echo.md", name: "echo.md", path: "echo.md", type: "markdown" };
    const runtime = getDocumentInputRuntime(port, node);
    const notify = vi.fn();
    const stop = runtime.subscribe(notify);
    try {
      await vi.waitFor(() => expect(runtime.getSnapshot().content?.content).toBe("same bytes"));
      const settled = runtime.getSnapshot();
      notify.mockClear();

      runtime.invalidate(createWorkspaceContentChange({ sequence: 10, rootUri: null, paths: ["echo.md"] }), "watch");
      await vi.waitFor(() => expect(readFile).toHaveBeenCalledTimes(2));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(notify).not.toHaveBeenCalled();
      expect(runtime.getSnapshot()).toBe(settled);
    } finally { stop(); retireDocumentInputs(getEditorStorageIdentity(port)); }
  });

  it("publishes changed bytes with a new generation and never shows loading over shown content", async () => {
    const { port, write } = textPort("before");
    const node: DocumentDataNode = { id: "agent.md", name: "agent.md", path: "agent.md", type: "markdown" };
    const runtime = getDocumentInputRuntime(port, node);
    const loading: boolean[] = [];
    const stop = runtime.subscribe(() => loading.push(runtime.getSnapshot().loading));
    try {
      await vi.waitFor(() => expect(runtime.getSnapshot().content?.content).toBe("before"));
      const first = runtime.getSnapshot();
      loading.length = 0;

      write("Agent edit");
      runtime.invalidate(createWorkspaceContentChange({ sequence: 20, rootUri: null, paths: ["agent.md"] }), "watch");
      await vi.waitFor(() => expect(runtime.getSnapshot().content?.content).toBe("Agent edit"));

      expect(loading.every((value) => value === false)).toBe(true);
      expect(runtime.getSnapshot().generation).toBeGreaterThan(first.generation);
      expect(runtime.getSnapshot().content?.version).toBe("v2");
    } finally { stop(); retireDocumentInputs(getEditorStorageIdentity(port)); }
  });

  it("ignores changes to other paths without reading", async () => {
    const { port, readFile } = textPort("untouched");
    const node: DocumentDataNode = { id: "mine.md", name: "mine.md", path: "mine.md", type: "markdown" };
    const runtime = getDocumentInputRuntime(port, node);
    const stop = runtime.subscribe(() => {});
    try {
      await vi.waitFor(() => expect(runtime.getSnapshot().content?.content).toBe("untouched"));
      runtime.invalidate(createWorkspaceContentChange({ sequence: 30, rootUri: null, paths: ["someone-else.md"] }), "watch");
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(readFile).toHaveBeenCalledTimes(1);
    } finally { stop(); retireDocumentInputs(getEditorStorageIdentity(port)); }
  });
});
