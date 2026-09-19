import { access, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createProjectEntryService,
  requireGitRepository,
  requireProjectName,
} from "../../../../electron/main/project-entry-service.mjs";

let parentPath;

beforeEach(async () => {
  parentPath = await mkdtemp(path.join(os.tmpdir(), "puppyone-project-entry-"));
  parentPath = await realpath(parentPath);
});

afterEach(async () => {
  await rm(parentPath, { recursive: true, force: true });
});

describe("project entry service", () => {
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
      expect(path.basename(temporaryPath)).toMatch(/^\.puppyone-clone-repository-/);
      expect(repositoryUrl).toBe("https://github.com/owner/repository.git");
      await expect(access(path.join(parentPath, "repository"))).rejects.toMatchObject({ code: "ENOENT" });
      await writeFile(path.join(temporaryPath, "README.md"), "hello\n", "utf8");
    });
    const service = createProjectEntryService({ cloneGit });

    await expect(service.cloneRepository({
      parentPath,
      repositoryUrl: "https://github.com/owner/repository.git",
    })).resolves.toMatchObject({
      path: path.join(parentPath, "repository"),
      name: "repository",
    });
    await expect(readFile(path.join(parentPath, "repository", "README.md"), "utf8")).resolves.toBe("hello\n");
    expect(cloneGit).toHaveBeenCalledOnce();
  });

  it("does not replace a path created while a clone is running", async () => {
    const service = createProjectEntryService({
      cloneGit: vi.fn(async (temporaryPath) => {
        await writeFile(path.join(temporaryPath, "README.md"), "cloned\n", "utf8");
        await mkdir(path.join(parentPath, "repository"));
        await writeFile(path.join(parentPath, "repository", "keep.txt"), "keep\n", "utf8");
      }),
    });

    await expect(service.cloneRepository({
      parentPath,
      repositoryUrl: "https://github.com/owner/repository.git",
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

    await expect(service.cloneRepository({
      parentPath,
      repositoryUrl: "https://github.com/owner/repository.git",
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

    await expect(service.cloneRepository({
      parentPath,
      repositoryUrl: "https://gitlab.com/owner/repository.git",
    })).rejects.toMatchObject({
      code: "CLONE_AUTHENTICATION_FAILED",
      message: expect.stringMatching(/GitLab authentication failed/),
    });
  });
});
