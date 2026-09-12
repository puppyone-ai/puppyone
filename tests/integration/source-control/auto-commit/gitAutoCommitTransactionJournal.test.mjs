import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createGitAutoCommitTransactionJournal,
  normalizeGitAutoCommitJournalRecord,
  resolveJournalTemporaryIndexPath,
} from "../../../../electron/main/git-auto-commit/transaction-journal.mjs";

const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("Git Auto Commit transaction journal", () => {
  it("persists private monotonic phases with compare-and-swap updates", async () => {
    const fixture = await createFixture();
    const prepared = (await fixture.journal.create(fixture.root, record())).record;
    const paths = await fixture.journal.resolvePaths(fixture.root);
    if (process.platform !== "win32") {
      expect((await fs.stat(paths.journalPath)).mode & 0o077).toBe(0);
    }

    const staged = (await fixture.journal.update(fixture.root, prepared, {
      phase: "staged",
      path_entries: [{ path: "new.txt", mode: "100644", blob: "b".repeat(40) }],
      staged_tree: "c".repeat(40),
    })).record;
    const committed = (await fixture.journal.update(fixture.root, staged, {
      phase: "committed",
      resulting_commit: "d".repeat(40),
    })).record;

    expect(committed).toMatchObject({ phase: "committed", revision: 2 });
    await expect(fixture.journal.update(fixture.root, prepared, {
      phase: "staged",
      path_entries: [{ path: "new.txt", mode: "100644", blob: "b".repeat(40) }],
      staged_tree: "c".repeat(40),
    })).rejects.toMatchObject({ publishCode: "IDENTITY_MISMATCH" });
    await fixture.journal.clear(fixture.root, committed);
    expect((await fixture.journal.read(fixture.root)).record).toBeNull();
  });

  it("rejects path traversal, incomplete phases, and unsupported schemas", () => {
    expect(() => normalizeGitAutoCommitJournalRecord(record({ schema_version: 2 })))
      .toThrow(/schema is unsupported/i);
    expect(() => normalizeGitAutoCommitJournalRecord(record({
      phase: "staged",
      staged_tree: null,
      path_entries: [],
    }))).toThrow(/staged journal state is incomplete/i);
    expect(() => normalizeGitAutoCommitJournalRecord(record({
      temporary_index_name: "../outside-index",
    }))).toThrow(/identity is invalid/i);
    expect(() => resolveJournalTemporaryIndexPath("/tmp/journal", {
      temporary_index_name: "../outside-index",
    })).toThrow(/escaped/i);
  });

  it("fails closed when a journal file is permissive or malformed", async () => {
    const fixture = await createFixture();
    const paths = await fixture.journal.resolvePaths(fixture.root);
    await fs.mkdir(paths.directory, { recursive: true });
    await fs.writeFile(paths.journalPath, "not-json\n", { mode: 0o600 });
    await expect(fixture.journal.read(fixture.root)).rejects.toMatchObject({
      publishCode: "JOURNAL_CORRUPT",
    });

    if (process.platform !== "win32") {
      await fs.writeFile(paths.journalPath, JSON.stringify(record()), { mode: 0o644 });
      await fs.chmod(paths.journalPath, 0o644);
      await expect(fixture.journal.read(fixture.root)).rejects.toMatchObject({
        publishCode: "JOURNAL_CORRUPT",
      });
    }
  });
});

async function createFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-auto-journal-"));
  roots.push(root);
  const gitDir = path.join(root, ".git");
  await fs.mkdir(gitDir, { recursive: true });
  const identity = { repository: true, workspaceRoot: root, topLevel: root, gitDir, commonDir: gitDir };
  return {
    root,
    journal: createGitAutoCommitTransactionJournal({
      resolveRepositoryIdentity: async () => identity,
    }),
  };
}

function record(overrides = {}) {
  return {
    schema_version: 1,
    operation_id: "11111111-1111-4111-8111-111111111111",
    revision: 0,
    phase: "prepared",
    workspace_key: "a".repeat(64),
    branch_ref: "refs/heads/main",
    expected_head: "e".repeat(40),
    initial_index_tree: "f".repeat(40),
    temporary_index_name: "auto-commit-index.11111111-1111-4111-8111-111111111111",
    paths: ["new.txt"],
    path_entries: [],
    content_epoch: 7,
    staged_tree: null,
    resulting_commit: null,
    created_at: "2026-08-30T00:00:00.000Z",
    updated_at: "2026-08-30T00:00:00.000Z",
    ...overrides,
  };
}
