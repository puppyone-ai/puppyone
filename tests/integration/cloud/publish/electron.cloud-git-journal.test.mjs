import { execFile } from "node:child_process";
import { lstat, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { createCloudGitConnectJournal } from "../../../../electron/main/cloud-git-connect-journal.mjs";

const execFileAsync = promisify(execFile);
const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Cloud Git operation journal CAS", () => {
  it("enforces 0600 durability, revision CAS, and monotonic phases across instances", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "puppyone-journal-root-"));
    roots.push(root);
    await git(root, "init", "-q");
    const left = createCloudGitConnectJournal();
    const right = createCloudGitConnectJournal();
    const record = connectRecord();
    const created = await left.write(root, record, { createOnly: true });
    if (process.platform !== "win32") {
      expect((await lstat(created.journalPath)).mode & 0o077).toBe(0);
    }

    const issued = {
      ...record,
      revision: 1,
      phase: "credential-issued",
      updated_at: "2026-07-16T00:00:01.000Z",
    };
    await right.write(root, issued, {
      expectedOperationId: record.operation_id,
      expectedRevision: 0,
      expectedPhase: "prepared",
    });
    await expect(left.write(root, {
      ...issued,
      revision: 2,
      updated_at: "2026-07-16T00:00:02.000Z",
    }, {
      expectedOperationId: record.operation_id,
      expectedRevision: 0,
      expectedPhase: "prepared",
    })).rejects.toMatchObject({ publishCode: "IDENTITY_MISMATCH" });
    await expect(left.write(root, {
      ...issued,
      revision: 2,
      phase: "prepared",
      updated_at: "2026-07-16T00:00:02.000Z",
    }, {
      expectedOperationId: record.operation_id,
      expectedRevision: 1,
      expectedPhase: "credential-issued",
    })).rejects.toMatchObject({ publishCode: "IDENTITY_MISMATCH" });
  });
});

function connectRecord() {
  return {
    version: 1,
    kind: "configure-existing-remote",
    operation_id: "33333333-3333-4333-8333-333333333333",
    revision: 0,
    phase: "prepared",
    api_base_url: "https://api.puppyone.ai/api/v1",
    api_origin: "https://api.puppyone.ai",
    user_id: "user-1",
    project_id: "project-1",
    repository_fingerprint: "repository-fingerprint",
    secret_ref: null,
    secret_stored: false,
    credential_id: null,
    canonical_remote_url: null,
    credential_username: null,
    credential_config_snapshot: null,
    remote_add_intent: false,
    remote_created_by_operation: false,
    created_at: "2026-07-16T00:00:00.000Z",
    updated_at: "2026-07-16T00:00:00.000Z",
  };
}

async function git(cwd, ...args) {
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], {
    env: { ...process.env, LC_ALL: "C", LANG: "C" },
  });
  return stdout.trim();
}
