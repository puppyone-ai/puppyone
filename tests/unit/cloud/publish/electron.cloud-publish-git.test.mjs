import { describe, expect, it, vi } from "vitest";
import {
  CLOUD_INITIAL_PUSH_TIMEOUT_MS,
  createCloudPublishGitService,
} from "../../../../electron/main/cloud-publish-git.mjs";

const REMOTE = "https://api.puppyone.test/git/project-1.git";
const HEAD = "0123456789abcdef0123456789abcdef01234567";

describe("Cloud publish Git diagnostics", () => {
  it("reports the failing remote stage while redacting credential material", async () => {
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
        assertManaged: async () => undefined,
        cleanupManaged: async () => undefined,
        commandArgs: (_url, _snapshot, args) => args,
      },
    });

    await expect(service.configureCanonicalRemote("/workspace", record(), "pwg_do_not_leak"))
      .rejects.toMatchObject({
        publishCode: "REMOTE_CONFIG_FAILED",
        message: expect.stringMatching(/verifying Cloud Git access.*Authentication failed/i),
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
      const command = args[0];
      if (command === "cat-file" && args[1] === "-e") return { stdout: "", stderr: "" };
      if (args.join(" ") === "remote") return { stdout: "puppyone\n", stderr: "" };
      if (command === "remote" && args.includes("get-url")) {
        return { stdout: `${REMOTE}\n`, stderr: "" };
      }
      if (command === "ls-remote") {
        remoteReadCount += 1;
        return {
          stdout: remoteReadCount >= 3 ? `${HEAD}\trefs/heads/main\n` : "",
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
    const pushCalls = execGitCommand.mock.calls.filter(([, args]) => args[0] === "push");
    expect(pushCalls).toHaveLength(1);
    expect(pushCalls[0][1]).toEqual([
      "push",
      "--force-with-lease=refs/heads/main:",
      REMOTE,
      `${HEAD}:refs/heads/main`,
    ]);
    expect(waits).toEqual([2_000]);
    expect(rollback).not.toHaveBeenCalled();
  });

  it("returns an explicit uncertain state when timeout reconciliation cannot prove the ref", async () => {
    const waits = [];
    const execGitCommand = vi.fn(async (_rootPath, args) => {
      if (args[0] === "cat-file" && args[1] === "-e") return { stdout: "", stderr: "" };
      if (args.join(" ") === "remote") return { stdout: "puppyone\n", stderr: "" };
      if (args[0] === "remote" && args.includes("get-url")) {
        return { stdout: `${REMOTE}\n`, stderr: "" };
      }
      if (args[0] === "ls-remote") return { stdout: "", stderr: "" };
      if (args[0] === "push") {
        throw Object.assign(new Error("connection timed out"), { code: "ETIMEDOUT", killed: true });
      }
      throw new Error(`Unexpected Git command: ${args.join(" ")}`);
    });
    const service = createCloudPublishGitService({
      execGitCommand,
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
      .rejects.toMatchObject({ publishCode: "PUSH_UNCERTAIN", publishRetryable: true });
    expect(waits).toEqual([2_000, 5_000, 10_000, 20_000, 30_000]);
    expect(execGitCommand.mock.calls.filter(([, args]) => args[0] === "push")).toHaveLength(1);
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
