/**
 * @vitest-environment happy-dom
 */
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DataWorkspace } from "../../../../packages/shared-ui/src/data/DataWorkspace";
import type { FileContent } from "../../../../packages/shared-ui/src/core/types";
import { flushActiveDocumentSessions } from "../../../../packages/shared-ui/src/editor/document-session/activeDocumentSessions";
import { closeAllDocumentWorkingCopies } from "../../../../packages/shared-ui/src/editor/document-session/documentWorkingCopies";
import { createLocalDataPort } from "../../../../src/lib/localFiles";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let temporaryWorkspace: string | null = null;
let originalDesktopBridge: Window["puppyoneDesktop"];

afterEach(async () => {
  act(() => root?.unmount());
  root = null;
  await closeAllDocumentWorkingCopies("app-close").catch(() => undefined);
  await flushActiveDocumentSessions("app-close").catch(() => undefined);
  document.body.innerHTML = "";
  window.puppyoneDesktop = originalDesktopBridge;
  if (temporaryWorkspace) await rm(temporaryWorkspace, { recursive: true, force: true });
  temporaryWorkspace = null;
});

describe("local HTML editor persistence", () => {
  it("persists a CodeMirror source edit through DataWorkspace and the desktop bridge", async () => {
    temporaryWorkspace = await mkdtemp(join(tmpdir(), "puppyone-html-editor-"));
    const initial = "<!doctype html><h1>Before</h1>";
    await writeFile(join(temporaryWorkspace, "page.html"), initial, "utf8");
    const writeWorkspaceFile = vi.fn(async (request: {
      rootPath: string;
      path: string;
      content: string;
      expectedVersion?: string | null;
    }) => {
      const absolutePath = join(request.rootPath, request.path);
      const current = await readFile(absolutePath, "utf8");
      if (request.expectedVersion && request.expectedVersion !== fingerprint(current)) {
        throw new Error("local file version conflict");
      }
      await writeFile(absolutePath, request.content, "utf8");
      return { ok: true as const, version: fingerprint(request.content) };
    });
    originalDesktopBridge = window.puppyoneDesktop;
    window.puppyoneDesktop = {
      listFolderChildren: vi.fn(async () => [{
        id: "page.html",
        path: "page.html",
        name: "page.html",
        type: "html",
      }]),
      readFile: vi.fn(async ({ path }: { path: string }): Promise<FileContent> => {
        const content = await readFile(join(temporaryWorkspace!, path), "utf8");
        return { path, name: path, type: "html", content, version: fingerprint(content) };
      }),
      getFileUrl: vi.fn(async () => ({ url: "puppyone-local://workspace/page.html?token=test" })),
      revokeFileUrl: vi.fn(async () => ({ revoked: true })),
      writeFile: writeWorkspaceFile,
    } as unknown as Window["puppyoneDesktop"];

    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(withTestLocalization(
        <DataWorkspace
          workspace={{ id: temporaryWorkspace!, name: "Local", path: temporaryWorkspace!, status: "recording" }}
          dataPort={createLocalDataPort(temporaryWorkspace!)}
          defaultActivePath="page.html"
          editorSaveMode="auto"
          showHeader={false}
          showPreviewHeader={false}
          enableMarkdownLinkContentIndexing={false}
        />,
      ));
    });

    await waitFor(() => !!container.querySelector('.html-editor-options > button'));
    await act(async () => container.querySelector<HTMLButtonElement>('.html-editor-options > button')?.click());
    const editor = await waitForEditor(container);
    act(() => editor.dispatch({
      changes: { from: editor.state.doc.length, insert: "<!-- After -->" },
      userEvent: "input.type",
    }));
    await waitFor(async () => (
      await readFile(join(temporaryWorkspace!, "page.html"), "utf8")
    ).endsWith("<!-- After -->"));

    expect(writeWorkspaceFile).toHaveBeenCalledWith(expect.objectContaining({
      rootPath: temporaryWorkspace,
      path: "page.html",
      content: `${initial}<!-- After -->`,
      expectedVersion: fingerprint(initial),
    }));
  });
});

async function waitForEditor(container: HTMLElement): Promise<EditorView> {
  let view: EditorView | null = null;
  await waitFor(() => {
    const editor = container.querySelector<HTMLElement>(".cm-editor");
    if (!editor) return false;
    view = EditorView.findFromDOM(editor);
    return true;
  });
  if (!view) throw new Error(`HTML editor did not mount: ${container.textContent ?? ""}`);
  return view;
}

async function waitFor(assertion: () => boolean | Promise<boolean>, attempts = 200): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await assertion()) return;
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 5)));
  }
  throw new Error("Timed out waiting for local HTML editor state.");
}

function fingerprint(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}
