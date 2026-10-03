import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readWorkspaceModifiedAt } from "../../../../local-api/files/workspace-activity.mjs";
import { workspaceFromPath } from "../../../../local-api/workspace.mjs";

const execute = promisify(execFile);
let root;
const git = (...args) => execute("git", ["-C", root, "-c", "core.hooksPath=/dev/null", ...args], {
  env: { ...process.env, GIT_AUTHOR_DATE: "2001-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2001-01-01T00:00:00Z" },
});
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-activity-")); });
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
async function initialize() {
  await git("init", "-q"); await git("config", "user.name", "Fixture"); await git("config", "user.email", "fixture@example.com");
  await fs.mkdir(path.join(root, "docs")); await fs.writeFile(path.join(root, "docs/note.md"), "initial");
  await git("add", "."); await git("commit", "-qm", "fixture");
}

describe("read-only Homepage local modification metadata", () => {
  it("uses the committed content time for a clean checkout, never the current opening time", async () => {
    await initialize();
    expect(await readWorkspaceModifiedAt(root)).toBe("2001-01-01T00:00:00.000Z");
    const workspace = await workspaceFromPath(root);
    expect(workspace.lastModifiedAt).toBe("2001-01-01T00:00:00.000Z");
    expect(await readWorkspaceModifiedAt(root)).toBe(workspace.lastModifiedAt);
    expect((await workspaceFromPath(root, { includeGitMetadata: false })).lastModifiedAt).toBeUndefined();
    expect((await git("status", "--porcelain")).stdout).toBe("");
  });

  it.each(["modified", "untracked", "deleted", "renamed"])("includes %s working-tree changes without mutating Git", async (kind) => {
    await initialize();
    const file = path.join(root, "docs/note.md");
    if (kind === "modified") await fs.writeFile(file, "edited");
    if (kind === "untracked") await fs.writeFile(path.join(root, "a file\nwith newline.md"), "new");
    if (kind === "deleted") await fs.rm(path.join(root, "docs"), { recursive: true });
    if (kind === "renamed") await git("mv", "docs/note.md", "docs/renamed.md");
    const before = (await git("status", "--porcelain=v2", "-z")).stdout;
    expect(Date.parse(await readWorkspaceModifiedAt(root))).toBeGreaterThan(Date.parse("2020-01-01T00:00:00Z"));
    expect((await git("status", "--porcelain=v2", "-z")).stdout).toBe(before);
  });

  it("reads nested ordinary-folder file mtimes while excluding internal folders and symlinks", async () => {
    await fs.mkdir(path.join(root, "notes")); await fs.writeFile(path.join(root, "notes/a.md"), "a");
    await fs.utimes(path.join(root, "notes/a.md"), new Date("2020-01-01"), new Date("2020-01-01"));
    await fs.mkdir(path.join(root, ".puppyone")); await fs.writeFile(path.join(root, ".puppyone/state.json"), "{}");
    await fs.symlink(os.tmpdir(), path.join(root, "outside"));
    expect(await readWorkspaceModifiedAt(root)).toBe("2020-01-01T00:00:00.000Z");
  });

  it("reports unknown rather than a misleading partial date when the scan budget is exceeded", async () => {
    await Promise.all(Array.from({ length: 1030 }, (_, i) => fs.writeFile(path.join(root, `file-${i}`), "x")));
    expect(await readWorkspaceModifiedAt(root)).toBeNull();
  });

  it("does not manufacture an update time for an empty folder", async () => {
    expect(await readWorkspaceModifiedAt(root)).toBeNull();
  });
});
