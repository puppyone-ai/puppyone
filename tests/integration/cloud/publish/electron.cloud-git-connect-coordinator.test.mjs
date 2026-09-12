import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCloudGitConnectCoordinator } from "../../../../electron/main/cloud-git-connect-coordinator.mjs";
import { execGit } from "../../../../local-api/git/runner.mjs";

const execFileAsync = promisify(execFile);
const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("main-owned canonical Cloud Git connect", () => {
  it("issues and stores the credential entirely in main and returns only public Project identity", async () => {
    const fixture = await createFixture();
    const result = await createCoordinator(fixture).connect(fixture.request);

    expect(result).toMatchObject({
      ok: true,
      projectId: "project-1",
      target: { kind: "project_root", project_id: "project-1" },
      gitStatus: { isRepo: true },
    });
    expect(JSON.stringify(result)).not.toContain("pwg_");
    expect(await git(fixture.root, "remote", "get-url", "puppyone")).toBe(fixture.remoteUrl);
    const issue = fixture.cloud.requests.find((entry) => entry.path.endsWith("/git-credentials"));
    expect(issue.init.headers).toMatchObject({
      "Idempotency-Key": expect.stringMatching(/^[0-9a-f-]{36}$/),
      "X-PuppyOne-Repository-Contract": "2",
    });
    expect(issue.body.credential).toMatch(/^pwg_/);
    expect(fixture.vault.size).toBe(0);
    await expect(readJournal(fixture.root)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("replays the same credential operation after response loss without exposing or rotating its secret", async () => {
    const fixture = await createFixture();
    const crash = Object.assign(new Error("lost credential response"), { simulateCrash: true });
    await expect(createCoordinator(fixture, {
      faultInjector: async (point) => {
        if (point === "connect-after-credential-response") throw crash;
      },
    }).connect(fixture.request)).rejects.toBe(crash);

    const journal = await readJournal(fixture.root);
    expect(journal).not.toContain("pwg_");
    const resumed = await createCoordinator(fixture).connect(fixture.request);
    expect(resumed.ok).toBe(true);
    const issues = fixture.cloud.requests.filter((entry) => entry.path.endsWith("/git-credentials"));
    expect(issues).toHaveLength(2);
    expect(new Set(issues.map((entry) => entry.init.headers["Idempotency-Key"])).size).toBe(1);
    expect(new Set(issues.map((entry) => entry.body.credential)).size).toBe(1);
  });

  it("rejects a tampered connect journal before reading a secret or running network Git", async () => {
    const fixture = await createFixture();
    const crash = Object.assign(new Error("pause with credential state"), { simulateCrash: true });
    await expect(createCoordinator(fixture, {
      faultInjector: async (point) => {
        if (point === "connect-after-credential-config-journaled") throw crash;
      },
    }).connect(fixture.request)).rejects.toBe(crash);

    const gitDir = await git(fixture.root, "rev-parse", "--absolute-git-dir");
    const journalPath = path.join(gitDir, "puppyone", "pending-cloud-git-connect.v1.json");
    const record = JSON.parse(await readFile(journalPath, "utf8"));
    record.canonical_remote_url = "https://attacker.invalid/git/project-1.git";
    record.credential_config_snapshot.scope_url = record.canonical_remote_url;
    await writeFile(journalPath, `${JSON.stringify(record)}\n`, { mode: 0o600 });

    const secretGet = vi.fn(fixture.secretVault.get);
    const networkGit = [];
    const result = await createCoordinator(fixture, {
      secretVault: { ...fixture.secretVault, get: secretGet },
      validateRemoteUrl: (value) => {
        if (value !== fixture.remoteUrl) throw new Error("untrusted remote");
        return value;
      },
      onExecGitCommand: (args) => {
        if (args.includes("ls-remote") || args.includes("push")) networkGit.push(args);
      },
    }).connect(fixture.request);

    expect(result).toMatchObject({ ok: false, error: { code: "REMOTE_CONFLICT" } });
    expect(secretGet).not.toHaveBeenCalled();
    expect(networkGit).toEqual([]);
  });

  it("resumes after remote add and fails closed if that exact remote is later repointed", async () => {
    const fixture = await createFixture();
    const crash = Object.assign(new Error("crash after remote"), { simulateCrash: true });
    await expect(createCoordinator(fixture, {
      faultInjector: async (point) => {
        if (point === "connect-after-remote-configured") throw crash;
      },
    }).connect(fixture.request)).rejects.toBe(crash);
    await git(fixture.root, "remote", "set-url", "puppyone", "https://attacker.invalid/git/project-1.git");

    const result = await createCoordinator(fixture).connect(fixture.request);
    expect(result).toMatchObject({ ok: false, error: { code: "REMOTE_CONFLICT" } });
    expect(await git(fixture.root, "remote", "get-url", "puppyone"))
      .toBe("https://attacker.invalid/git/project-1.git");
  });

  it("revokes server state before exact local compensation and sends repository contract v2", async () => {
    const fixture = await createFixture();
    const crash = Object.assign(new Error("pause after remote"), { simulateCrash: true });
    await expect(createCoordinator(fixture, {
      faultInjector: async (point) => {
        if (point === "connect-after-remote-configured") throw crash;
      },
    }).connect(fixture.request)).rejects.toBe(crash);
    const record = JSON.parse(await readJournal(fixture.root));

    const result = await createCoordinator(fixture).abandon({
      ...fixture.request,
      operationId: record.operation_id,
    });
    expect(result.ok).toBe(true);
    const revoke = fixture.cloud.requests.find((entry) => entry.init.method === "DELETE");
    expect(revoke.init.headers).toMatchObject({
      "Idempotency-Key": record.operation_id,
      "X-PuppyOne-Repository-Contract": "2",
    });
    await expect(git(fixture.root, "remote", "get-url", "puppyone")).rejects.toBeTruthy();
    await expect(readJournal(fixture.root)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("treats a lost completed IPC response as idempotent after ProjectGrant verification", async () => {
    const fixture = await createFixture();
    const first = await createCoordinator(fixture).connect(fixture.request);
    expect(first.ok).toBe(true);

    const retried = await createCoordinator(fixture).connect(fixture.request);
    expect(retried).toMatchObject({
      ok: true,
      projectId: "project-1",
      target: { kind: "project_root", project_id: "project-1" },
    });
    expect(fixture.cloud.requests.filter((entry) => entry.path.endsWith("/git-credentials")))
      .toHaveLength(1);
    const context = fixture.cloud.requests.find((entry) => entry.path.endsWith("/repository-context"));
    expect(context.init.headers).toMatchObject({ "X-PuppyOne-Repository-Contract": "2" });
  });

  it("rejects a completed canonical remote when a retry requests a different Project", async () => {
    const fixture = await createFixture();
    expect((await createCoordinator(fixture).connect(fixture.request)).ok).toBe(true);
    const strictValidator = (value, { projectId }) => {
      if (new URL(value).pathname !== `/git/${projectId}.git`) throw new Error("wrong Project");
      return value;
    };

    const retried = await createCoordinator(fixture, { validateRemoteUrl: strictValidator }).connect({
      ...fixture.request,
      projectId: "project-other",
    });
    expect(retried).toMatchObject({ ok: false, error: { code: "REMOTE_CONFLICT" } });
    expect(fixture.cloud.requests.filter((entry) => entry.path.includes("project-other"))).toHaveLength(0);
  });

  it("remembers remote-add ownership across a crash, resume, and later Abandon", async () => {
    const fixture = await createFixture();
    const firstCrash = Object.assign(new Error("crash after remote add"), { simulateCrash: true });
    await expect(createCoordinator(fixture, {
      faultInjector: async (point) => {
        if (point === "after-remote-add") throw firstCrash;
      },
    }).connect(fixture.request)).rejects.toBe(firstCrash);

    const secondCrash = Object.assign(new Error("pause after recovered ownership"), { simulateCrash: true });
    await expect(createCoordinator(fixture, {
      faultInjector: async (point) => {
        if (point === "connect-after-remote-configured") throw secondCrash;
      },
    }).connect(fixture.request)).rejects.toBe(secondCrash);
    const record = JSON.parse(await readJournal(fixture.root));
    expect(record).toMatchObject({ remote_add_intent: true, remote_created_by_operation: true });

    const abandoned = await createCoordinator(fixture).abandon({
      ...fixture.request,
      operationId: record.operation_id,
    });
    expect(abandoned.ok).toBe(true);
    await expect(git(fixture.root, "remote", "get-url", "puppyone")).rejects.toBeTruthy();
  });
});

async function createFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "puppyone-connect-root-"));
  const bare = await mkdtemp(path.join(os.tmpdir(), "puppyone-connect-bare-"));
  roots.push(root, bare);
  await git(root, "init", "-q");
  await git(root, "config", "user.email", "test@puppyone.invalid");
  await git(root, "config", "user.name", "PuppyOne Test");
  await writeFile(path.join(root, "README.md"), "connect\n");
  await git(root, "add", "README.md");
  await git(root, "commit", "-qm", "initial");
  await git(bare, "init", "--bare", "-q");
  const remoteUrl = "https://api.puppyone.test/git/project-1.git";
  const vault = new Map();
  const secretVault = {
    createRef: () => "22222222-2222-4222-8222-222222222222",
    put: async (ref, value) => { vault.set(ref, value); },
    get: async (ref) => vault.get(ref) ?? null,
    clear: async (ref) => { vault.delete(ref); },
  };
  const requests = [];
  const cloud = {
    requests,
    readSession: async () => ({
      user_id: "user-1",
      api_base_url: "http://127.0.0.1:8000/api/v1",
      status: "authenticated",
    }),
    requestSessionApi: async (_api, requestPath, init) => {
      const body = init.body ? JSON.parse(init.body) : null;
      requests.push({ path: requestPath, init, body });
      if (requestPath === "/projects/project-1/git-credentials" && init.method === "POST") {
        return {
          id: "credential-1",
          mode: "rw",
          remote: {
            url: remoteUrl,
            username: "x-puppyone-token",
            target: body.target,
          },
        };
      }
      if (requestPath === "/projects/project-1/git-credentials/credential-1" && init.method === "DELETE") {
        return { id: "credential-1", revoked: true };
      }
      if (requestPath === "/projects/project-1/repository-context" && init.method === "POST") {
        return {
          project: { id: "project-1" },
          target: { kind: "project_root", project_id: "project-1" },
        };
      }
      throw new Error(`Unexpected request: ${requestPath}`);
    },
  };
  return {
    root,
    bare,
    remoteUrl,
    vault,
    secretVault,
    cloud,
    request: {
      rootPath: root,
      apiBaseUrl: "http://127.0.0.1:8000/api/v1",
      userId: "user-1",
      projectId: "project-1",
    },
  };
}

function createCoordinator(fixture, options = {}) {
  const snapshot = {
    version: 1,
    scope_url: fixture.remoteUrl,
    helper: "osxkeychain",
    previous_helpers: [],
    previous_use_http_path: [],
  };
  return createCloudGitConnectCoordinator({
    cloudAuthService: fixture.cloud,
    secretVault: options.secretVault ?? fixture.secretVault,
    gitCredentialManager: {
      prepare: async () => snapshot,
      approve: async () => ({ rollback: async () => undefined }),
      assertManaged: async () => undefined,
      cleanupManaged: async () => undefined,
      commandArgs: (remoteUrl, credentialSnapshot, args) => [
        "-c", `credential.${remoteUrl}.helper=`,
        "-c", `credential.${remoteUrl}.helper=${credentialSnapshot.helper}`,
        "-c", `credential.${remoteUrl}.useHttpPath=true`,
        ...args,
      ],
    },
    execGitCommand: async (rootPath, args, commandOptions) => {
      options.onExecGitCommand?.(args);
      const mapped = args.includes("ls-remote")
        ? args.map((entry) => entry === fixture.remoteUrl ? fixture.bare : entry)
        : args;
      return execGit(rootPath, mapped, commandOptions);
    },
    validateRemoteUrl: options.validateRemoteUrl ?? ((value) => value),
    faultInjector: options.faultInjector,
  });
}

async function readJournal(root) {
  const gitDir = await git(root, "rev-parse", "--absolute-git-dir");
  return readFile(path.join(gitDir, "puppyone", "pending-cloud-git-connect.v1.json"), "utf8");
}

async function git(cwd, ...args) {
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], {
    env: { ...process.env, LC_ALL: "C", LANG: "C" },
  });
  return stdout.trim();
}
