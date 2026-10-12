import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { execGit } from "../../../../local-api/git/runner.mjs";
import { readGitPublishScope } from "../../../../local-api/git/publish-scope.mjs";

const folders = [];
const IGNORE_RULES = "node_modules/\n";
const README = "0123456789";
const NOTE = "01234";
const REACHABLE_BYTES = IGNORE_RULES.length + README.length + NOTE.length;

afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

/**
 * A folder shaped like a real project: tracked content, new content nobody has
 * committed yet, and content an ignore rule keeps out.
 */
async function projectFolder({ withHistory }) {
  const root = await mkdtemp(path.join(os.tmpdir(), "puppyone-publish-scope-case-"));
  folders.push(root);
  await mkdir(path.join(root, "docs"), { recursive: true });
  await mkdir(path.join(root, "node_modules", "package"), { recursive: true });
  await writeFile(path.join(root, ".gitignore"), IGNORE_RULES);
  await writeFile(path.join(root, "README.md"), README);
  await writeFile(path.join(root, "docs", "note.md"), NOTE);
  await writeFile(path.join(root, "node_modules", "package", "index.js"), "ignored");
  if (withHistory) {
    await execGit(root, ["init", "--quiet"]);
    await execGit(root, ["add", "README.md"]);
    await execGit(root, [
      "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test",
      "commit", "--quiet", "-m", "Initial snapshot",
    ]);
  }
  return root;
}

describe("what a folder would make reachable", () => {
  it("counts committed and new files together and leaves ignored ones out", async () => {
    const root = await projectFolder({ withHistory: true });

    const scope = await readGitPublishScope(root);

    // .gitignore, README.md and docs/note.md; node_modules is excluded.
    expect(scope).toEqual({ files: 3, bytes: REACHABLE_BYTES, truncated: false });
  });

  it("answers for a folder without version history and creates nothing inside it", async () => {
    const root = await projectFolder({ withHistory: false });

    const scope = await readGitPublishScope(root);

    expect(scope).toEqual({ files: 3, bytes: REACHABLE_BYTES, truncated: false });
    expect(existsSync(path.join(root, ".git"))).toBe(false);
  });

  it("measures only the chosen folder", async () => {
    const root = await projectFolder({ withHistory: true });
    const only = { files: 1, bytes: NOTE.length, truncated: false };

    expect(await readGitPublishScope(root, "docs")).toEqual(only);
    expect(await readGitPublishScope(root, "./docs/")).toEqual(only);
  });

  it("reports a floor instead of walking a folder larger than a summary can count", async () => {
    const root = await projectFolder({ withHistory: true });
    await mkdir(path.join(root, "many"), { recursive: true });
    await Promise.all(Array.from({ length: 12 }, (_, index) => (
      writeFile(path.join(root, "many", `file-${index}.txt`), "x")
    )));

    const scope = await readGitPublishScope(root, "many", { fileLimit: 5 });

    expect(scope).toEqual({ files: 5, bytes: 5, truncated: true });
  });
});
