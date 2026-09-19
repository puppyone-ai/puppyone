import * as fs from "node:fs";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerWorkspaceFileIpcHandlers } from "../../../../electron/main/ipc/workspace-files-ipc.mjs";
import { createLocalFileCapabilityStore } from "../../../../electron/main/local-file-capabilities.mjs";
import { parseLocalFileUrl } from "../../../../electron/main/local-file-protocol.mjs";
import { createSenderWorkspaceAuthorization } from "../../../../electron/main/workspace-authorization.mjs";
import * as editReview from "../../../../local-api/edit-review.mjs";

let root;
let otherRoot;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "puppyone-ipc-root-"));
  otherRoot = await mkdtemp(path.join(os.tmpdir(), "puppyone-ipc-other-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(otherRoot, { recursive: true, force: true });
});

describe("workspace file IPC authorization", () => {
  it("acknowledges a committed save and rename even if review bookkeeping fails", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const review = vi.spyOn(editReview, "absorbWorkspaceEditReviewPath").mockRejectedValue(new Error("review unavailable"));
    try {
      const { handlers } = createHarness(() => root);
      const event = { sender: { id: 8 } };
      await writeFile(path.join(root, "note.txt"), "one");
      const input = await handlers.get("workspace:read-file")(event, { rootPath: root, path: "note.txt" });
      const saved = await handlers.get("workspace:write-file")(event, { rootPath: root, path: "note.txt", content: "two", expectedVersion: input.version });
      expect(saved.ok).toBe(true);
      const renamed = await handlers.get("workspace:rename-entry")(event, { rootPath: root, path: "note.txt", nextName: "renamed.txt" });
      expect(renamed.path).toBe("renamed.txt");
      expect(await readFile(path.join(root, "renamed.txt"), "utf8")).toBe("two");
      expect(warning).toHaveBeenCalled();
    } finally { warning.mockRestore(); review.mockRestore(); }
  });

  it("rejects a spoofed renderer root for every workspace file handler", async () => {
    const { handlers } = createHarness(() => root);
    const event = { sender: { id: 7 } };
    const requests = new Map([
      ["workspace:list-folder-children", { rootPath: otherRoot, folderPath: null }],
      ["workspace:resolve-node", { rootPath: otherRoot, path: "secret.txt" }],
      ["workspace:read-file", { rootPath: otherRoot, path: "secret.txt" }],
      ["workspace:get-file-url", { rootPath: otherRoot, path: "secret.txt" }],
      ["workspace:create-preview-document", { rootPath: otherRoot, path: "secret.html", content: "<p>preview</p>" }],
      ["workspace:convert-office-docx", { rootPath: otherRoot, path: "secret.rtf" }],
      ["workspace:write-file", { rootPath: otherRoot, path: "secret.txt", content: "changed" }],
      ["workspace:create-entry", { rootPath: otherRoot, parentPath: null, name: "new.txt", kind: "file" }],
      ["workspace:instantiate-template", { rootPath: otherRoot, parentPath: null, name: "Deck", templateId: "slides.default" }],
      ["workspace:rename-entry", { rootPath: otherRoot, path: "secret.txt", nextName: "renamed.txt" }],
      ["workspace:move-entry", { rootPath: otherRoot, fromPath: "secret.txt", toPath: "moved.txt" }],
      ["workspace:copy-entry", { rootPath: otherRoot, fromPath: "secret.txt", targetFolderPath: null }],
      ["workspace:import-entries", { rootPath: otherRoot, sourcePaths: [path.join(otherRoot, "secret.txt")], targetFolderPath: null }],
      ["workspace:delete-entry", { rootPath: otherRoot, path: "secret.txt" }],
      ["workspace:reveal-entry-in-finder", { rootPath: otherRoot, path: "secret.txt" }],
      ["workspace:open-entry-external", { rootPath: otherRoot, path: "secret.txt" }],
    ]);

    await writeFile(path.join(otherRoot, "secret.txt"), "secret");
    for (const [channel, request] of requests) {
      await expect(handlers.get(channel)(event, request)).rejects.toThrow(/does not match the workspace assigned/i);
    }

    expect(await readFile(path.join(otherRoot, "secret.txt"), "utf8")).toBe("secret");
    await expect(readFile(path.join(otherRoot, "new.txt"), "utf8")).rejects.toThrow();
  });

  it("leases bounded projections without writing the file or granting adjacent-resource authority", async () => {
    const { handlers, localFileCapabilities } = createHarness(() => root);
    const event = { sender: { id: 8 } };
    await writeFile(path.join(root, "page.html"), "original");
    const create = handlers.get("workspace:create-preview-document");
    const request = { rootPath: root, path: "page.html", content: "<p>disposable</p>" };
    const { url } = await create(event, request);
    const key = parseLocalFileUrl(url);
    expect(localFileCapabilities.resolve(key).snapshot.bytes.toString()).toBe(request.content);
    expect(localFileCapabilities.resolve({ ...key, requestPath: "other.html" })).toBeNull();
    expect(localFileCapabilities.resolve({ ...key, purpose: "file-preview" })).toBeNull();
    expect(await readFile(path.join(root, "page.html"), "utf8")).toBe("original");
    await expect(create(event, { ...request, content: "x".repeat(2 * 1024 * 1024 + 1) })).rejects.toThrow(/unsupported/i);
    await expect(create(event, { ...request, path: "../outside.html" })).rejects.toThrow();
    expect((await handlers.get("workspace:revoke-file-url")({ sender: { id: 9 } }, { url })).revoked).toBe(false);
    expect((await handlers.get("workspace:revoke-file-url")(event, { url })).revoked).toBe(true);
    expect(localFileCapabilities.resolve(key)).toBeNull();
  });

  it("issues a matching immutable HTML snapshot and rejects a stale text version", async () => {
    const { handlers, localFileCapabilities } = createHarness(() => root);
    const event = { sender: { id: 8 } };
    await writeFile(path.join(root, "page.html"), "<h1>one</h1>");
    const input = await handlers.get("workspace:read-file")(event, { rootPath: root, path: "page.html" });
    const { url } = await handlers.get("workspace:get-file-url")(event, { rootPath: root, path: "page.html", expectedVersion: input.version });
    await writeFile(path.join(root, "page.html"), "<h1>two</h1>");
    expect(localFileCapabilities.resolve(parseLocalFileUrl(url)).snapshot.bytes.toString()).toBe(input.content);
    await expect(handlers.get("workspace:get-file-url")(event, { rootPath: root, path: "page.html", expectedVersion: input.version })).rejects.toThrow(/version changed/i);
  });

  it("uses the sender workspace and accepts a renderer root that resolves to the same directory", async () => {
    const { handlers } = createHarness(() => root);
    const event = { sender: { id: 8 } };
    const notePath = path.join(root, "note.txt");
    await writeFile(notePath, "inside");

    const direct = await handlers.get("workspace:read-file")(event, { rootPath: root, path: "note.txt" });
    expect(direct.content).toBe("inside");

    const aliasParent = await mkdtemp(path.join(os.tmpdir(), "puppyone-ipc-alias-"));
    const aliasPath = path.join(aliasParent, "workspace");
    try {
      await symlink(root, aliasPath, "dir");
      const throughAlias = await handlers.get("workspace:read-file")(event, {
        rootPath: aliasPath,
        path: "note.txt",
      });
      expect(throughAlias.content).toBe("inside");
    } finally {
      await rm(aliasParent, { recursive: true, force: true });
    }
  });

  it("authorizes both ends of a cross-root copy", async () => {
    const { handlers } = createHarness(() => [root, otherRoot]);
    const event = { sender: { id: 81 } };
    await writeFile(path.join(root, "note.txt"), "multi-root");
    await mkdir(path.join(otherRoot, "docs"));

    await expect(handlers.get("workspace:copy-entry-between-roots")(event, {
      sourceRootPath: root,
      targetRootPath: otherRoot,
      fromPath: "note.txt",
      targetFolderPath: "docs",
    })).resolves.toEqual({ path: "docs/note.txt" });
    expect(await readFile(path.join(otherRoot, "docs", "note.txt"), "utf8")).toBe("multi-root");
  });

  it("attributes a successful editor write to its originating window", async () => {
    const workspaceWatchService = { noteInternalWrite: vi.fn() };
    const gitMetadataWatchService = { invalidateWorkingTree: vi.fn() };
    const { handlers } = createHarness(() => root, {
      gitMetadataWatchService,
      workspaceWatchService,
    });
    const notePath = path.join(root, "note.txt");
    await writeFile(notePath, "before");

    const result = await handlers.get("workspace:write-file")(
      { sender: { id: 80 } },
      { rootPath: root, path: "note.txt", content: "after" },
    );

    expect(await readFile(notePath, "utf8")).toBe("after");
    expect(result.ok).toBe(true);
    expect(workspaceWatchService.noteInternalWrite).toHaveBeenCalledWith({
      rootPath: await fs.promises.realpath(root),
      path: "note.txt",
      senderId: 80,
      version: result.version,
    });
    expect(gitMetadataWatchService.invalidateWorkingTree).toHaveBeenCalledWith(
      await fs.promises.realpath(root),
    );
  });

  it("returns a structured conflict with the latest bytes instead of throwing Error metadata", async () => {
    const gitMetadataWatchService = { invalidateWorkingTree: vi.fn() };
    const { handlers } = createHarness(() => root, { gitMetadataWatchService });
    const notePath = path.join(root, "note.txt");
    await writeFile(notePath, "base");
    const opened = await handlers.get("workspace:read-file")(
      { sender: { id: 81 } },
      { rootPath: root, path: "note.txt" },
    );
    await writeFile(notePath, "agent version");

    const result = await handlers.get("workspace:write-file")(
      { sender: { id: 81 } },
      {
        rootPath: root,
        path: "note.txt",
        content: "stale editor version",
        expectedVersion: opened.version,
      },
    );

    expect(result).toMatchObject({
      ok: false,
      kind: "conflict",
      content: "agent version",
    });
    expect(result.version).toMatch(/^sha256:/);
    expect(await readFile(notePath, "utf8")).toBe("agent version");
    expect(gitMetadataWatchService.invalidateWorkingTree).not.toHaveBeenCalled();
  });

  it("returns a structured not-found failure and never attributes a failed write", async () => {
    const workspaceWatchService = { noteInternalWrite: vi.fn() };
    const gitMetadataWatchService = { invalidateWorkingTree: vi.fn() };
    const { handlers } = createHarness(() => root, {
      gitMetadataWatchService,
      workspaceWatchService,
    });

    const result = await handlers.get("workspace:write-file")(
      { sender: { id: 82 } },
      {
        rootPath: root,
        path: "missing-folder/note.txt",
        content: "human version",
        expectedVersion: "sha256:stale",
      },
    );

    expect(result).toMatchObject({
      ok: false,
      kind: "not-found",
    });
    expect(workspaceWatchService.noteInternalWrite).not.toHaveBeenCalled();
    expect(gitMetadataWatchService.invalidateWorkingTree).not.toHaveBeenCalled();
  });

  it("issues a sender-owned URL capability scoped to the exact file", async () => {
    const { handlers, localFileCapabilities } = createHarness(() => root);
    await writeFile(path.join(root, "note.txt"), "inside");
    const result = await handlers.get("workspace:get-file-url")(
      { sender: { id: 81 } },
      { rootPath: root, path: "note.txt" },
    );
    const parsed = parseLocalFileUrl(result.url);

    expect(parsed.requestPath).toBe("note.txt");
    expect(localFileCapabilities.resolve(parsed)).toEqual({
      rootPath: await fs.promises.realpath(root),
      relativePath: "note.txt",
    });
    expect(localFileCapabilities.resolve({ ...parsed, requestPath: "other.txt" })).toBeNull();
  });

  it("issues unique Markdown asset leases and only their sender can revoke them", async () => {
    const { handlers, localFileCapabilities } = createHarness(() => root);
    await writeFile(path.join(root, "image.png"), "png");
    const owner = { sender: { id: 82 } };
    const request = { rootPath: root, path: "image.png", purpose: "markdown-asset" };
    const first = await handlers.get("workspace:get-file-url")(owner, request);
    const second = await handlers.get("workspace:get-file-url")(owner, request);
    const parsed = parseLocalFileUrl(first.url);

    expect(second.url).not.toBe(first.url);
    expect(parsed.purpose).toBe("markdown-asset");
    expect(localFileCapabilities.resolve(parsed)).toEqual({
      rootPath: await fs.promises.realpath(root),
      relativePath: "image.png",
    });
    await expect(handlers.get("workspace:revoke-file-url")(
      { sender: { id: 83 } },
      { url: first.url },
    )).resolves.toEqual({ revoked: false });
    await expect(handlers.get("workspace:revoke-file-url")(
      owner,
      { url: first.url },
    )).resolves.toEqual({ revoked: true });
    expect(localFileCapabilities.resolve(parsed)).toBeNull();
    expect(localFileCapabilities.resolve(parseLocalFileUrl(second.url))).toEqual({
      rootPath: await fs.promises.realpath(root),
      relativePath: "image.png",
    });
  });

  it("resolves a unique macOS screenshot-space alias only for Markdown assets", async () => {
    const { handlers, localFileCapabilities } = createHarness(() => root);
    await mkdir(path.join(root, "asserts"));
    const actualName = "Screenshot 2026-07-15 at 10.07.43\u202fPM.png";
    await writeFile(path.join(root, "asserts", actualName), "png");
    const authoredPath = "asserts/Screenshot 2026-07-15 at 10.07.43 PM.png";
    const event = { sender: { id: 84 } };

    await expect(handlers.get("workspace:get-file-url")(
      event,
      { rootPath: root, path: authoredPath, purpose: "file-preview" },
    )).rejects.toThrow(/unable to resolve workspace entry/i);

    const result = await handlers.get("workspace:get-file-url")(
      event,
      { rootPath: root, path: authoredPath, purpose: "markdown-asset" },
    );
    const parsed = parseLocalFileUrl(result.url);
    expect(localFileCapabilities.resolve(parsed)).toEqual({
      rootPath: await fs.promises.realpath(root),
      relativePath: `asserts/${actualName}`,
    });
  });

  it("rejects local file operations when the sender has no local workspace", async () => {
    const { handlers } = createHarness(() => null);
    await expect(handlers.get("workspace:read-file")(
      { sender: { id: 9 } },
      { rootPath: root, path: "note.txt" },
    )).rejects.toThrow(/no local workspace is assigned/i);
  });

  it("rejects direct symbolic-link access before revealing or reading the target", async () => {
    const { handlers, shell } = createHarness(() => root);
    const externalFile = path.join(otherRoot, "secret.txt");
    const linkedFile = path.join(root, "linked.txt");
    await writeFile(externalFile, "secret");
    await symlink(externalFile, linkedFile);

    const event = { sender: { id: 10 } };
    await expect(handlers.get("workspace:read-file")(
      event,
      { rootPath: root, path: "linked.txt" },
    )).rejects.toThrow(/symbolic links/i);
    await expect(handlers.get("workspace:reveal-entry-in-finder")(
      event,
      { rootPath: root, path: "linked.txt" },
    )).rejects.toThrow(/symbolic links/i);
    expect(shell.showItemInFolder).not.toHaveBeenCalled();
  });

  it("copies only inside the sender-authorized workspace", async () => {
    const { handlers } = createHarness(() => root);
    await writeFile(path.join(root, "source.txt"), "inside");

    await expect(handlers.get("workspace:copy-entry")(
      { sender: { id: 101 } },
      { rootPath: root, fromPath: "source.txt", targetFolderPath: null },
    )).resolves.toEqual({ path: "source copy.txt" });
    expect(await readFile(path.join(root, "source copy.txt"), "utf8")).toBe("inside");
  });

  it("always delegates external file opening to the system default app", async () => {
    const notePath = path.join(root, "note.txt");
    await writeFile(notePath, "inside");
    const { handlers, shell } = createHarness(() => root);

    await expect(handlers.get("workspace:open-entry-external")(
      { sender: { id: 102 } },
      {
        rootPath: root,
        path: "note.txt",
        // Retired override fields from an older renderer must be inert.
        strategy: "app",
        appPath: "/Applications/Other.app",
      },
    )).resolves.toEqual({ ok: true });
    expect(shell.openPath).toHaveBeenCalledExactlyOnceWith(await fs.promises.realpath(notePath));
  });

  it("cannot bypass executable confirmation and revalidates after the dialog", async () => {
    const executablePath = path.join(root, "run.cmd");
    const externalFile = path.join(otherRoot, "replacement.cmd");
    await writeFile(executablePath, "echo safe");
    await writeFile(externalFile, "echo outside");
    const dialog = {
      showMessageBox: vi.fn(async () => {
        await rm(executablePath, { force: true });
        await symlink(externalFile, executablePath);
        return { response: 0 };
      }),
    };
    const { handlers, shell } = createHarness(() => root, { dialog });

    await expect(handlers.get("workspace:open-entry-external")(
      { sender: { id: 11 } },
      {
        rootPath: root,
        path: "run.cmd",
        // A forged or legacy renderer payload must not disable the main-process policy.
        confirmExecutableFiles: false,
      },
    )).rejects.toThrow(/symbolic links/i);
    expect(dialog.showMessageBox).toHaveBeenCalledOnce();
    expect(shell.openPath).not.toHaveBeenCalled();
  });

  it("cancels an in-flight Office conversion and removes the completed session", async () => {
    const convertOfficeDocument = createAbortableOfficeConverter();
    const { handlers } = createHarness(() => root, { convertOfficeDocument });
    const event = { sender: { id: 21 } };
    const startPromise = handlers.get("workspace:convert-office-docx")(event, {
      rootPath: root,
      path: "sample.rtf",
      requestId: "conversion-1",
    });
    const startResult = startPromise.catch((error) => error);
    await vi.waitFor(() => expect(convertOfficeDocument).toHaveBeenCalledOnce());

    await expect(handlers.get("workspace:convert-office-docx-cancel")(event, {
      requestId: "conversion-1",
    })).resolves.toEqual({ cancelled: true });
    expect(await startResult).toMatchObject({ message: "Office conversion was cancelled." });
    await expect(handlers.get("workspace:convert-office-docx-cancel")(event, {
      requestId: "conversion-1",
    })).resolves.toEqual({ cancelled: false });
  });

  it("does not let another renderer cancel an Office conversion", async () => {
    const convertOfficeDocument = createAbortableOfficeConverter();
    const { handlers } = createHarness(() => root, { convertOfficeDocument });
    const ownerEvent = { sender: { id: 22 } };
    const otherEvent = { sender: { id: 23 } };
    const startPromise = handlers.get("workspace:convert-office-docx")(ownerEvent, {
      rootPath: root,
      path: "sample.rtf",
      requestId: "shared-request-id",
    });
    const startResult = startPromise.catch((error) => error);
    await vi.waitFor(() => expect(convertOfficeDocument).toHaveBeenCalledOnce());

    await expect(handlers.get("workspace:convert-office-docx-cancel")(otherEvent, {
      requestId: "shared-request-id",
    })).resolves.toEqual({ cancelled: false });
    expect(convertOfficeDocument.mock.calls[0][2].signal.aborted).toBe(false);

    await handlers.get("workspace:convert-office-docx-cancel")(ownerEvent, {
      requestId: "shared-request-id",
    });
    expect(await startResult).toMatchObject({ message: "Office conversion was cancelled." });
  });

  it("cleans up successful conversions and enforces the per-window concurrency limit", async () => {
    const successfulConverter = vi.fn(async () => ({ bytes: Buffer.from("docx"), warnings: [] }));
    const successfulHarness = createHarness(() => root, { convertOfficeDocument: successfulConverter });
    const successEvent = { sender: { id: 24 } };
    await expect(successfulHarness.handlers.get("workspace:convert-office-docx")(successEvent, {
      rootPath: root,
      path: "sample.rtf",
      requestId: "success-1",
    })).resolves.toEqual({ bytes: Buffer.from("docx"), warnings: [] });
    await expect(successfulHarness.handlers.get("workspace:convert-office-docx-cancel")(successEvent, {
      requestId: "success-1",
    })).resolves.toEqual({ cancelled: false });

    const pendingConverter = createAbortableOfficeConverter();
    const { handlers } = createHarness(() => root, { convertOfficeDocument: pendingConverter });
    const event = { sender: { id: 25 } };
    const firstResult = handlers.get("workspace:convert-office-docx")(event, {
      rootPath: root,
      path: "one.rtf",
      requestId: "limit-1",
    }).catch((error) => error);
    const secondResult = handlers.get("workspace:convert-office-docx")(event, {
      rootPath: root,
      path: "two.rtf",
      requestId: "limit-2",
    }).catch((error) => error);
    await vi.waitFor(() => expect(pendingConverter).toHaveBeenCalledTimes(2));

    await expect(handlers.get("workspace:convert-office-docx")(event, {
      rootPath: root,
      path: "three.rtf",
      requestId: "limit-3",
    })).rejects.toThrow(/only 2 Office conversions/i);

    await handlers.get("workspace:convert-office-docx-cancel")(event, { requestId: "limit-1" });
    await handlers.get("workspace:convert-office-docx-cancel")(event, { requestId: "limit-2" });
    expect(await firstResult).toMatchObject({ message: "Office conversion was cancelled." });
    expect(await secondResult).toMatchObject({ message: "Office conversion was cancelled." });
  });

  it("aborts and cleans up Office conversions when their renderer is destroyed", async () => {
    const convertOfficeDocument = createAbortableOfficeConverter();
    const { handlers } = createHarness(() => root, { convertOfficeDocument });
    const sender = new EventEmitter();
    sender.id = 26;
    const event = { sender };
    const startResult = handlers.get("workspace:convert-office-docx")(event, {
      rootPath: root,
      path: "window-close.rtf",
      requestId: "window-close-1",
    }).catch((error) => error);
    await vi.waitFor(() => expect(convertOfficeDocument).toHaveBeenCalledOnce());

    sender.emit("destroyed");
    expect(await startResult).toMatchObject({ message: "Office conversion was cancelled." });
    await expect(handlers.get("workspace:convert-office-docx-cancel")(event, {
      requestId: "window-close-1",
    })).resolves.toEqual({ cancelled: false });
    expect(sender.listenerCount("destroyed")).toBe(0);
  });
});

function createHarness(
  getWorkspaceRootForSender,
  { convertOfficeDocument, dialog, gitMetadataWatchService, workspaceWatchService } = {},
) {
  const handlers = new Map();
  const ipcMain = {
    handle: (channel, handler) => handlers.set(channel, handler),
  };
  const shell = {
    showItemInFolder: vi.fn(),
    openPath: vi.fn(async () => ""),
  };
  const localFileCapabilities = createLocalFileCapabilityStore();

  registerWorkspaceFileIpcHandlers({
    app: {},
    ipcMain,
    BrowserWindow: { fromWebContents: () => null },
    dialog: dialog ?? { showMessageBox: vi.fn(async () => ({ response: 1 })) },
    fs,
    shell,
    authorizeWorkspaceRoot: createSenderWorkspaceAuthorization({
      getWorkspaceRootsForSender: async (sender) => {
        const value = await getWorkspaceRootForSender(sender);
        return Array.isArray(value) ? value : [value];
      },
      fsModule: fs,
    }),
    localFileCapabilities,
    gitMetadataWatchService,
    workspaceWatchService,
    convertOfficeDocument,
  });

  return { handlers, shell, localFileCapabilities };
}

function createAbortableOfficeConverter() {
  return vi.fn((_rootPath, _filePath, { signal }) => new Promise((_resolve, reject) => {
    const rejectCancelled = () => reject(new Error("Office conversion was cancelled."));
    if (signal.aborted) {
      rejectCancelled();
      return;
    }
    signal.addEventListener("abort", rejectCancelled, { once: true });
  }));
}
