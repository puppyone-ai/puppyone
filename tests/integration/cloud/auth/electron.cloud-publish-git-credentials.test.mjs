import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { createCloudPublishGitCredentialManager } from "../../../../electron/main/cloud-publish-git-credentials.mjs";
import { execGit } from "../../../../local-api/git/runner.mjs";

const execFileAsync = promisify(execFile);
const roots = [];
const REMOTE = "https://api.puppyone.ai/git/project-1.git";
const OPERATION = "11111111-1111-4111-8111-111111111111";

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("URL-scoped Cloud Git credentials", () => {
  it("resets an unknown helper only for the canonical URL and restores it exactly on Abandon", async () => {
    const root = await createRepository();
    await git(root, "config", "--local", "--add", "credential.helper", "!malicious-capture");
    await git(root, "config", "--local", "--add", `credential.${REMOTE}.helper`, "store --file=/tmp/old");
    await git(root, "config", "--local", "--add", `credential.${REMOTE}.useHttpPath`, "false");
    const calls = [];
    const manager = createCloudPublishGitCredentialManager({
      platform: "darwin",
      execGitCommand: isolatedCredentialExec(calls),
    });

    const snapshot = await manager.prepare(root, REMOTE, OPERATION);
    expect(snapshot).toMatchObject({
      helper: "osxkeychain",
      previous_helpers: ["store --file=/tmp/old"],
      previous_use_http_path: ["false"],
    });
    await manager.approve(root, REMOTE, "x-puppyone-token", "pwg_top_secret", OPERATION, snapshot);

    expect(await configValues(root, `credential.${REMOTE}.helper`)).toEqual(["", "osxkeychain"]);
    expect(await configValues(root, "credential.helper")).toEqual(["!malicious-capture"]);
    const approve = calls.find((entry) => entry.args.includes("approve"));
    expect(approve.input).toContain("password=pwg_top_secret");
    expect(JSON.stringify(approve.args)).not.toContain("pwg_top_secret");
    expect(approve.args).toContain(`credential.${REMOTE}.helper=`);
    expect(approve.args).toContain(`credential.${REMOTE}.helper=osxkeychain`);

    await manager.cleanupManaged(root, REMOTE, "x-puppyone-token", OPERATION, snapshot);
    expect(await configValues(root, `credential.${REMOTE}.helper`)).toEqual(["store --file=/tmp/old"]);
    expect(await configValues(root, `credential.${REMOTE}.useHttpPath`)).toEqual(["false"]);
    expect(await configValues(root, "credential.helper")).toEqual(["!malicious-capture"]);
  });

  it("persists enough scoped metadata for Detach to restore preexisting values", async () => {
    const root = await createRepository();
    await git(root, "config", "--local", "--add", `credential.${REMOTE}.helper`, "manager-core");
    const calls = [];
    const manager = createCloudPublishGitCredentialManager({
      platform: "darwin",
      execGitCommand: isolatedCredentialExec(calls),
    });
    const snapshot = await manager.prepare(root, REMOTE, OPERATION);
    await manager.approve(root, REMOTE, "x-puppyone-token", "pwg_detach", OPERATION, snapshot);

    const detached = await manager.detachManaged(root, REMOTE);
    expect(detached).toEqual({ managed: true });
    expect(await configValues(root, `credential.${REMOTE}.helper`)).toEqual(["manager-core"]);
    expect(await configValues(root, `credential.${REMOTE}.puppyonemanaged`)).toEqual([]);
    expect(await configValues(root, `credential.${REMOTE}.puppyonesnapshot`)).toEqual([]);
    expect(calls.filter((entry) => entry.args.includes("reject"))).toHaveLength(1);
  });

  it("never sends a secret to shell/path helpers and fails closed without an allowlisted helper", async () => {
    const root = await createRepository();
    await git(root, "config", "--local", "--add", "credential.helper", "!steal $@ /tmp/capture");
    await git(root, "config", "--local", "--add", "credential.helper", "/tmp/git-credential-evil");
    const calls = [];
    const manager = createCloudPublishGitCredentialManager({
      platform: "linux",
      execGitCommand: isolatedCredentialExec(calls),
    });

    await expect(manager.prepare(root, REMOTE, OPERATION)).rejects.toMatchObject({
      code: "SECURE_GIT_CREDENTIAL_HELPER_REQUIRED",
    });
    expect(calls.some((entry) => entry.args.includes("credential"))).toBe(false);
    expect(await configValues(root, "credential.helper")).toEqual([
      "!steal $@ /tmp/capture",
      "/tmp/git-credential-evil",
    ]);
  });

  it("rejects an oversized durable snapshot before mutating scoped config", async () => {
    const root = await createRepository();
    for (let index = 0; index < 20; index += 1) {
      await git(
        root,
        "config",
        "--local",
        "--add",
        `credential.${REMOTE}.helper`,
        `${index}-${"x".repeat(4_080)}`,
      );
    }
    const calls = [];
    const baseExec = isolatedCredentialExec([]);
    const manager = createCloudPublishGitCredentialManager({
      platform: "darwin",
      execGitCommand: async (rootPath, args, options) => {
        calls.push([...args]);
        return baseExec(rootPath, args, options);
      },
    });

    await expect(manager.prepare(root, REMOTE, OPERATION)).rejects.toMatchObject({
      code: "PUPPYONE_CREDENTIAL_CONFIG_CONFLICT",
    });
    expect(calls.some((args) => args.includes("--unset-all") || args.includes("--add"))).toBe(false);
    expect(await configValues(root, `credential.${REMOTE}.puppyonemanaged`)).toEqual([]);
  });

  it("fails closed and restores config when a helper cannot read back an approved credential", async () => {
    const root = await createRepository();
    const manager = createCloudPublishGitCredentialManager({
      platform: "darwin",
      execGitCommand: async (rootPath, args, options = {}) => {
        if (args.includes("approve") || args.includes("reject")) {
          return { stdout: "", stderr: "" };
        }
        if (args.includes("fill")) {
          const error = new Error("helper failed");
          error.stderr = "failed to get: -50\n";
          throw error;
        }
        return execGit(rootPath, args, options);
      },
    });
    const snapshot = await manager.prepare(root, REMOTE, OPERATION);

    await expect(manager.approve(
      root,
      REMOTE,
      "x-puppyone-token",
      "pwg_must_not_appear_in_error",
      OPERATION,
      snapshot,
    )).rejects.toMatchObject({
      code: "PUPPYONE_CREDENTIAL_ROUNDTRIP_FAILED",
      message: expect.stringMatching(/failed to get: -50/i),
    });
    expect(await configValues(root, `credential.${REMOTE}.helper`)).toEqual([]);
  });

  it("keeps saga commands pinned to the safe helper and detects a concurrent local mutation", async () => {
    const root = await createRepository();
    const manager = createCloudPublishGitCredentialManager({
      platform: "darwin",
      execGitCommand: isolatedCredentialExec([]),
    });
    const snapshot = await manager.prepare(root, REMOTE, OPERATION);
    await manager.approve(root, REMOTE, "x-puppyone-token", "pwg_race", OPERATION, snapshot);
    await git(
      root,
      "config",
      "--local",
      "--replace-all",
      `credential.${REMOTE}.helper`,
      "!malicious-capture",
    );

    const command = manager.commandArgs(REMOTE, snapshot, ["ls-remote", REMOTE]);
    expect(command).toContain(`credential.${REMOTE}.helper=`);
    expect(command).toContain(`credential.${REMOTE}.helper=osxkeychain`);
    expect(command.join(" ")).not.toContain("malicious-capture");
    await expect(manager.assertManaged(root, REMOTE, OPERATION, snapshot)).rejects.toMatchObject({
      code: "PUPPYONE_CREDENTIAL_CONFIG_CONFLICT",
    });
  });

  it("resumes owned partial multi-value config writes after a crash", async () => {
    const root = await createRepository();
    await git(root, "config", "--local", "--add", `credential.${REMOTE}.helper`, "store");
    await git(root, "config", "--local", "--add", `credential.${REMOTE}.helper`, "cache");
    const manager = createCloudPublishGitCredentialManager({
      platform: "darwin",
      execGitCommand: isolatedCredentialExec([]),
    });
    const snapshot = await manager.prepare(root, REMOTE, OPERATION);
    await manager.approve(root, REMOTE, "x-puppyone-token", "pwg_resume", OPERATION, snapshot);

    // Crash midway through restoring ["store", "cache"] after unset-all.
    await git(root, "config", "--local", "--unset-all", `credential.${REMOTE}.helper`);
    await git(root, "config", "--local", "--add", `credential.${REMOTE}.helper`, "store");
    await manager.cleanupManaged(root, REMOTE, "x-puppyone-token", OPERATION, snapshot);

    expect(await configValues(root, `credential.${REMOTE}.helper`)).toEqual(["store", "cache"]);
    expect(await configValues(root, `credential.${REMOTE}.puppyonemanaged`)).toEqual([]);
    expect(await configValues(root, `credential.${REMOTE}.puppyonesnapshot`)).toEqual([]);
  });

  it("recovers every successful config-write crash point during install and restore", async () => {
    // Install has seven successful mutations for this two-value fixture;
    // restore has eight. Failed unset-all calls on absent metadata have no
    // side effect and therefore are not crash boundaries.
    for (const phase of ["install", "restore"]) {
      const crashPoints = phase === "install" ? 7 : 8;
      for (let crashAfter = 1; crashAfter <= crashPoints; crashAfter += 1) {
        const root = await createRepository();
        await git(root, "config", "--local", "--add", `credential.${REMOTE}.helper`, "store");
        await git(root, "config", "--local", "--add", `credential.${REMOTE}.helper`, "cache");
        await git(root, "config", "--local", "--add", `credential.${REMOTE}.useHttpPath`, "false");
        await git(root, "config", "--local", "--add", `credential.${REMOTE}.useHttpPath`, "legacy");
        const stableManager = createCloudPublishGitCredentialManager({
          platform: "darwin",
          execGitCommand: isolatedCredentialExec([]),
        });
        const snapshot = await stableManager.prepare(root, REMOTE, OPERATION);
        if (phase === "restore") {
          await stableManager.approve(root, REMOTE, "x-puppyone-token", "pwg_stable", OPERATION, snapshot);
        }
        const crashingManager = createCloudPublishGitCredentialManager({
          platform: "darwin",
          execGitCommand: crashAfterSuccessfulConfigMutation(crashAfter),
        });

        const interrupted = phase === "install"
          ? crashingManager.approve(root, REMOTE, "x-puppyone-token", "pwg_crash", OPERATION, snapshot)
          : crashingManager.cleanupManaged(root, REMOTE, "x-puppyone-token", OPERATION, snapshot);
        await expect(interrupted).rejects.toMatchObject({ simulateCrash: true });

        if (phase === "install") {
          await stableManager.approve(root, REMOTE, "x-puppyone-token", "pwg_resume", OPERATION, snapshot);
          await stableManager.assertManaged(root, REMOTE, OPERATION, snapshot);
        }
        await stableManager.cleanupManaged(root, REMOTE, "x-puppyone-token", OPERATION, snapshot);
        expect(await configValues(root, `credential.${REMOTE}.helper`)).toEqual(["store", "cache"]);
        expect(await configValues(root, `credential.${REMOTE}.useHttpPath`)).toEqual(["false", "legacy"]);
      }
    }
  }, 30_000);
});

function isolatedCredentialExec(calls) {
  let approved = null;
  return async (rootPath, args, options = {}) => {
    if (args.includes("credential")) {
      calls.push({ args: [...args], input: options.input ?? "" });
      const action = args.at(-1);
      if (action === "approve") approved = parseCredentialInput(options.input);
      if (action === "reject") approved = null;
      if (action === "fill" && approved) {
        return {
          stdout: Object.entries(approved).map(([key, value]) => `${key}=${value}`).join("\n") + "\n",
          stderr: "",
        };
      }
      return { stdout: "", stderr: "" };
    }
    let isolated = args;
    if (args.join(" ") === "config --get-all credential.helper") {
      isolated = ["config", "--local", "--get-all", "credential.helper"];
    } else if (args[0] === "config" && args[1] === "--get-urlmatch") {
      isolated = ["config", "--local", ...args.slice(1)];
    }
    return execGit(rootPath, isolated, options);
  };
}

function parseCredentialInput(value) {
  return Object.fromEntries(String(value || "").trim().split(/\r?\n/).filter(Boolean).map((line) => {
    const separator = line.indexOf("=");
    return [line.slice(0, separator), line.slice(separator + 1)];
  }));
}

function crashAfterSuccessfulConfigMutation(crashAfter) {
  const execute = isolatedCredentialExec([]);
  const crash = Object.assign(new Error(`crash after config mutation ${crashAfter}`), {
    simulateCrash: true,
  });
  let successfulMutations = 0;
  let crashed = false;
  return async (rootPath, args, options = {}) => {
    if (crashed) throw crash;
    const result = await execute(rootPath, args, options);
    const mutation = args[0] === "config"
      && args[1] === "--local"
      && ["--unset-all", "--add"].includes(args[2]);
    if (mutation && ++successfulMutations === crashAfter) {
      crashed = true;
      throw crash;
    }
    return result;
  };
}

async function createRepository() {
  const root = await mkdtemp(path.join(os.tmpdir(), "puppyone-credential-root-"));
  roots.push(root);
  await git(root, "init", "-q");
  return root;
}

async function configValues(root, key) {
  try {
    const output = await git(root, "config", "--local", "--get-all", key);
    const values = output.split(/\r?\n/);
    return values;
  } catch {
    return [];
  }
}

async function git(cwd, ...args) {
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], {
    env: { ...process.env, LC_ALL: "C", LANG: "C" },
  });
  return stdout.endsWith("\n") ? stdout.slice(0, -1) : stdout;
}
