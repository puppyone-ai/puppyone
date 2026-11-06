import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { createCloudPublishCoordinator } from "../../../electron/main/cloud-publish-coordinator.mjs";
import { execGit } from "../../../electron/local-api/git/runner.mjs";

const execFileAsync = promisify(execFile);

/**
 * The first-push coordinator against a real local repository and a bare
 * repository standing in for Cloud. The Cloud API is a controlled fake: it
 * proves Desktop's own sequence, not what a real Puppyone server accepts.
 * Server acceptance belongs to cross-repository tests against a running
 * backend; a pass here must not be read as one.
 */

export async function git(cwd, ...args) {
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], {
    env: { ...process.env, LC_ALL: "C", LANG: "C" },
  });
  return stdout.trim();
}

/** The default repository: one commit with one file. */
export async function writeInitialCommit(root) {
  await writeFile(path.join(root, "README.md"), "publish");
  await git(root, "add", "README.md");
  await git(root, "commit", "-qm", "initial");
}

/**
 * `roots` collects every temporary directory for the caller's cleanup.
 * `prepareRepository` builds the history; it runs in an initialized repository
 * with a configured identity, and the branch is renamed afterwards.
 */
export async function createPublishFixture(branch, { roots, prepareRepository = writeInitialCommit } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "puppyone-publish-root-"));
  const bare = await mkdtemp(path.join(os.tmpdir(), "puppyone-publish-bare-"));
  roots?.push(root, bare);
  await git(root, "init", "-q");
  await git(root, "config", "user.email", "test@puppyone.invalid");
  await git(root, "config", "user.name", "PuppyOne Test");
  await prepareRepository(root);
  if (branch !== "master") await git(root, "branch", "-M", branch);
  await git(bare, "init", "--bare", "-q");
  const head = await git(root, "rev-parse", "HEAD");
  const vault = new Map();
  const secretVault = {
    createRef: () => "11111111-1111-4111-8111-111111111111",
    put: async (ref, secret) => { vault.set(ref, secret); },
    get: async (ref) => vault.get(ref) ?? null,
    clear: async (ref) => { vault.delete(ref); },
  };
  const cloud = createPublishCloud();
  const remoteUrl = "https://api.puppyone.test/git/project-1.git";
  cloud.remoteUrl = remoteUrl;
  return {
    root,
    bare,
    head,
    vault,
    secretVault,
    cloud,
    remoteUrl,
    request: {
      rootPath: root,
      apiBaseUrl: "http://127.0.0.1:8000/api/v1",
      userId: "user-1",
      organizationId: "org-1",
      projectName: "Publish fixture",
      sourceBranch: branch,
      action: "initialize",
    },
  };
}

export function createPublishCloud() {
  const requests = [];
  const cloud = {
    requests,
    projectGate: null,
    readSession: async () => ({
      user_id: "user-1",
      api_base_url: "http://127.0.0.1:8000/api/v1",
      status: "authenticated",
    }),
    requestSessionApi: async (_api, requestPath, init) => {
      const body = init.body ? JSON.parse(init.body) : null;
      requests.push({ path: requestPath, init, body });
      if (requestPath === "/projects/") {
        if (cloud.projectGate) await cloud.projectGate;
        return {
          id: "project-1",
          ...(cloud.omitProjectOrganization ? {} : { org_id: body.org_id }),
          name: cloud.projectName ?? body.name,
        };
      }
      if (requestPath === "/projects/project-1/git-credentials") {
        if (cloud.projectUnavailable) {
          throw Object.assign(new Error("Project no longer exists"), { status: 404 });
        }
        return {
          id: "credential-1",
          mode: "rw",
          remote: {
            url: cloud.remoteUrl,
            username: "x-puppyone-token",
            target: body.target,
          },
        };
      }
      if (requestPath === "/projects/project-1/initialization/abandon") {
        if (cloud.projectUnavailable) {
          throw Object.assign(new Error("Project no longer exists"), { status: 404 });
        }
        if (cloud.abandonFailures > 0) {
          cloud.abandonFailures -= 1;
          throw Object.assign(new Error("temporary cleanup failure"), { status: 503 });
        }
        return { abandoned: true };
      }
      if (
        requestPath === "/projects/project-1/git-credentials/credential-1"
        && init.method === "DELETE"
      ) {
        return null;
      }
      throw new Error(`Unexpected request: ${requestPath}`);
    },
  };
  return cloud;
}

export function createPublishCoordinator(fixture, options = {}) {
  const credentialConfigSnapshot = {
    version: 1,
    scope_url: fixture.remoteUrl,
    helper: "osxkeychain",
    previous_helpers: [],
    previous_use_http_path: [],
  };
  return createCloudPublishCoordinator({
    cloudAuthService: fixture.cloud,
    fetchImpl: options.fetchImpl ?? (async () => ({ ok: false, status: 404 })),
    secretVault: options.secretVault ?? fixture.secretVault,
    gitCredentialManager: {
      prepare: async () => credentialConfigSnapshot,
      approve: async () => ({ rollback: async () => undefined }),
      assertManaged: async () => undefined,
      cleanupManaged: async () => undefined,
      commandArgs: (remoteUrl, snapshot, args) => [
        "-c", `credential.${remoteUrl}.helper=`,
        "-c", `credential.${remoteUrl}.helper=${snapshot.helper}`,
        "-c", `credential.${remoteUrl}.useHttpPath=true`,
        ...args,
      ],
    },
    execGitCommand: async (rootPath, args, commandOptions) => {
      await options.onExecGitCommand?.(args);
      const mapped = args.some((arg) => ["ls-remote", "push"].includes(arg))
        ? args.map((arg) => arg === fixture.remoteUrl ? fixture.bare : arg)
        : args;
      return execGit(rootPath, mapped, commandOptions);
    },
    validateRemoteUrl: options.validateRemoteUrl ?? ((value) => value),
    faultInjector: options.faultInjector,
    telemetry: options.telemetry,
  });
}
