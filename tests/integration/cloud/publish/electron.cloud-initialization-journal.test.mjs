import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCloudPublishJournal } from "../../../../electron/main/cloud-publish-journal.mjs";
import { normalizeCloudInitializationJournalRecord } from "../../../../electron/main/cloud-initialization/journal/schema-v2.mjs";

const roots = [];
const fixtures = new URL("../../../fixtures/cloud/publish/", import.meta.url);

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Cloud initialization journal v1 migration", () => {
  it("maps an interrupted pre-push operation to a retained empty Project and immutable attempt", async () => {
    const legacy = await readFixture("legacy-v1-remote-configured.json");

    const migrated = normalizeCloudInitializationJournalRecord(legacy);

    expect(migrated).toMatchObject({
      version: 2,
      kind: "puppyone-cloud-initialization",
      checkpoint: "remote-configured",
      project_state: "empty",
      push_state: "idle",
      cleanup_state: "none",
      selected_source_branch: "feature/legacy",
      selected_source_ref: "refs/heads/feature/legacy",
      attempt_count: 1,
      attempt: {
        attempt_id: legacy.operation_id,
        commit_oid: legacy.expected_head_commit_id,
        state: "preparing",
      },
      migrated_from: {
        version: 1,
        phase: "remote-configured",
        migrated_at: legacy.updated_at,
        persisted: false,
      },
    });
    expect(JSON.stringify(migrated)).not.toContain("expected_head_commit_id");
    expect(JSON.stringify(migrated)).not.toContain("expected_branch");
  });

  it("preserves a legacy cleanup intent as the sole Finish-cleanup recovery path", async () => {
    const legacy = await readFixture("legacy-v1-compensation-pending.json");

    const migrated = normalizeCloudInitializationJournalRecord(legacy);

    expect(migrated).toMatchObject({
      checkpoint: "cleanup-requested",
      project_state: "deleting",
      push_state: "failed",
      cleanup_state: "requested",
      migrated_from: { phase: "compensation-pending", persisted: false },
    });
  });

  it("persists the deterministic v2 record in place on the first journal read", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "puppyone-journal-migration-"));
    roots.push(root);
    const gitDir = path.join(root, ".git-worktree");
    const commonDir = path.join(root, ".git-common");
    const journalDirectory = path.join(gitDir, "puppyone");
    await mkdir(journalDirectory, { recursive: true, mode: 0o700 });
    await mkdir(commonDir, { recursive: true, mode: 0o700 });
    const journalPath = path.join(journalDirectory, "pending-cloud-publish.v1.json");
    const legacy = await readFixture("legacy-v1-remote-configured.json");
    await writeFile(journalPath, `${JSON.stringify(legacy)}\n`, { mode: 0o600 });
    const journal = createCloudPublishJournal({
      resolveRepositoryIdentity: async () => ({
        repository: true,
        gitDir,
        commonDir,
        topLevel: root,
      }),
    });

    const first = await journal.read(root);
    const persisted = JSON.parse(await readFile(journalPath, "utf8"));
    const second = await journal.read(root);

    expect(first.record.version).toBe(2);
    expect(first.record.revision).toBe(legacy.revision + 1);
    expect(first.record.migrated_from.persisted).toBe(true);
    expect(persisted).toEqual(first.record);
    expect(second.record).toEqual(first.record);
  });
});

async function readFixture(name) {
  return JSON.parse(await readFile(new URL(name, fixtures), "utf8"));
}
