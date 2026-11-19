import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createImportOpeningRecovery } from "../../../../electron/main/project-import/opening.mjs";
import { createProjectEntryService } from "../../../../electron/main/project-entry-service.mjs";

let parentPath;
beforeEach(async () => { parentPath = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-import-opening-"))); });
afterEach(async () => { await fs.rm(parentPath, { recursive: true, force: true }); });

it("retries opening the published project without cloning again or losing the recent entry", async () => {
  const cloneGit = vi.fn(async (staging) => fs.writeFile(path.join(staging, "note.md"), "imported"));
  const service = createProjectEntryService({ cloneGit });
  const remember = vi.fn(async () => undefined);
  const opened = { status: "opened-current", path: path.join(parentPath, "notes") };
  const open = vi.fn().mockRejectedValueOnce(new Error("temporarily unavailable")).mockResolvedValue(opened);
  const recovery = createImportOpeningRecovery({ remember, open });
  const sender = { id: 7 };
  const run = async () => {
    const project = recovery.get(sender, "task-1") ?? await service.importProject({
      parentPath, source: { provider: "github", repositoryUrl: "https://github.com/example/notes.git" },
    });
    return recovery.open(sender, "task-1", project);
  };
  const first = await run();
  expect(first.opening).toEqual({ status: "failed", message: "temporarily unavailable" });
  expect(remember).toHaveBeenCalledWith(opened.path);
  expect(recovery.get({ id: 7 }, "task-1")).toBeNull();
  expect(recovery.get(sender, "another-task")).toBeNull();
  await fs.writeFile(path.join(opened.path, "note.md"), "edited after import");
  await expect(run()).resolves.toEqual({ project: first.project, opening: { status: "opened", result: opened } });
  expect(cloneGit).toHaveBeenCalledOnce();
  expect(await fs.readFile(path.join(opened.path, "note.md"), "utf8")).toBe("edited after import");
  expect(await fs.readdir(parentPath)).toEqual(["notes"]);
  expect(recovery.get(sender, "task-1")).toBeNull();
});

it("retains the completed project if remembering it fails, and keeps only the latest pending import", async () => {
  const sender = {};
  const project = { path: "/imported/notes", name: "notes", provider: "github" };
  const open = vi.fn();
  const recovery = createImportOpeningRecovery({ remember: async () => { throw new Error("disk unavailable"); }, open });
  await expect(recovery.open(sender, "task-1", project)).resolves.toMatchObject({ opening: { status: "failed" } });
  expect(recovery.get(sender, "task-1")).toBe(project);
  expect(open).not.toHaveBeenCalled();
  await recovery.open(sender, "task-2", { ...project, name: "second" });
  expect(recovery.get(sender, "task-1")).toBeNull();
});
