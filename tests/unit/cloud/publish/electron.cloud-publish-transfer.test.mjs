import { describe, expect, it, vi } from "vitest";
import {
  CLOUD_INITIAL_PUSH_TIMEOUT_MS,
  createCloudPublishGitService,
} from "../../../../electron/main/cloud-publish-git.mjs";
import {
  createGitPushProgressReader,
  stripGitProgressOutput,
} from "../../../../electron/main/cloud-publish-transfer.mjs";

const MIB = 1024 ** 2;
const REMOTE = "https://api.puppyone.test/git/project-1.git";
const HEAD = "0123456789abcdef0123456789abcdef01234567";

/**
 * Shaped exactly like `LC_ALL=C git push --progress` stderr, captured from Git
 * 2.50: preparation lines, then "Writing objects" redrawn in place with \r,
 * bytes and rate appearing once Git has measured them.
 */
const PUSH_STDERR = [
  "Enumerating objects: 42, done.\n",
  "Counting objects:  50% (21/42)\rCounting objects: 100% (42/42), done.\n",
  "Delta compression using up to 10 threads\n",
  "Compressing objects: 100% (42/42), done.\n",
  "Writing objects:   2% (1/42)\r",
  "Writing objects:  45% (19/42), 4.50 MiB | 1.02 MiB/s\r",
  "Writing objects:  97% (41/42), 10.95 MiB | 1.01 MiB/s\r",
  "Writing objects: 100% (42/42), 11.45 MiB | 1.00 MiB/s, done.\n",
  "Total 42 (delta 0), reused 0 (delta 0), pack-reused 0 (from 0)\n",
  "To https://api.puppyone.test/git/project-1.git\n",
  " * [new branch]      0123456 -> main\n",
].join("");

describe("Cloud publish transfer reading", () => {
  it("reads how much is sent and how fast from Git's own progress line", () => {
    const readings = [];
    let clock = 0;
    const reader = createGitPushProgressReader((transfer) => readings.push(transfer), {
      now: () => (clock += 1000),
    });
    reader.write(PUSH_STDERR);
    expect(readings).toEqual([
      // Before Git has measured anything there is only the share sent.
      { percent: 2, sentBytes: null, bytesPerSecond: null },
      { percent: 45, sentBytes: Math.round(4.5 * MIB), bytesPerSecond: Math.round(1.02 * MIB) },
      { percent: 97, sentBytes: Math.round(10.95 * MIB), bytesPerSecond: Math.round(1.01 * MIB) },
      { percent: 100, sentBytes: Math.round(11.45 * MIB), bytesPerSecond: MIB },
    ]);
  });

  it("survives a progress line split across pipe chunks", () => {
    const readings = [];
    let clock = 0;
    const reader = createGitPushProgressReader((transfer) => readings.push(transfer), {
      now: () => (clock += 1000),
    });
    for (const character of PUSH_STDERR) reader.write(character);
    expect(readings.map((reading) => reading.percent)).toEqual([2, 45, 97, 100]);
  });

  it("holds redraws to the interval, but never drops the finish", () => {
    const readings = [];
    const reader = createGitPushProgressReader((transfer) => readings.push(transfer), { now: () => 0 });
    reader.write(PUSH_STDERR);
    // Same instant: the first reading, then only the one that says it is done.
    expect(readings.map((reading) => reading.percent)).toEqual([2, 100]);
  });

  it("keeps the last measured bytes and rate when a redraw omits them", () => {
    const readings = [];
    let clock = 0;
    const reader = createGitPushProgressReader((transfer) => readings.push(transfer), {
      now: () => (clock += 1000),
    });
    reader.write("Writing objects:  40% (4/10), 2.00 MiB | 1.00 MiB/s\rWriting objects:  50% (5/10)\r");
    expect(readings.at(-1)).toEqual({ percent: 50, sentBytes: 2 * MIB, bytesPerSecond: MIB });
  });

  it("never lets a failing listener reach the push", () => {
    const reader = createGitPushProgressReader(() => { throw new Error("renderer gone"); });
    expect(() => reader.write(PUSH_STDERR)).not.toThrow();
  });

  it("leaves only Git's diagnostic once the progress redraws are removed", () => {
    const stderr = `${PUSH_STDERR.split("Total")[0]}remote: Resolving deltas: 100% (3/3)\r\n`
      + "error: RPC failed; HTTP 413 curl 22 The requested URL returned error: 413\n"
      + "fatal: the remote end hung up unexpectedly\n";
    expect(stripGitProgressOutput(stderr)).toBe([
      "error: RPC failed; HTTP 413 curl 22 The requested URL returned error: 413",
      "fatal: the remote end hung up unexpectedly",
    ].join("\n"));
  });
});

describe("Cloud publish push progress", () => {
  function serviceWith(push) {
    return createCloudPublishGitService({
      execGitCommand: vi.fn(async (_rootPath, args, options) => {
        if (args[0] === "cat-file" && args[1] === "-e") return { stdout: "", stderr: "" };
        if (args.join(" ") === "remote") return { stdout: "puppyone\n", stderr: "" };
        if (args[0] === "remote" && args.includes("get-url")) return { stdout: `${REMOTE}\n`, stderr: "" };
        if (args[0] === "ls-remote") return { stdout: "", stderr: "" };
        if (args.includes("push")) return push(args, options);
        if (args[0] === "update-ref" || args[0] === "branch") return { stdout: "", stderr: "" };
        throw new Error(`Unexpected Git command: ${args.join(" ")}`);
      }),
      fetchImpl: async () => ({ ok: false, status: 404 }),
      wait: async () => undefined,
      gitCredentialManager: {
        prepare: async () => ({}),
        approve: async () => ({ rollback: async () => undefined }),
        assertManaged: async () => undefined,
        cleanupManaged: async () => undefined,
        commandArgs: (_url, _snapshot, args) => args,
      },
    });
  }

  it("reports the transfer as part of the uploading step", async () => {
    const service = serviceWith(async (args, options) => {
      expect(args).toContain("--progress");
      expect(options.timeout).toBe(CLOUD_INITIAL_PUSH_TIMEOUT_MS);
      options.onStderr(PUSH_STDERR);
      return { stdout: "", stderr: PUSH_STDERR };
    });
    const progress = vi.fn();
    await service.pushExpectedCommit("/workspace", record(), "pwg_secret", progress);
    const transfers = progress.mock.calls.filter(([stage, transfer]) => stage === "uploading" && transfer);
    expect(transfers.length).toBeGreaterThan(0);
    expect(transfers.at(-1)[1]).toMatchObject({ percent: 100, sentBytes: Math.round(11.45 * MIB) });
  });

  it("classifies a failure by Git's error, not by the progress printed before it", async () => {
    const service = serviceWith(async () => {
      throw Object.assign(new Error("Git push failed"), {
        stderr: `${PUSH_STDERR.split("Total")[0]}error: RPC failed; HTTP 413 curl 22 The requested URL returned error: 413\n`,
      });
    });
    await expect(service.pushExpectedCommit("/workspace", record(), "pwg_secret"))
      .rejects.toMatchObject({ publishCode: "PUSH_LIMIT_EXCEEDED" });
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
