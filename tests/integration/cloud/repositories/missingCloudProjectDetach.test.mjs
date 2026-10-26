import { execFile } from "node:child_process";
import * as fs from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerWorkspaceGitIpcHandlers } from "../../../../electron/main/ipc/workspace-git-ipc.mjs";
import { createSenderWorkspaceAuthorization } from "../../../../electron/main/workspace-authorization.mjs";
import { getWorkspaceGitStatus } from "../../../../local-api/workspace.mjs";

const exec = promisify(execFile);
const OLD = "http://api.puppyone.ai/git/project-1.git";
const GITHUB = "https://github.com/fixture/project.git";
let root;
let detach;
let handler;
const git = async (...args) => (await exec("git", ["-C", root, ...args], { env: { ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" } })).stdout.trim();
beforeEach(async () => {
  root = await fs.promises.realpath(await mkdtemp(path.join(os.tmpdir(), "puppy-missing-cloud-")));
  await git("init", "-b", "main");
  await git("config", "user.email", "fixture@example.com"); await git("config", "user.name", "Fixture");
  await git("config", "credential.helper", "");
  await writeFile(path.join(root, "notes.md"), "Local project content\n");
  await git("add", "notes.md"); await git("commit", "-m", "Initial");
  await git("remote", "add", "puppyone", OLD); await git("remote", "add", "origin", GITHUB);
  const handlers = new Map(); detach = vi.fn(async () => ({ managed: false }));
  registerWorkspaceGitIpcHandlers({ ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
    BrowserWindow: { fromWebContents: () => null }, dialog: {},
    authorizeWorkspaceRoot: createSenderWorkspaceAuthorization({ fsModule: fs, getWorkspaceRootsForSender: () => [root] }),
    cloudGitCredentialManager: { detachManaged: detach } });
  handler = handlers.get("workspace:git-remove-remote");
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe("reviewed missing-Cloud connection detach", () => {
  it("detaches the reviewed old remote while retaining local history, content and unrelated remotes", async () => {
    const before = await getWorkspaceGitStatus(root);
    const result = await handler({ sender: { id: 1 } }, { rootPath: root, remoteName: "puppyone", expectedRemotes: before.remotes });
    expect(result.remotes).toMatchObject([{ name: "origin", fetchUrl: GITHUB, pushUrl: GITHUB }]);
    expect(result.headCommitId).toBe(before.headCommitId);
    expect(await readFile(path.join(root, "notes.md"), "utf8")).toBe("Local project content\n");
    expect(detach).toHaveBeenCalledWith(root, OLD);
  });
  it.each(["fetch", "push", "another remote"])("rejects a changed %s before touching credentials or Git config", async change => {
    const reviewed = await getWorkspaceGitStatus(root);
    if (change === "fetch") await git("remote", "set-url", "puppyone", "https://api.puppyone.ai/git/new-project.git");
    else if (change === "push") await git("remote", "set-url", "--push", "puppyone", "https://api.puppyone.ai/git/new-project.git");
    else await git("remote", "add", "another", "https://example.com/new.git");
    const config = await readFile(path.join(root, ".git/config"), "utf8");
    await expect(handler({ sender: { id: 1 } }, { rootPath: root, remoteName: "puppyone", expectedRemotes: reviewed.remotes }))
      .rejects.toThrow("Git remotes changed");
    expect(await readFile(path.join(root, ".git/config"), "utf8")).toBe(config);
    expect(detach).not.toHaveBeenCalled();
  });
  it("rechecks the reviewed snapshot after credential detach", async () => {
    const reviewed = await getWorkspaceGitStatus(root);
    detach.mockImplementation(async () => {
      await git("remote", "set-url", "puppyone", "https://api.puppyone.ai/git/new-project.git");
    });
    await expect(handler({ sender: { id: 1 } }, { rootPath: root, remoteName: "puppyone", expectedRemotes: reviewed.remotes }))
      .rejects.toThrow("Git remotes changed");
    expect(await git("remote", "get-url", "puppyone")).toBe("https://api.puppyone.ai/git/new-project.git");
    expect(await git("remote", "get-url", "origin")).toBe(GITHUB);
  });
});
