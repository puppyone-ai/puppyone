import { access, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createProjectEntryService,
  requireGitRepository,
  requireProjectName,
} from "../../../../electron/main/project-entry-service.mjs";
import { createLocalProjectImportService } from "../../../../electron/main/project-import/service.mjs";
import { createImportSourceRegistry } from "../../../../electron/main/project-import/registry.mjs";
import { LOCAL_IMPORT_SOURCES } from "../../../../shared/project-import/sources.mjs";

let parentPath;

beforeEach(async () => {
  parentPath = await mkdtemp(path.join(os.tmpdir(), "puppyone-project-entry-"));
  parentPath = await realpath(parentPath);
});

afterEach(async () => {
  await rm(parentPath, { recursive: true, force: true });
});

describe("project entry service", () => {
  it("loads every operational source from its registered module", async () => {
    const registry = createImportSourceRegistry({
      loadAdapter: async (id) => {
        const module = await import(`../../../../electron/main/project-import/sources/${id}.mjs`);
        return module.createImportSource({ cloneGit: vi.fn(), requireGitRepository, requireProjectName });
      },
    });
    for (const descriptor of LOCAL_IMPORT_SOURCES.filter((source) => source.operational)) {
      await expect(registry.require(descriptor.id)).resolves.toMatchObject({ descriptor });
    }
    await expect(registry.require("notion")).rejects.toMatchObject({ code: "IMPORT_SOURCE_UNAVAILABLE" });
  });

  it("creates one empty child directory under the selected parent", async () => {
    const service = createProjectEntryService();

    await expect(service.createProject({ parentPath, name: "  Notes  " })).resolves.toMatchObject({
      path: path.join(parentPath, "Notes"),
      name: "Notes",
    });
    expect((await stat(path.join(parentPath, "Notes"))).isDirectory()).toBe(true);
    expect((await readdir(path.join(parentPath, "Notes")))).toEqual([]);
    await expect(service.createProject({ parentPath, name: "Notes" })).rejects.toMatchObject({
      code: "PROJECT_ALREADY_EXISTS",
    });
  });

  it("rejects traversal, credentials in URLs, unsupported hosts, and malformed repository URLs", () => {
    for (const value of ["", ".", "..", "../escape", "bad/name", "CON", "trailing."]) {
      expect(() => requireProjectName(value)).toThrow();
    }
    for (const value of [
      "",
      "http://github.com/owner/repo.git",
      "https://token@github.com/owner/repo.git",
      "https://github.com/owner/repo/tree/main",
      "https://bitbucket.org/owner/repo.git",
      "--upload-pack=malicious",
    ]) {
      expect(() => requireGitRepository(value)).toThrow();
    }
  });

  it("accepts GitHub HTTPS and SSH forms and derives the local folder name", () => {
    expect(requireGitRepository("https://github.com/puppyone-ai/puppyone.git", "github")).toMatchObject({
      provider: "github",
      owner: "puppyone-ai",
      name: "puppyone",
    });
    expect(requireGitRepository("git@github.com:puppyone-ai/puppyone.git", "github")).toMatchObject({
      owner: "puppyone-ai",
      name: "puppyone",
    });
    expect(requireGitRepository("ssh://git@github.com/puppyone-ai/puppyone.git", "github")).toMatchObject({
      owner: "puppyone-ai",
      name: "puppyone",
    });
  });

  it("accepts GitLab groups and subgroups over HTTPS and SSH", () => {
    expect(requireGitRepository("https://gitlab.com/puppyone/data/knowledge-base.git", "gitlab")).toMatchObject({
      provider: "gitlab",
      namespace: "puppyone/data",
      name: "knowledge-base",
    });
    expect(requireGitRepository("git@gitlab.com:puppyone/data/knowledge-base.git", "gitlab")).toMatchObject({
      provider: "gitlab",
      namespace: "puppyone/data",
      name: "knowledge-base",
    });
    expect(requireGitRepository("ssh://git@gitlab.com/puppyone/data/knowledge-base.git", "gitlab")).toMatchObject({
      provider: "gitlab",
      namespace: "puppyone/data",
      name: "knowledge-base",
    });
  });

  it("keeps provider-specific entry points scoped to their selected host", () => {
    expect(() => requireGitRepository("https://gitlab.com/owner/repository.git", "github"))
      .toThrow(/GitHub/);
    expect(() => requireGitRepository("https://github.com/owner/repository.git", "gitlab"))
      .toThrow(/GitLab/);
    expect(() => requireGitRepository("https://github.com/owner/repository.git", "bitbucket"))
      .toThrow(/GitHub or GitLab/);
  });

  it("keeps the final path absent while cloning, then publishes the completed result", async () => {
    const cloneGit = vi.fn(async (temporaryPath, repositoryUrl) => {
      expect(path.basename(temporaryPath)).toMatch(/^\.puppyone-import-repository-/);
      expect(repositoryUrl).toBe("https://github.com/owner/repository.git");
      await expect(access(path.join(parentPath, "repository"))).rejects.toMatchObject({ code: "ENOENT" });
      await writeFile(path.join(temporaryPath, "README.md"), "hello\n", "utf8");
    });
    const service = createProjectEntryService({ cloneGit });

    await expect(service.importProject({
      parentPath,
      source: { provider: "github", repositoryUrl: "https://github.com/owner/repository.git" },
    })).resolves.toMatchObject({
      path: path.join(parentPath, "repository"),
      name: "repository",
    });
    await expect(readFile(path.join(parentPath, "repository", "README.md"), "utf8")).resolves.toBe("hello\n");
    expect(cloneGit).toHaveBeenCalledOnce();
  });

  it("rejects a repository that does not match the selected provider before cloning", async () => {
    const cloneGit = vi.fn();
    const service = createProjectEntryService({ cloneGit });

    await expect(service.importProject({
      parentPath,
      source: { provider: "github", repositoryUrl: "https://gitlab.com/owner/repository.git" },
    })).rejects.toMatchObject({ code: "INVALID_REPOSITORY_URL" });
    expect(cloneGit).not.toHaveBeenCalled();
  });

  it("does not replace a path created while a clone is running", async () => {
    const service = createProjectEntryService({
      cloneGit: vi.fn(async (temporaryPath) => {
        await writeFile(path.join(temporaryPath, "README.md"), "cloned\n", "utf8");
        await mkdir(path.join(parentPath, "repository"));
        await writeFile(path.join(parentPath, "repository", "keep.txt"), "keep\n", "utf8");
      }),
    });

    await expect(service.importProject({
      parentPath,
      source: { provider: "github", repositoryUrl: "https://github.com/owner/repository.git" },
    })).rejects.toMatchObject({ code: "PROJECT_ALREADY_EXISTS" });
    await expect(readFile(path.join(parentPath, "repository", "keep.txt"), "utf8")).resolves.toBe("keep\n");
    expect((await readdir(parentPath)).sort()).toEqual(["repository"]);
  });

  it("removes only its temporary clone directory after a failure", async () => {
    await writeFile(path.join(parentPath, "keep.txt"), "keep", "utf8");
    const service = createProjectEntryService({
      cloneGit: vi.fn(async () => {
        const error = new Error("network unavailable");
        error.stderr = "fatal: repository not found";
        throw error;
      }),
    });

    await expect(service.importProject({
      parentPath,
      source: { provider: "github", repositoryUrl: "https://github.com/owner/repository.git" },
    })).rejects.toMatchObject({ code: "CLONE_FAILED" });
    await expect(readFile(path.join(parentPath, "keep.txt"), "utf8")).resolves.toBe("keep");
    const remaining = await readdir(parentPath);
    expect(remaining).toEqual(["keep.txt"]);
  });

  it("turns non-interactive credential failures into an actionable provider message", async () => {
    const service = createProjectEntryService({
      cloneGit: vi.fn(async () => {
        const error = new Error("clone failed");
        error.stderr = "fatal: could not read Username for 'https://gitlab.com': terminal prompts disabled";
        throw error;
      }),
    });

    await expect(service.importProject({
      parentPath,
      source: { provider: "gitlab", repositoryUrl: "https://gitlab.com/owner/repository.git" },
    })).rejects.toMatchObject({
      code: "CLONE_AUTHENTICATION_FAILED",
      message: expect.stringMatching(/GitLab authentication failed/),
    });
  });

  it("copies an exported folder into a new local project and leaves the source independent", async () => {
    const sourcePath = path.join(parentPath, "notion-export");
    const destination = path.join(parentPath, "projects");
    await mkdir(path.join(sourcePath, "pages"), { recursive: true });
    await mkdir(destination);
    await writeFile(path.join(sourcePath, "pages", "note.md"), "source\n");

    const service = createProjectEntryService();
    await expect(service.importProject({
      parentPath: destination,
      source: { kind: "folder", provider: "obsidian", sourcePath },
    })).resolves.toMatchObject({
      path: path.join(destination, "notion-export"),
      name: "notion-export",
      provider: "obsidian",
    });
    await writeFile(path.join(destination, "notion-export", "pages", "note.md"), "local\n");
    expect(await readFile(path.join(sourcePath, "pages", "note.md"), "utf8")).toBe("source\n");
    expect(await readFile(path.join(destination, "notion-export", "pages", "note.md"), "utf8")).toBe("local\n");
    expect(await readdir(destination)).toEqual(["notion-export"]);
  });

  it("does not overwrite an existing local project when importing a folder", async () => {
    const sourcePath = path.join(parentPath, "vault");
    const destination = path.join(parentPath, "projects");
    await mkdir(sourcePath);
    await mkdir(path.join(destination, "vault"), { recursive: true });
    await writeFile(path.join(sourcePath, "note.md"), "source");
    await writeFile(path.join(destination, "vault", "note.md"), "existing");

    const service = createProjectEntryService();
    await expect(service.importProject({
      parentPath: destination,
      source: { kind: "folder", provider: "obsidian", sourcePath },
    })).rejects.toMatchObject({ code: "PROJECT_ALREADY_EXISTS" });
    expect(await readFile(path.join(destination, "vault", "note.md"), "utf8")).toBe("existing");
    expect(await readdir(destination)).toEqual(["vault"]);
  });

  it("rejects a linked file and removes only its own staging directory", async () => {
    const sourcePath = path.join(parentPath, "export");
    const destination = path.join(parentPath, "projects");
    await mkdir(sourcePath);
    await mkdir(destination);
    await writeFile(path.join(parentPath, "outside.txt"), "private");
    await symlink(path.join(parentPath, "outside.txt"), path.join(sourcePath, "linked.txt"));

    const service = createProjectEntryService();
    await expect(service.importProject({
      parentPath: destination,
      source: { kind: "folder", provider: "obsidian", sourcePath },
    })).rejects.toThrow(/symbolic link/);
    expect(await readdir(destination)).toEqual([]);
    expect(await readFile(path.join(parentPath, "outside.txt"), "utf8")).toBe("private");
  });

  it("rejects a destination inside the imported folder before copying", async () => {
    const sourcePath = path.join(parentPath, "export");
    const destination = path.join(sourcePath, "projects");
    await mkdir(destination, { recursive: true });
    await writeFile(path.join(sourcePath, "note.md"), "source");

    const service = createProjectEntryService();
    await expect(service.importProject({
      parentPath: destination,
      source: { kind: "folder", provider: "obsidian", sourcePath },
    })).rejects.toThrow(/outside the source folder/);
    expect(await readdir(destination)).toEqual([]);
    expect(await readFile(path.join(sourcePath, "note.md"), "utf8")).toBe("source");
  });

  it("does not route an unimplemented remote provider through local folder copying", async () => {
    const sourcePath = path.join(parentPath, "export");
    await mkdir(sourcePath);
    await writeFile(path.join(sourcePath, "note.md"), "source");

    const service = createProjectEntryService();
    await expect(service.importProject({
      parentPath,
      source: { kind: "folder", provider: "notion", sourcePath },
    })).rejects.toMatchObject({ code: "IMPORT_SOURCE_UNAVAILABLE" });
    expect(await readdir(parentPath)).toEqual(["export"]);
  });

  it("accepts a registered remote adapter through the same local publication boundary", async () => {
    const inspect = vi.fn(async (source) => ({ name: "Remote Notes", source }));
    const materialize = vi.fn(async ({ writer }) => {
      await writer.writeFile("README.md", "fetched from service\n");
      await expect(access(path.join(parentPath, "Remote Notes")))
        .rejects.toMatchObject({ code: "ENOENT" });
    });
    const importer = createLocalProjectImportService({
      validateName: requireProjectName,
      descriptors: [{ id: "remote-notes", label: "Remote Notes", mode: "remote", operational: true }],
      adapters: { "remote-notes": {
        mode: "remote", inspect, materialize,
        connect: async () => ({ token: "main-only" }),
        listResources: async () => ({ items: [{ id: "page-1", name: "Notes", kind: "document" }], nextCursor: null }),
      } },
    });
    const { connectionId } = await importer.connectSource({ provider: "remote-notes", ownerId: 1 });
    await expect(importer.listResources({ provider: "remote-notes", connectionId, ownerId: 1 }))
      .resolves.toMatchObject({ items: [{ id: "page-1" }] });

    await expect(importer.importProject({
      parentPath,
      ownerId: 1,
      source: { provider: "remote-notes", connectionId, resourceId: "page-1" },
    })).resolves.toMatchObject({
      path: path.join(parentPath, "Remote Notes"),
      provider: "remote-notes",
    });
    expect(inspect).toHaveBeenCalledWith(
      { provider: "remote-notes", connectionId, resourceId: "page-1" },
      { connection: { token: "main-only" } },
    );
    expect(materialize).toHaveBeenCalledOnce();
    expect(await readFile(path.join(parentPath, "Remote Notes", "README.md"), "utf8"))
      .toBe("fetched from service\n");
  });

  it("validates a remote adapter's project name before creating staging", async () => {
    const materialize = vi.fn();
    const importer = createLocalProjectImportService({
      validateName: requireProjectName,
      descriptors: [{ id: "remote-notes", label: "Remote Notes", mode: "remote", operational: true }],
      adapters: {
        "remote-notes": {
          mode: "remote",
          inspect: async (source) => ({ name: "../escape", source }),
          materialize,
          connect: async () => ({}),
          listResources: async () => ({ items: [{ id: "page-1", name: "Page", kind: "document" }], nextCursor: null }),
        },
      },
    });
    const { connectionId } = await importer.connectSource({ provider: "remote-notes", ownerId: 1 });
    await importer.listResources({ provider: "remote-notes", connectionId, ownerId: 1 });

    await expect(importer.importProject({
      parentPath,
      ownerId: 1,
      source: { provider: "remote-notes", connectionId, resourceId: "page-1" },
    })).rejects.toMatchObject({ code: "INVALID_PROJECT_NAME" });
    expect(materialize).not.toHaveBeenCalled();
    expect(await readdir(parentPath)).toEqual([]);
  });

  it("loads a registered remote source module once and keeps its connection in Main", async () => {
    const loadAdapter = vi.fn(async () => ({
      mode: "remote",
      connect: async () => ({ token: "secret" }),
      listResources: async ({ connection }) => ({
        items: [{ id: "doc-1", name: "Page", kind: "document", token: connection.token }],
        nextCursor: null,
      }),
      inspect: async (source, { connection }) => ({ name: "Imported", source: { ...source, token: connection.token } }),
      materialize: async ({ source, writer }) => writer.writeFile("notes/page.md", `# ${source.token}\n`),
    }));
    const importer = createLocalProjectImportService({
      descriptors: [{ id: "sample-saas", label: "Sample", mode: "remote", operational: true }],
      loadAdapter,
      validateName: requireProjectName,
    });
    const { connectionId } = await importer.connectSource({ provider: "sample-saas", ownerId: 7 });
    const page = await importer.listResources({ provider: "sample-saas", connectionId, ownerId: 7 });
    expect(page).toEqual({ items: [{ id: "doc-1", name: "Page", kind: "document" }], nextCursor: null });
    await expect(importer.importProject({
      parentPath,
      ownerId: 7,
      source: { provider: "sample-saas", connectionId, resourceId: "doc-1" },
    })).resolves.toMatchObject({ name: "Imported" });
    expect(await readFile(path.join(parentPath, "Imported", "notes", "page.md"), "utf8")).toBe("# secret\n");
    expect(loadAdapter).toHaveBeenCalledOnce();
  });

  it("binds remote connections and selected resources to their owner", async () => {
    const materialize = vi.fn();
    const importer = createLocalProjectImportService({
      descriptors: [{ id: "sample-saas", label: "Sample", mode: "remote", operational: true }],
      adapters: { "sample-saas": {
        mode: "remote",
        connect: async () => ({}),
        listResources: async () => ({ items: [{ id: "allowed", name: "Allowed", kind: "document" }], nextCursor: null }),
        inspect: async (source) => ({ name: "Imported", source }),
        materialize,
      } },
      validateName: requireProjectName,
    });
    const { connectionId } = await importer.connectSource({ provider: "sample-saas", ownerId: 7 });
    await expect(importer.listResources({ provider: "sample-saas", connectionId, ownerId: 8 }))
      .rejects.toMatchObject({ code: "IMPORT_CONNECTION_EXPIRED" });
    await expect(importer.importProject({ parentPath, ownerId: 7,
      source: { provider: "sample-saas", connectionId, resourceId: "guessed" } }))
      .rejects.toThrow(/Choose a resource/);
    await importer.listResources({ provider: "sample-saas", connectionId, ownerId: 7 });
    await expect(importer.importProject({ parentPath, ownerId: 8,
      source: { provider: "sample-saas", connectionId, resourceId: "allowed" } }))
      .rejects.toMatchObject({ code: "IMPORT_CONNECTION_EXPIRED" });
    expect(materialize).not.toHaveBeenCalled();
    expect(await readdir(parentPath)).toEqual([]);
  });

  it("rejects a provider path outside the project and removes the staging directory", async () => {
    const importer = createLocalProjectImportService({
      descriptors: [{ id: "sample-saas", label: "Sample", mode: "remote", operational: true }],
      adapters: { "sample-saas": {
        mode: "remote",
        connect: async () => ({}),
        listResources: async () => ({ items: [{ id: "doc", name: "Doc", kind: "document" }], nextCursor: null }),
        inspect: async (source) => ({ name: "Imported", source }),
        materialize: async ({ writer }) => writer.writeFile("../outside.md", "bad"),
      } },
      validateName: requireProjectName,
    });
    const { connectionId } = await importer.connectSource({ provider: "sample-saas", ownerId: 7 });
    await importer.listResources({ provider: "sample-saas", connectionId, ownerId: 7 });
    await expect(importer.importProject({ parentPath, ownerId: 7,
      source: { provider: "sample-saas", connectionId, resourceId: "doc" } }))
      .rejects.toMatchObject({ code: "INVALID_IMPORT_PATH" });
    expect(await readdir(parentPath)).toEqual([]);
  });

  it("cancels a remote file stream before publication and cleans up its staging directory", async () => {
    const controller = new AbortController();
    const importer = createLocalProjectImportService({
      descriptors: [{ id: "sample-saas", label: "Sample", mode: "remote", operational: true }],
      adapters: { "sample-saas": {
        mode: "remote",
        connect: async () => ({}),
        listResources: async () => ({ items: [{ id: "doc", name: "Doc", kind: "document" }], nextCursor: null }),
        inspect: async (source) => ({ name: "Imported", source }),
        materialize: async ({ writer }) => writer.writeFile("large.bin", (async function* () {
          yield new Uint8Array([1]);
          controller.abort();
          yield new Uint8Array([2]);
        })()),
      } },
      validateName: requireProjectName,
    });
    const { connectionId } = await importer.connectSource({ provider: "sample-saas", ownerId: 7 });
    await importer.listResources({ provider: "sample-saas", connectionId, ownerId: 7 });
    await expect(importer.importProject({ parentPath, ownerId: 7, signal: controller.signal,
      source: { provider: "sample-saas", connectionId, resourceId: "doc" } }))
      .rejects.toThrow(/cancelled/);
    expect(await readdir(parentPath)).toEqual([]);
  });
});
