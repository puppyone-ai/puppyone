import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, expect, vi } from "vitest";
import { createPublishCoordinator, createPublishFixture, git } from "./publishCoordinatorHarness.mjs";

/** Temporary repositories for the publish coordinator tests, removed after each one. */
export const roots = [];

/** Registers the shared setup in the calling test file. */
export function setUpPublishCoordinator() {
  // These are real-Git fault/restart integration tests. A loaded CI host can
  // legitimately spend more than Vitest's unit-test default on process I/O.
  vi.setConfig({ testTimeout: 15_000 });
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });
}

export const createFixture = (branch) => createPublishFixture(branch, { roots });
export const createCoordinator = createPublishCoordinator;

export async function replacePausedOperationWithV1(fixture, phase) {
  const pause = Object.assign(new Error("capture legacy operation"), { simulateCrash: true });
  await expect(createCoordinator(fixture, {
    faultInjector: async (point) => {
      if (point === "after-remote-configured") throw pause;
    },
  }).startOrResume(fixture.request)).rejects.toBe(pause);
  const gitDir = await git(fixture.root, "rev-parse", "--absolute-git-dir");
  const journalPath = path.join(gitDir, "puppyone", "pending-cloud-publish.v1.json");
  const record = JSON.parse(await readFile(journalPath, "utf8"));
  const legacy = {
    version: 1,
    kind: "puppyone-cloud-publish",
    operation_id: record.operation_id,
    revision: record.revision,
    phase,
    api_base_url: record.api_base_url,
    api_origin: record.api_origin,
    user_id: record.user_id,
    organization_id: record.organization_id,
    project_name: record.project_name,
    create_payload: record.create_payload,
    repository_fingerprint: record.repository_fingerprint,
    expected_head_commit_id: record.attempt.commit_oid,
    expected_branch: record.selected_source_branch,
    destination_branch: "main",
    project_id: record.project_id,
    credential_id: record.credential_id,
    secret_ref: record.secret_ref,
    secret_stored: record.secret_stored,
    canonical_remote_url: record.canonical_remote_url,
    credential_username: record.credential_username,
    credential_config_snapshot: record.credential_config_snapshot,
    remote_add_intent: record.remote_add_intent,
    remote_created_by_operation: record.remote_created_by_operation,
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
  await writeFile(journalPath, `${JSON.stringify(legacy)}\n`, { mode: 0o600 });
  return legacy;
}

export async function snapshotUserGitState(root) {
  const [branch, head, status, stagedDiff, unstagedDiff, readme, staged, untracked] = await Promise.all([
    git(root, "rev-parse", "--abbrev-ref", "HEAD"),
    git(root, "rev-parse", "HEAD"),
    git(root, "status", "--porcelain=v1", "--untracked-files=all"),
    git(root, "diff", "--cached", "--binary"),
    git(root, "diff", "--binary"),
    readFile(path.join(root, "README.md")).then((value) => value.toString("base64")),
    readFile(path.join(root, "STAGED.md")).then((value) => value.toString("base64")).catch(() => null),
    readFile(path.join(root, "untracked.bin")).then((value) => value.toString("base64")).catch(() => null),
  ]);
  return { branch, head, status, stagedDiff, unstagedDiff, readme, staged, untracked };
}
