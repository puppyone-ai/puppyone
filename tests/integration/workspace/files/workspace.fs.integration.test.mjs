// Deep integration tests for the local-mode workspace engine (local-api/workspace.mjs).
// These exercise the real filesystem: every test runs against a fresh temp
// directory with real files, real folders, and real byte content — no mocks.
// This is the "端" (desktop/local) side of the product: create/read/write/rename/
// move/copy/delete/import + the path-containment security boundaries.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmod, mkdtemp, rm, mkdir, writeFile, readFile, stat, symlink, lstat, realpath, rename } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  workspaceFromPath,
  listFolderChildren,
  openWorkspaceFileRangeStream,
  readWorkspaceFile,
  readWorkspaceTextFile,
  writeWorkspaceTextFile,
  readWorkspaceBinaryFileVersion,
  writeWorkspaceBinaryFile,
  createWorkspaceEntry,
  renameWorkspaceEntry,
  resolveExistingWorkspaceDisplayPath,
  resolveWorkspaceNode,
  moveWorkspaceEntry,
  copyWorkspaceEntry,
  copyWorkspaceEntryBetweenRoots,
  deleteWorkspaceEntry,
  importWorkspaceEntries,
  readPuppyoneWorkspaceConfig,
  writePuppyoneWorkspaceConfig,
} from "../../../../local-api/workspace.mjs";
import {
  convertMacosOfficeDocumentToDocx,
} from "../../../../electron/main/platform/macos/office-document-converter.mjs";

let root;
let external;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "puppyone-ws-"));
  external = await mkdtemp(path.join(os.tmpdir(), "puppyone-ext-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(external, { recursive: true, force: true });
});

describe("workspaceFromPath", () => {
  it("returns identity for a real folder", async () => {
    const ws = await workspaceFromPath(root);
    expect(ws.path).toBe(await realpath(root));
    expect(ws.name).toBe(path.basename(root));
    expect(ws.status).toBe("protected");
    expect(ws.cloudState).toBe("local");
    expect(ws.commitCount).toBe(0); // not a git repo yet
    expect(typeof ws.id).toBe("string");
    expect(ws).not.toHaveProperty("markdownDialect");
  });

  it("declares the OpenKnowledge Markdown dialect from project metadata", async () => {
    await mkdir(path.join(root, ".ok"));
    await writeFile(path.join(root, ".ok", "config.yml"), "version: 1\n");

    const ws = await workspaceFromPath(root);

    expect(ws.markdownDialect).toBe("openknowledge-mdx");
  });

  it.each([
    ["an empty .ok directory", async () => {
      await mkdir(path.join(root, ".ok"));
    }],
    ["a similarly named config.yaml", async () => {
      await mkdir(path.join(root, ".ok"));
      await writeFile(path.join(root, ".ok", "config.yaml"), "version: 1\n");
    }],
    ["a config.yml directory", async () => {
      await mkdir(path.join(root, ".ok", "config.yml"), { recursive: true });
    }],
  ])("does not infer the dialect from %s", async (_label, arrange) => {
    await arrange();

    const ws = await workspaceFromPath(root);

    expect(ws).not.toHaveProperty("markdownDialect");
  });

  it("is stable: same path -> same id", async () => {
    const a = await workspaceFromPath(root);
    const b = await workspaceFromPath(root);
    expect(a.id).toBe(b.id);
  });

  it("does not mutate an uninitialized folder and preserves instance identity across a rename", async () => {
    const before = await workspaceFromPath(root);
    await expect(lstat(path.join(root, ".puppyone"))).rejects.toMatchObject({ code: "ENOENT" });
    const moved = `${root}-moved`;
    await rename(root, moved);
    root = moved;

    const after = await workspaceFromPath(root);
    expect(after.workspaceInstanceId).toBe(before.workspaceInstanceId);
    expect(after.id).toBe(before.id);
    expect(after).not.toHaveProperty("projectId");
    await expect(lstat(path.join(root, ".puppyone"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a file path (not a folder)", async () => {
    const file = path.join(root, "note.txt");
    await writeFile(file, "hi");
    await expect(workspaceFromPath(file)).rejects.toThrow(/not a folder/i);
  });
});

describe("createWorkspaceEntry", () => {
  it("creates a file with exact byte content", async () => {
    const body = "# Title\n\nHello **world** — 你好\n";
    const res = await createWorkspaceEntry(root, { parentPath: null, name: "readme.md", kind: "file", content: body });
    expect(res.path).toBe("readme.md");
    const onDisk = await readFile(path.join(root, "readme.md"), "utf8");
    expect(onDisk).toBe(body);
  });

  it("creates an empty file when no content given", async () => {
    await createWorkspaceEntry(root, { parentPath: null, name: "empty.txt", kind: "file" });
    expect(await readFile(path.join(root, "empty.txt"), "utf8")).toBe("");
  });

  it("creates a folder", async () => {
    const res = await createWorkspaceEntry(root, { parentPath: null, name: "src", kind: "folder" });
    expect(res.path).toBe("src");
    expect((await stat(path.join(root, "src"))).isDirectory()).toBe(true);
  });

  it("creates nested entries under a parent folder", async () => {
    await createWorkspaceEntry(root, { parentPath: null, name: "docs", kind: "folder" });
    const res = await createWorkspaceEntry(root, { parentPath: "docs", name: "guide.md", kind: "file", content: "x" });
    expect(res.path).toBe("docs/guide.md");
    expect(await readFile(path.join(root, "docs", "guide.md"), "utf8")).toBe("x");
  });

  it("refuses to overwrite an existing file (wx flag)", async () => {
    await createWorkspaceEntry(root, { parentPath: null, name: "a.txt", kind: "file", content: "1" });
    await expect(
      createWorkspaceEntry(root, { parentPath: null, name: "a.txt", kind: "file", content: "2" }),
    ).rejects.toThrow(/Unable to create file/i);
    expect(await readFile(path.join(root, "a.txt"), "utf8")).toBe("1");
  });

  it("rejects invalid entry names (slash, dotdot, absolute)", async () => {
    for (const name of ["../evil", "a/b", "..", ".", "/abs"]) {
      await expect(
        createWorkspaceEntry(root, { parentPath: null, name, kind: "file" }),
      ).rejects.toThrow();
    }
  });

  it("rejects an unknown kind", async () => {
    await expect(
      createWorkspaceEntry(root, { parentPath: null, name: "x", kind: "device" }),
    ).rejects.toThrow(/file or folder/i);
  });
});

describe("read / write round-trips", () => {
  it("reads back text content with metadata", async () => {
    await createWorkspaceEntry(root, { parentPath: null, name: "note.md", kind: "file", content: "line1\nline2" });
    const file = await readWorkspaceTextFile(root, "note.md");
    expect(file.path).toBe("note.md");
    expect(file.name).toBe("note.md");
    expect(file.content).toBe("line1\nline2");
    expect(file.mimeType).toMatch(/text|markdown/i);
    expect(file.size).toBeTruthy();
  });

  it("updates content via writeWorkspaceTextFile", async () => {
    await createWorkspaceEntry(root, { parentPath: null, name: "c.txt", kind: "file", content: "old" });
    const before = await readWorkspaceTextFile(root, "c.txt");
    const result = await writeWorkspaceTextFile(root, "c.txt", "new content", {
      expectedVersion: before.version,
    });
    const after = await readWorkspaceTextFile(root, "c.txt");
    expect(after.content).toBe("new content");
    expect(result.version).toBe(after.version);
    expect(after.version).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("rejects a stale conditional write instead of overwriting an external edit", async () => {
    await createWorkspaceEntry(root, { parentPath: null, name: "conflict.txt", kind: "file", content: "base" });
    const opened = await readWorkspaceTextFile(root, "conflict.txt");
    await writeFile(path.join(root, "conflict.txt"), "external", "utf8");

    await expect(writeWorkspaceTextFile(root, "conflict.txt", "stale editor", {
      expectedVersion: opened.version,
    })).rejects.toThrow(/changed outside PuppyOne/i);
    expect(await readFile(path.join(root, "conflict.txt"), "utf8")).toBe("external");
  });

  it("serializes same-path writers so one stale concurrent commit cannot win", async () => {
    await createWorkspaceEntry(root, { parentPath: null, name: "concurrent.txt", kind: "file", content: "base" });
    const opened = await readWorkspaceTextFile(root, "concurrent.txt");

    const first = writeWorkspaceTextFile(root, "concurrent.txt", "first", {
      expectedVersion: opened.version,
    });
    const second = writeWorkspaceTextFile(root, "concurrent.txt", "second", {
      expectedVersion: opened.version,
    });
    const [firstResult, secondResult] = await Promise.allSettled([first, second]);

    const results = [firstResult, secondResult];
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(results.filter(({ status }) => status === "rejected")).toHaveLength(1);
    const rejected = results.find(({ status }) => status === "rejected");
    if (rejected?.status === "rejected") {
      expect(String(rejected.reason)).toMatch(/changed outside PuppyOne/i);
    }
    const winningContent = firstResult.status === "fulfilled" ? "first" : "second";
    expect(await readFile(path.join(root, "concurrent.txt"), "utf8")).toBe(winningContent);
  });

  it("uses the same conditional atomic writer for binary Office bytes", async () => {
    const filePath = path.join(root, "book.xlsx");
    await writeFile(filePath, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x01]));
    const opened = await readWorkspaceBinaryFileVersion(root, "book.xlsx");
    const edited = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x02]);

    const result = await writeWorkspaceBinaryFile(root, "book.xlsx", edited, {
      expectedVersion: opened.version,
    });

    expect(await readFile(filePath)).toEqual(edited);
    expect(result.version).toMatch(/^sha256:[0-9a-f]{64}$/);
    await expect(writeWorkspaceBinaryFile(root, "book.xlsx", Buffer.from("stale"), {
      expectedVersion: opened.version,
    })).rejects.toMatchObject({ code: "WORKSPACE_VERSION_CONFLICT" });
    expect(await readFile(filePath)).toEqual(edited);
  });

  it("preserves local file mode across atomic replacement", async () => {
    if (process.platform === "win32") return;
    await createWorkspaceEntry(root, { parentPath: null, name: "mode.txt", kind: "file", content: "base" });
    const filePath = path.join(root, "mode.txt");
    // 0666 is deliberately broader than the common 0022 process umask.
    await chmod(filePath, 0o666);
    const opened = await readWorkspaceTextFile(root, "mode.txt");

    await writeWorkspaceTextFile(root, "mode.txt", "updated", {
      expectedVersion: opened.version,
    });

    expect((await stat(filePath)).mode & 0o777).toBe(0o666);
  });

  it("rejects non-string write content", async () => {
    await createWorkspaceEntry(root, { parentPath: null, name: "c.txt", kind: "file", content: "x" });
    await expect(writeWorkspaceTextFile(root, "c.txt", 123)).rejects.toThrow(/must be text/i);
  });

  it("returns raw bytes via readWorkspaceFile", async () => {
    const bytes = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // ZIP magic
    await writeFile(path.join(root, "a.bin"), bytes);
    const out = await readWorkspaceFile(root, "a.bin");
    expect(Buffer.compare(out, bytes)).toBe(0);
  });

  it("returns partial bytes for puppyone-local Range reads", async () => {
    await writeFile(path.join(root, "letters.txt"), "abcdefghijklmnopqrstuvwxyz");
    const out = await readWorkspaceFile(root, "letters.txt", { rangeHeader: "bytes=2-5" });
    expect(out.partial).toBe(true);
    expect(out.start).toBe(2);
    expect(out.end).toBe(5);
    expect(out.size).toBe(26);
    expect(out.bytes.toString("utf8")).toBe("cdef");
  });

  it("resolves one unique Unicode-space display alias but keeps exact names authoritative", async () => {
    await mkdir(path.join(root, "asserts"));
    const asciiName = "Screenshot 10.07.43 PM.png";
    const narrowName = "Screenshot 10.25.51\u202fPM.png";
    await writeFile(path.join(root, "asserts", asciiName), "ascii");
    await writeFile(path.join(root, "asserts", narrowName), "narrow");

    await expect(resolveExistingWorkspaceDisplayPath(
      root,
      "asserts/Screenshot 10.25.51 PM.png",
    )).resolves.toBe(await realpath(path.join(root, "asserts", narrowName)));
    await expect(resolveExistingWorkspaceDisplayPath(
      root,
      `asserts/${asciiName}`,
    )).resolves.toBe(await realpath(path.join(root, "asserts", asciiName)));

    const ambiguousAscii = "Screenshot ambiguous PM.png";
    const ambiguousNarrow = "Screenshot ambiguous\u202fPM.png";
    await writeFile(path.join(root, "asserts", ambiguousAscii), "ascii");
    await writeFile(path.join(root, "asserts", ambiguousNarrow), "narrow");
    await expect(resolveExistingWorkspaceDisplayPath(
      root,
      "asserts/Screenshot ambiguous\u2009PM.png",
    )).rejects.toThrow(/ambiguous/i);
  });

  it("streams an exact open-ended media range without buffering the file", async () => {
    const bytes = Buffer.from("0123456789abcdefghijklmnopqrstuvwxyz");
    await writeFile(path.join(root, "video.mp4"), bytes);

    const result = await openWorkspaceFileRangeStream(root, "video.mp4", "bytes=10-");
    expect(result.partial).toBe(true);
    expect(result.start).toBe(10);
    expect(result.end).toBe(bytes.length - 1);
    expect(result.size).toBe(bytes.length);

    const chunks = [];
    for await (const chunk of result.stream) chunks.push(chunk);
    expect(Buffer.concat(chunks).toString("utf8")).toBe(bytes.subarray(10).toString("utf8"));
  });

  it("readWorkspaceFile (puppyone-local protocol path) rejects a directory and traversal", async () => {
    await createWorkspaceEntry(root, { parentPath: null, name: "dir", kind: "folder" });
    await expect(readWorkspaceFile(root, "dir")).rejects.toThrow(/folder/i);
    await expect(readWorkspaceFile(root, "../../etc/passwd")).rejects.toThrow(/outside the selected workspace/i);
  });

  it("rejects direct reads, writes, and conversion through symbolic links", async () => {
    const externalFile = path.join(external, "secret.rtf");
    await writeFile(externalFile, "{\\rtf1\\ansi SECRET}");
    try {
      await symlink(externalFile, path.join(root, "linked.rtf"));
    } catch {
      return;
    }

    await expect(readWorkspaceFile(root, "linked.rtf")).rejects.toThrow(/symbolic links/i);
    await expect(readWorkspaceTextFile(root, "linked.rtf")).rejects.toThrow(/symbolic links/i);
    await expect(writeWorkspaceTextFile(root, "linked.rtf", "changed")).rejects.toThrow(/symbolic links/i);
    if (process.platform === "darwin") {
      await expect(convertMacosOfficeDocumentToDocx(root, "linked.rtf")).rejects.toThrow(/symbolic links/i);
    }
    expect(await readFile(externalFile, "utf8")).toBe("{\\rtf1\\ansi SECRET}");
  });

  it("converts RTF to DOCX bytes on macOS", async () => {
    if (process.platform !== "darwin") return;

    await writeFile(path.join(root, "sample.rtf"), "{\\rtf1\\ansi PuppyOne}");
    const out = await convertMacosOfficeDocumentToDocx(root, "sample.rtf");
    expect(out.bytes.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  });

  it("honors an already-aborted Office conversion signal", async () => {
    if (process.platform !== "darwin") return;

    await writeFile(path.join(root, "cancelled.rtf"), "{\\rtf1\\ansi PuppyOne}");
    const controller = new AbortController();
    controller.abort();
    await expect(convertMacosOfficeDocumentToDocx(root, "cancelled.rtf", {
      signal: controller.signal,
    })).rejects.toThrow(/cancelled/i);
  });

  it("surfaces binary files (null bytes) with content=null", async () => {
    await writeFile(path.join(root, "img.bin"), Buffer.from([0x00, 0x01, 0x02, 0x00]));
    const file = await readWorkspaceTextFile(root, "img.bin");
    expect(file.content).toBeNull();
  });

  it("errors when reading a folder as text", async () => {
    await createWorkspaceEntry(root, { parentPath: null, name: "dir", kind: "folder" });
    await expect(readWorkspaceTextFile(root, "dir")).rejects.toThrow(/folder/i);
  });
});

describe("workspace config containment", () => {
  it("writes config atomically as a regular in-workspace file", async () => {
    const result = await writePuppyoneWorkspaceConfig(root, {
      version: 1,
      cloud: { projectId: "safe-project" },
    });
    expect(result.version).toBe(3);
    expect(result).not.toHaveProperty("project");
    expect(result).not.toHaveProperty("cloud");
    expect((await lstat(path.join(root, ".puppyone", "config.json"))).isFile()).toBe(true);
    expect(await readPuppyoneWorkspaceConfig(root)).not.toHaveProperty("cloud");
  });

  it("keeps shared config free of Project identity while assigning each checkout a local instance", async () => {
    await writePuppyoneWorkspaceConfig(root, {
      version: 1,
      project: { id: "01234567-89ab-4def-8123-456789abcdef" },
      cloud: { projectId: "cloud-project" },
    });
    const clone = path.join(external, "clone");
    await mkdir(path.join(clone, ".puppyone"), { recursive: true });
    await writeFile(
      path.join(clone, ".puppyone", "config.json"),
      await readFile(path.join(root, ".puppyone", "config.json")),
    );

    const sourceWorkspace = await workspaceFromPath(root, { includeGitMetadata: false });
    const cloneWorkspace = await workspaceFromPath(clone, { includeGitMetadata: false });
    expect(sourceWorkspace).not.toHaveProperty("projectId");
    expect(cloneWorkspace).not.toHaveProperty("projectId");
    expect(cloneWorkspace.workspaceInstanceId).not.toBe(sourceWorkspace.workspaceInstanceId);
    expect(await readPuppyoneWorkspaceConfig(clone)).not.toHaveProperty("project");
  });

  it("rejects a symlinked config directory instead of reading or writing outside", async () => {
    await mkdir(path.join(external, "config-target"));
    await writeFile(path.join(external, "config-target", "config.json"), '{"project":{"name":"secret"}}');
    await symlink(path.join(external, "config-target"), path.join(root, ".puppyone"));

    await expect(readPuppyoneWorkspaceConfig(root)).rejects.toThrow(/real directory/i);
    await expect(writePuppyoneWorkspaceConfig(root, { version: 1 })).rejects.toThrow(/real directory/i);
  });
});

describe("listFolderChildren", () => {
  it("lists entries folders-first then alphabetical, with content preview for small files", async () => {
    await createWorkspaceEntry(root, { parentPath: null, name: "zeta.txt", kind: "file", content: "z" });
    await createWorkspaceEntry(root, { parentPath: null, name: "alpha.txt", kind: "file", content: "a" });
    await createWorkspaceEntry(root, { parentPath: null, name: "beta", kind: "folder" });

    const nodes = await listFolderChildren(root, null);
    expect(nodes.map((n) => n.name)).toEqual(["beta", "alpha.txt", "zeta.txt"]);
    expect(nodes[0].type).toBe("folder");
    expect(nodes[0].mimeType).toBeNull();
    const alpha = nodes.find((n) => n.name === "alpha.txt");
    expect(alpha.content).toBe("a"); // small text file preview
    expect(alpha.path).toBe("alpha.txt");
    expect(alpha.mimeType).toMatch(/^text\/plain/);
  });

  it("publishes the concrete MIME for each Office family extension", async () => {
    await writeFile(path.join(root, "legacy.doc"), "placeholder");
    await writeFile(path.join(root, "modern.docx"), "placeholder");
    await writeFile(path.join(root, "macro.xlsm"), "placeholder");

    const nodes = await listFolderChildren(root, null);
    expect(nodes.find((node) => node.name === "legacy.doc")?.mimeType).toBe("application/msword");
    expect(nodes.find((node) => node.name === "modern.docx")?.mimeType).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(nodes.find((node) => node.name === "macro.xlsm")?.mimeType).toBe(
      "application/vnd.ms-excel.sheet.macroEnabled.12",
    );
  });

  it("skips symbolic links (no symlink escape)", async () => {
    await writeFile(path.join(root, "real.txt"), "real");
    const secret = path.join(external, "secret.txt");
    await writeFile(secret, "SECRET");
    try {
      await symlink(secret, path.join(root, "link.txt"));
    } catch {
      return; // symlink not permitted on this platform/user — skip
    }
    const nodes = await listFolderChildren(root, null);
    expect(nodes.map((n) => n.name)).toContain("real.txt");
    expect(nodes.map((n) => n.name)).not.toContain("link.txt");
  });
});

describe("resolveWorkspaceNode", () => {
  it("classifies one file or folder without loading preview content", async () => {
    await createWorkspaceEntry(root, { parentPath: null, name: "docs", kind: "folder" });
    await createWorkspaceEntry(root, {
      parentPath: null,
      name: "table.csv",
      kind: "file",
      content: "a,b\n1,2",
    });

    await expect(resolveWorkspaceNode(root, "docs")).resolves.toMatchObject({
      path: "docs",
      type: "folder",
      content: null,
      preview: null,
    });
    await expect(resolveWorkspaceNode(root, "table.csv")).resolves.toMatchObject({
      path: "table.csv",
      type: "spreadsheet",
      content: null,
      preview: null,
    });
  });
});

describe("rename / move / delete", () => {
  it("renames a file", async () => {
    await createWorkspaceEntry(root, { parentPath: null, name: "old.txt", kind: "file", content: "keep" });
    const res = await renameWorkspaceEntry(root, { path: "old.txt", nextName: "new.txt" });
    expect(res.path).toBe("new.txt");
    expect(await readFile(path.join(root, "new.txt"), "utf8")).toBe("keep");
    await expect(stat(path.join(root, "old.txt"))).rejects.toThrow();
  });

  it("refuses to rename onto an existing name", async () => {
    await createWorkspaceEntry(root, { parentPath: null, name: "a.txt", kind: "file", content: "a" });
    await createWorkspaceEntry(root, { parentPath: null, name: "b.txt", kind: "file", content: "b" });
    await expect(renameWorkspaceEntry(root, { path: "a.txt", nextName: "b.txt" })).rejects.toThrow(/already exists/i);
  });

  it("rejects direct symbolic-link sources and symbolic-link target folders", async () => {
    const externalFile = path.join(external, "secret.txt");
    const externalFolder = path.join(external, "folder");
    await writeFile(externalFile, "SECRET");
    await mkdir(externalFolder);
    await writeFile(path.join(root, "real.txt"), "REAL");
    try {
      await symlink(externalFile, path.join(root, "linked.txt"));
      await symlink(externalFolder, path.join(root, "escape"));
    } catch {
      return;
    }

    await expect(renameWorkspaceEntry(root, { path: "linked.txt", nextName: "renamed.txt" }))
      .rejects.toThrow(/symbolic links/i);
    await expect(deleteWorkspaceEntry(root, { path: "linked.txt" }))
      .rejects.toThrow(/symbolic links/i);
    await expect(createWorkspaceEntry(root, {
      parentPath: "escape",
      name: "created.txt",
      kind: "file",
      content: "created",
    })).rejects.toThrow(/symbolic links/i);
    await expect(moveWorkspaceEntry(root, { fromPath: "real.txt", toPath: "escape/moved.txt" }))
      .rejects.toThrow(/symbolic links/i);
    await expect(copyWorkspaceEntry(root, { fromPath: "real.txt", targetFolderPath: "escape" }))
      .rejects.toThrow(/symbolic links/i);
    await expect(copyWorkspaceEntry(root, { fromPath: "linked.txt", targetFolderPath: null }))
      .rejects.toThrow(/symbolic links/i);
    await expect(importWorkspaceEntries(root, {
      sourcePaths: [externalFile],
      targetFolderPath: "escape",
    })).rejects.toThrow(/symbolic links/i);

    expect(await readFile(externalFile, "utf8")).toBe("SECRET");
    await expect(readFile(path.join(externalFolder, "created.txt"), "utf8")).rejects.toThrow();
    await expect(readFile(path.join(externalFolder, "moved.txt"), "utf8")).rejects.toThrow();
  });

  it("refuses to rename the workspace root", async () => {
    await expect(renameWorkspaceEntry(root, { path: "", nextName: "x" })).rejects.toThrow(/root/i);
  });

  it("moves a file into a subfolder", async () => {
    await createWorkspaceEntry(root, { parentPath: null, name: "docs", kind: "folder" });
    await createWorkspaceEntry(root, { parentPath: null, name: "a.txt", kind: "file", content: "a" });
    const res = await moveWorkspaceEntry(root, { fromPath: "a.txt", toPath: "docs/a.txt" });
    expect(res.path).toBe("docs/a.txt");
    expect(await readFile(path.join(root, "docs", "a.txt"), "utf8")).toBe("a");
  });

  it("moves a nested file back into its parent folder", async () => {
    await createWorkspaceEntry(root, { parentPath: null, name: "parent", kind: "folder" });
    await createWorkspaceEntry(root, { parentPath: "parent", name: "child", kind: "folder" });
    await createWorkspaceEntry(root, {
      parentPath: "parent/child",
      name: "nested.txt",
      kind: "file",
      content: "nested",
    });

    const result = await moveWorkspaceEntry(root, {
      fromPath: "parent/child/nested.txt",
      toPath: "parent/nested.txt",
    });

    expect(result.path).toBe("parent/nested.txt");
    expect(await readFile(path.join(root, "parent", "nested.txt"), "utf8")).toBe("nested");
  });

  it("refuses to move a folder into itself", async () => {
    await createWorkspaceEntry(root, { parentPath: null, name: "dir", kind: "folder" });
    await expect(moveWorkspaceEntry(root, { fromPath: "dir", toPath: "dir/sub" })).rejects.toThrow(/into itself/i);
  });

  it("deletes a file", async () => {
    await createWorkspaceEntry(root, { parentPath: null, name: "gone.txt", kind: "file", content: "x" });
    await deleteWorkspaceEntry(root, { path: "gone.txt" });
    await expect(stat(path.join(root, "gone.txt"))).rejects.toThrow();
  });

  it("deletes a folder recursively", async () => {
    await createWorkspaceEntry(root, { parentPath: null, name: "dir", kind: "folder" });
    await createWorkspaceEntry(root, { parentPath: "dir", name: "child.txt", kind: "file", content: "x" });
    await deleteWorkspaceEntry(root, { path: "dir" });
    await expect(stat(path.join(root, "dir"))).rejects.toThrow();
  });

  it("refuses to delete the workspace root", async () => {
    await expect(deleteWorkspaceEntry(root, { path: "" })).rejects.toThrow(/root/i);
  });
});

describe("copyWorkspaceEntry", () => {
  it("copies a file between two authorized workspace roots", async () => {
    await createWorkspaceEntry(root, { parentPath: null, name: "source.txt", kind: "file", content: "cross-root" });
    await createWorkspaceEntry(external, { parentPath: null, name: "destination", kind: "folder" });

    const result = await copyWorkspaceEntryBetweenRoots(root, external, {
      fromPath: "source.txt",
      targetFolderPath: "destination",
    });

    expect(result).toEqual({ path: "destination/source.txt" });
    expect(await readFile(path.join(root, "source.txt"), "utf8")).toBe("cross-root");
    expect(await readFile(path.join(external, "destination", "source.txt"), "utf8")).toBe("cross-root");
  });

  it("copies files into another folder without changing the source", async () => {
    await createWorkspaceEntry(root, { parentPath: null, name: "source.txt", kind: "file", content: "original" });
    await createWorkspaceEntry(root, { parentPath: null, name: "destination", kind: "folder" });

    const result = await copyWorkspaceEntry(root, {
      fromPath: "source.txt",
      targetFolderPath: "destination",
    });

    expect(result).toEqual({ path: "destination/source.txt" });
    expect(await readFile(path.join(root, "source.txt"), "utf8")).toBe("original");
    expect(await readFile(path.join(root, "destination", "source.txt"), "utf8")).toBe("original");
  });

  it("preserves an existing source basename exactly when no preferred name is requested", async () => {
    await writeFile(path.join(root, " note "), "spaced");
    await createWorkspaceEntry(root, { parentPath: null, name: "destination", kind: "folder" });

    await expect(copyWorkspaceEntry(root, {
      fromPath: " note ",
      targetFolderPath: "destination",
    })).resolves.toEqual({ path: "destination/ note " });
    expect(await readFile(path.join(root, "destination", " note "), "utf8")).toBe("spaced");
  });

  it("recursively copies folders", async () => {
    await createWorkspaceEntry(root, { parentPath: null, name: "source", kind: "folder" });
    await createWorkspaceEntry(root, { parentPath: "source", name: "nested", kind: "folder" });
    await createWorkspaceEntry(root, { parentPath: "source/nested", name: "note.md", kind: "file", content: "# Copy" });
    await createWorkspaceEntry(root, { parentPath: null, name: "destination", kind: "folder" });

    const result = await copyWorkspaceEntry(root, {
      fromPath: "source",
      targetFolderPath: "destination",
    });

    expect(result).toEqual({ path: "destination/source" });
    expect(await readFile(path.join(root, "source", "nested", "note.md"), "utf8")).toBe("# Copy");
    expect(await readFile(path.join(root, "destination", "source", "nested", "note.md"), "utf8")).toBe("# Copy");
  });

  it("copies non-writable source folders and restores their mode", async () => {
    await createWorkspaceEntry(root, { parentPath: null, name: "source", kind: "folder" });
    await createWorkspaceEntry(root, { parentPath: "source", name: "note.txt", kind: "file", content: "readonly" });
    await chmod(path.join(root, "source"), 0o555);

    try {
      const result = await copyWorkspaceEntry(root, {
        fromPath: "source",
        targetFolderPath: null,
      });

      expect(result).toEqual({ path: "source copy" });
      expect(await readFile(path.join(root, "source copy", "note.txt"), "utf8")).toBe("readonly");
      expect((await stat(path.join(root, "source copy"))).mode & 0o777).toBe(0o555);
    } finally {
      await chmod(path.join(root, "source"), 0o755).catch(() => {});
      await chmod(path.join(root, "source copy"), 0o755).catch(() => {});
    }
  });

  it("keeps both items when the preferred target name already exists", async () => {
    await createWorkspaceEntry(root, { parentPath: null, name: "source.txt", kind: "file", content: "source" });
    await createWorkspaceEntry(root, { parentPath: null, name: "destination", kind: "folder" });
    await createWorkspaceEntry(root, { parentPath: "destination", name: "source.txt", kind: "file", content: "target" });

    await expect(copyWorkspaceEntry(root, {
      fromPath: "source.txt",
      targetFolderPath: "destination",
    })).resolves.toEqual({ path: "destination/source copy.txt" });
    expect(await readFile(path.join(root, "destination", "source.txt"), "utf8")).toBe("target");
    expect(await readFile(path.join(root, "destination", "source copy.txt"), "utf8")).toBe("source");
  });

  it("uses Finder-style numbered names for repeated copies in the same folder", async () => {
    await createWorkspaceEntry(root, { parentPath: null, name: "report.md", kind: "file", content: "report" });

    await expect(copyWorkspaceEntry(root, {
      fromPath: "report.md",
      targetFolderPath: null,
    })).resolves.toEqual({ path: "report copy.md" });
    await expect(copyWorkspaceEntry(root, {
      fromPath: "report.md",
      targetFolderPath: null,
    })).resolves.toEqual({ path: "report copy 2.md" });
    await expect(copyWorkspaceEntry(root, {
      fromPath: "report copy.md",
      targetFolderPath: null,
    })).resolves.toEqual({ path: "report copy 3.md" });

    expect(await readFile(path.join(root, "report copy.md"), "utf8")).toBe("report");
    expect(await readFile(path.join(root, "report copy 2.md"), "utf8")).toBe("report");
    expect(await readFile(path.join(root, "report copy 3.md"), "utf8")).toBe("report");
  });

  it("treats a leading-dot filename as extensionless and dotted folders as folders", async () => {
    await createWorkspaceEntry(root, { parentPath: null, name: ".env", kind: "file", content: "SECRET=false" });
    await createWorkspaceEntry(root, { parentPath: null, name: "archive.tar.gz", kind: "file", content: "archive" });
    await createWorkspaceEntry(root, { parentPath: null, name: "folder.name", kind: "folder" });
    await createWorkspaceEntry(root, { parentPath: null, name: "destination", kind: "folder" });
    await createWorkspaceEntry(root, { parentPath: "destination", name: ".env", kind: "file", content: "hidden conflict" });

    await expect(copyWorkspaceEntry(root, {
      fromPath: ".env",
      targetFolderPath: null,
    })).resolves.toEqual({ path: ".env copy" });
    await expect(copyWorkspaceEntry(root, {
      fromPath: ".env",
      targetFolderPath: "destination",
    })).resolves.toEqual({ path: "destination/.env copy" });
    expect(await readFile(path.join(root, "destination", ".env"), "utf8")).toBe("hidden conflict");
    await expect(copyWorkspaceEntry(root, {
      fromPath: "archive.tar.gz",
      targetFolderPath: null,
    })).resolves.toEqual({ path: "archive copy.tar.gz" });
    await expect(copyWorkspaceEntry(root, {
      fromPath: "folder.name",
      targetFolderPath: null,
    })).resolves.toEqual({ path: "folder.name copy" });
  });

  it("honors a safe preferred name and an explicit duplicate-name request", async () => {
    await createWorkspaceEntry(root, { parentPath: null, name: "source.txt", kind: "file", content: "source" });
    await createWorkspaceEntry(root, { parentPath: null, name: "destination", kind: "folder" });

    await expect(copyWorkspaceEntry(root, {
      fromPath: "source.txt",
      targetFolderPath: "destination",
      preferredName: "renamed.txt",
      forceDuplicateName: true,
    })).resolves.toEqual({ path: "destination/renamed copy.txt" });
    await expect(copyWorkspaceEntry(root, {
      fromPath: "source.txt",
      targetFolderPath: "destination",
      preferredName: "../escape.txt",
    })).rejects.toThrow(/single file or folder name/i);
  });

  it("resolves simultaneous same-name copies with atomic keep-both naming", async () => {
    await createWorkspaceEntry(root, { parentPath: null, name: "source.txt", kind: "file", content: "source" });
    await createWorkspaceEntry(root, { parentPath: null, name: "destination", kind: "folder" });

    const results = await Promise.all([
      copyWorkspaceEntry(root, { fromPath: "source.txt", targetFolderPath: "destination" }),
      copyWorkspaceEntry(root, { fromPath: "source.txt", targetFolderPath: "destination" }),
    ]);

    expect(results.map((result) => result.path).sort()).toEqual([
      "destination/source copy.txt",
      "destination/source.txt",
    ]);
    expect(await readFile(path.join(root, "destination", "source.txt"), "utf8")).toBe("source");
    expect(await readFile(path.join(root, "destination", "source copy.txt"), "utf8")).toBe("source");
  });

  it("rejects the workspace root and copying a folder into itself", async () => {
    await createWorkspaceEntry(root, { parentPath: null, name: "source", kind: "folder" });

    await expect(copyWorkspaceEntry(root, { fromPath: "", targetFolderPath: null })).rejects.toThrow(/root/i);
    await expect(copyWorkspaceEntry(root, {
      fromPath: "source",
      targetFolderPath: "source",
    })).rejects.toThrow(/into itself/i);
  });

  it("rejects symbolic links anywhere in the copied tree and leaves no partial target", async () => {
    const externalFile = path.join(external, "secret.txt");
    await writeFile(externalFile, "SECRET");
    await createWorkspaceEntry(root, { parentPath: null, name: "source", kind: "folder" });
    await createWorkspaceEntry(root, { parentPath: "source", name: "safe.txt", kind: "file", content: "safe" });
    try {
      await symlink(externalFile, path.join(root, "source", "linked.txt"));
    } catch {
      return;
    }

    await expect(copyWorkspaceEntry(root, {
      fromPath: "source",
      targetFolderPath: null,
      preferredName: "copied",
    })).rejects.toThrow(/symbolic links/i);
    await expect(lstat(path.join(root, "copied"))).rejects.toThrow();
  });
});

describe("importWorkspaceEntries", () => {
  it("imports one source under a validated preferred name without overwriting another asset", async () => {
    const source = path.join(external, "original.png");
    await writeFile(source, "image bytes");
    const request = { sourcePaths: [source], targetFolderPath: null, preferredName: "image-unique.png" };
    expect((await importWorkspaceEntries(root, request)).paths).toEqual(["image-unique.png"]);
    expect(await readFile(path.join(root, "image-unique.png"), "utf8")).toBe("image bytes");
    expect(await readFile(source, "utf8")).toBe("image bytes");
    await expect(importWorkspaceEntries(root, request)).rejects.toThrow(/already exists/i);
    await expect(importWorkspaceEntries(root, { ...request, preferredName: "../escape.png" })).rejects.toThrow();
    await expect(importWorkspaceEntries(root, { ...request, sourcePaths: [source, source] })).rejects.toThrow(/exactly one/i);
  });
  it("imports real external files and folders by copy", async () => {
    await writeFile(path.join(external, "import-me.txt"), "external content");
    await mkdir(path.join(external, "folder"));
    await writeFile(path.join(external, "folder", "nested.txt"), "nested");

    const res = await importWorkspaceEntries(root, {
      sourcePaths: [path.join(external, "import-me.txt"), path.join(external, "folder")],
      targetFolderPath: null,
    });
    expect(res.paths.sort()).toEqual(["folder", "import-me.txt"]);
    expect(await readFile(path.join(root, "import-me.txt"), "utf8")).toBe("external content");
    expect(await readFile(path.join(root, "folder", "nested.txt"), "utf8")).toBe("nested");
  });

  it("rejects relative source paths", async () => {
    await expect(
      importWorkspaceEntries(root, { sourcePaths: ["relative/path.txt"], targetFolderPath: null }),
    ).rejects.toThrow(/absolute/i);
  });

  it("rejects symbolic-link sources", async () => {
    const target = path.join(external, "target.txt");
    await writeFile(target, "t");
    const link = path.join(external, "link.txt");
    try {
      await symlink(target, link);
    } catch {
      return; // symlink not permitted — skip
    }
    await expect(
      importWorkspaceEntries(root, { sourcePaths: [link], targetFolderPath: null }),
    ).rejects.toThrow(/Symbolic links/i);
  });

  it("rejects importing onto an existing name", async () => {
    await createWorkspaceEntry(root, { parentPath: null, name: "dup.txt", kind: "file", content: "existing" });
    await writeFile(path.join(external, "dup.txt"), "incoming");
    await expect(
      importWorkspaceEntries(root, { sourcePaths: [path.join(external, "dup.txt")], targetFolderPath: null }),
    ).rejects.toThrow(/already exists/i);
  });
});

describe("path-traversal containment (security)", () => {
  const escapes = ["../escape.txt", "../../escape.txt", "a/../../escape.txt", "/etc/passwd"];

  it("blocks traversal in createWorkspaceEntry parentPath", async () => {
    for (const parentPath of ["..", "../..", "/abs"]) {
      await expect(
        createWorkspaceEntry(root, { parentPath, name: "x.txt", kind: "file" }),
      ).rejects.toThrow(/outside the selected workspace/i);
    }
  });

  it("blocks traversal in readWorkspaceTextFile", async () => {
    for (const rel of escapes) {
      await expect(readWorkspaceTextFile(root, rel)).rejects.toThrow();
    }
  });

  it("blocks traversal in listFolderChildren", async () => {
    for (const rel of ["..", "../..", "/etc"]) {
      await expect(listFolderChildren(root, rel)).rejects.toThrow(/outside the selected workspace/i);
    }
  });

  it("blocks traversal in delete / rename / move / copy", async () => {
    await expect(deleteWorkspaceEntry(root, { path: "../x" })).rejects.toThrow(/outside the selected workspace/i);
    await expect(renameWorkspaceEntry(root, { path: "../x", nextName: "y" })).rejects.toThrow(/outside the selected workspace/i);
    await expect(moveWorkspaceEntry(root, { fromPath: "../x", toPath: "y" })).rejects.toThrow(/outside the selected workspace/i);
    await expect(copyWorkspaceEntry(root, { fromPath: "../x", targetFolderPath: null })).rejects.toThrow(/outside the selected workspace/i);
    await expect(copyWorkspaceEntry(root, { fromPath: "x", targetFolderPath: "../../y" })).rejects.toThrow(/outside the selected workspace/i);
  });

  it("does not write outside root even when traversal is attempted", async () => {
    const sentinel = path.join(external, "escape.txt");
    await createWorkspaceEntry(root, { parentPath: null, name: "sub", kind: "folder" }).catch(() => {});
    await createWorkspaceEntry(root, { parentPath: "sub", name: "victim.txt", kind: "file", content: "x" });
    // attempt to traverse out via move
    await expect(
      moveWorkspaceEntry(root, { fromPath: "sub/victim.txt", toPath: "../../escape.txt" }),
    ).rejects.toThrow();
    await expect(lstat(sentinel)).rejects.toThrow(); // nothing written outside
  });
});
