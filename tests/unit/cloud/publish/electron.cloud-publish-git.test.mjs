import { describe, expect, it, vi } from "vitest";
import {
  CLOUD_INITIAL_PUSH_TIMEOUT_MS,
  createCloudPublishGitService,
} from "../../../../electron/main/cloud-publish-git.mjs";

const REMOTE = "https://api.puppyone.test/git/project-1.git";
const HEAD = "0123456789abcdef0123456789abcdef01234567";

describe("Cloud publish Git diagnostics", () => {
  it("reports credential setup failure while redacting credential material", async () => {
    let remoteExists = false;
    const rollback = vi.fn(async () => undefined);
    const service = createCloudPublishGitService({
      execGitCommand: async (_rootPath, args) => {
        if (args[0] === "cat-file" && args[1] === "-e") return { stdout: "", stderr: "" };
        if (args.join(" ") === "remote") {
          return { stdout: remoteExists ? "puppyone\n" : "", stderr: "" };
        }
        if (args[0] === "remote" && args[1] === "add") {
          remoteExists = true;
          return { stdout: "", stderr: "" };
        }
        if (args[0] === "remote" && args[1] === "get-url") {
          return { stdout: `${REMOTE}\n`, stderr: "" };
        }
        if (args.includes("ls-remote")) {
          const error = new Error("Git remote verification failed");
          error.stderr = "fatal: Authentication failed for 'https://x-puppyone-token:pwg_do_not_leak@api.puppyone.test/git/project-1.git'";
          throw error;
        }
        throw new Error(`Unexpected Git command: ${args.join(" ")}`);
      },
      gitCredentialManager: {
        prepare: async () => ({}),
        approve: async () => ({ rollback }),
        assertManaged: async () => { throw new Error("Authentication failed pwg_do_not_leak"); },
        cleanupManaged: async () => undefined,
        commandArgs: (_url, _snapshot, args) => args,
      },
    });

    await expect(service.configureCanonicalRemote("/workspace", record(), "pwg_do_not_leak"))
      .rejects.toMatchObject({
        publishCode: "REMOTE_CONFIG_FAILED",
        message: expect.stringMatching(/verifying the managed credential configuration.*Authentication failed/i),
      });
    await expect(service.configureCanonicalRemote("/workspace", record(), "pwg_do_not_leak"))
      .rejects.not.toThrow(/pwg_do_not_leak|x-puppyone-token:/i);
    expect(rollback).toHaveBeenCalled();
  });

  it("uses the long initial-push budget and reconciles an uncertain timeout", async () => {
    let remoteReadCount = 0;
    const waits = [];
    const rollback = vi.fn(async () => undefined);
    const execGitCommand = vi.fn(async (_rootPath, args, options = {}) => {
      const command = args.includes("push") ? "push" : args[0];
      if (command === "cat-file" && args[1] === "-e") return { stdout: "", stderr: "" };
      if (args.join(" ") === "remote") return { stdout: "puppyone\n", stderr: "" };
      if (command === "remote" && args.includes("get-url")) {
        return { stdout: `${REMOTE}\n`, stderr: "" };
      }
      if (command === "ls-remote") {
        remoteReadCount += 1;
        return {
          stdout: remoteReadCount >= 1 ? `${HEAD}\trefs/heads/main\n` : "",
          stderr: "",
        };
      }
      if (command === "push") {
        expect(options.timeout).toBe(CLOUD_INITIAL_PUSH_TIMEOUT_MS);
        const error = new Error("Git command timed out");
        error.code = "ETIMEDOUT";
        error.killed = true;
        throw error;
      }
      if (command === "update-ref" || command === "branch") {
        return { stdout: "", stderr: "" };
      }
      throw new Error(`Unexpected Git command: ${args.join(" ")}`);
    });
    const service = createCloudPublishGitService({
      execGitCommand,
      fetchImpl: async () => ({ ok: false, status: 404 }),
      wait: async (delayMs) => waits.push(delayMs),
      gitCredentialManager: {
        prepare: async () => ({}),
        approve: async () => ({ rollback }),
        assertManaged: async () => undefined,
        cleanupManaged: async () => undefined,
        commandArgs: (_url, _snapshot, args) => args,
      },
    });

    await expect(service.pushExpectedCommit("/workspace", record(), "pwg_secret"))
      .resolves.toEqual({ remoteHead: HEAD });
    const pushCalls = execGitCommand.mock.calls.filter(([, args]) => args.includes("push"));
    expect(pushCalls).toHaveLength(1);
    expect(pushCalls[0][1]).toEqual([
      "-c", `http.${REMOTE}.extraHeader=X-PuppyOne-Initial-Attempt: ${record().attempt.attempt_id}`,
      "push",
      "--progress",
      "--force-with-lease=refs/heads/main:",
      REMOTE,
      `${HEAD}:refs/heads/main`,
    ]);
    expect(waits).toEqual([]);
    expect(remoteReadCount).toBe(1);
    expect(rollback).not.toHaveBeenCalled();
  });

  it.each([
    ["connection timed out", "PUSH_UNCERTAIN"],
    ["remote: unpack invalid pack: incoming pack expansion budget exceeded", "PUSH_LIMIT_EXCEEDED"],
    ["remote: unpack invalid pack: incoming expanded pack budget exceeded", "PUSH_LIMIT_EXCEEDED"],
    ["remote: unpack invalid pack: Git single-object budget exceeded", "PUSH_LIMIT_EXCEEDED"],
    ["remote: unpack invalid pack: Git pack exceeds the 2147483648-byte limit for this operation", "PUSH_LIMIT_EXCEEDED"],
    ["RPC failed; HTTP 413 curl 22 The requested URL returned error: 413\nfatal: the remote end hung up unexpectedly", "PUSH_LIMIT_EXCEEDED"],
    ["remote: unpack invalid pack: completed Git pack exceeds the storage processing budget", "PUSH_LIMIT_EXCEEDED"],
    ["remote: unpack invalid pack: Git pack checksum mismatch", "PUSH_FAILED"],
  ])("classifies %s after checking that the desired ref was not published", async (diagnostic, code) => {
    const waits = [];
    const execGitCommand = vi.fn(async (_rootPath, args) => {
      if (args[0] === "cat-file" && args[1] === "-e") return { stdout: "", stderr: "" };
      if (args.join(" ") === "remote") return { stdout: "puppyone\n", stderr: "" };
      if (args[0] === "remote" && args.includes("get-url")) {
        return { stdout: `${REMOTE}\n`, stderr: "" };
      }
      if (args[0] === "ls-remote") return { stdout: "", stderr: "" };
      if (args.includes("push")) {
        throw Object.assign(new Error("Git push failed"), { stderr: diagnostic });
      }
      throw new Error(`Unexpected Git command: ${args.join(" ")}`);
    });
    const service = createCloudPublishGitService({
      execGitCommand,
      fetchImpl: async () => ({ ok: false, status: 404 }),
      wait: async (delayMs) => waits.push(delayMs),
      gitCredentialManager: {
        prepare: async () => ({}),
        approve: async () => ({ rollback: async () => undefined }),
        assertManaged: async () => undefined,
        cleanupManaged: async () => undefined,
        commandArgs: (_url, _snapshot, args) => args,
      },
    });

    await expect(service.pushExpectedCommit("/workspace", record(), "pwg_secret"))
      .rejects.toMatchObject({ publishCode: code, publishRetryable: true });
    expect(waits).toEqual([]);
    expect(execGitCommand.mock.calls.filter(([, args]) => args[0] === "ls-remote")).toHaveLength(1);
    expect(execGitCommand.mock.calls.filter(([, args]) => args.includes("push"))).toHaveLength(1);
  });

  it.each([false, true])("handles explicit size rejection when status is unavailable or already accepted (%s)", async (accepted) => {
    const execGitCommand = vi.fn(async (_rootPath, args) => {
      if (args[0] === "cat-file") return { stdout: "", stderr: "" };
      if (args.join(" ") === "remote") return { stdout: "puppyone\n", stderr: "" };
      if (args[0] === "remote") return { stdout: `${REMOTE}\n`, stderr: "" };
      if (args[0] === "ls-remote") {
        if (accepted) return { stdout: `${HEAD}\trefs/heads/main\n`, stderr: "" };
        throw new Error("connection timed out");
      }
      if (args.includes("push")) {
        throw Object.assign(new Error("Git push failed"), {
          stderr: "RPC failed; HTTP 413 curl 22\nfatal: the remote end hung up unexpectedly",
        });
      }
      throw new Error(`Unexpected Git command: ${args.join(" ")}`);
    });
    const service = createCloudPublishGitService({
      execGitCommand,
      fetchImpl: async () => { throw new Error("connection timed out"); },
      gitCredentialManager: {
        prepare: async () => ({}),
        approve: async () => ({ rollback: async () => undefined }),
        assertManaged: async () => undefined,
        cleanupManaged: async () => undefined,
        commandArgs: (_url, _snapshot, args) => args,
      },
    });
    const result = service.pushExpectedCommit("/workspace", record(), "pwg_secret");
    if (accepted) await expect(result).resolves.toEqual({ remoteHead: HEAD });
    else await expect(result).rejects.toMatchObject({
      publishCode: "PUSH_LIMIT_EXCEEDED", message: expect.stringContaining("2 GiB"),
    });
    expect(execGitCommand.mock.calls.filter(([, args]) => args.includes("push"))).toHaveLength(1);
    expect(execGitCommand.mock.calls.some(([, args]) => args.includes("pack-objects"))).toBe(false);
  });
});

function record() {
  return {
    operation_id: "11111111-1111-4111-8111-111111111111",
    project_id: "project-1",
    credential_id: "credential-1",
    canonical_remote_url: REMOTE,
    credential_username: "x-puppyone-token",
    credential_config_snapshot: { helper: "osxkeychain" },
    selected_source_branch: "main",
    selected_source_ref: "refs/heads/main",
    attempt: {
      attempt_id: "11111111-1111-4111-8111-111111111112",
      commit_oid: HEAD,
      state: "uploading",
    },
    remote_add_intent: true,
  };
}
