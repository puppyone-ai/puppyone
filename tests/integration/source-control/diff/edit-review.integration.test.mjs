// Deep integration tests for the AI edit-review engine (local-api/edit-review.mjs).
// This engine snapshots a workspace, tracks edited paths, and produces
// review requests (before/after diffs) for the AI-edit-assist feature. Tests run
// against real temp workspaces with real file edits — no mocks.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  initializeWorkspaceEditReview,
  getLatestWorkspaceEditReviewRequest,
  noteWorkspaceEditReviewPath,
  flushWorkspaceEditReviewChanges,
  absorbWorkspaceEditReviewPath,
  disposeWorkspaceEditReview,
} from "../../../../local-api/edit-review.mjs";

let root;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "puppyone-review-"));
});

afterEach(async () => {
  disposeWorkspaceEditReview(root);
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
});

describe("baseline + no-op", () => {
  it("returns null when nothing has changed since the baseline", async () => {
    await writeFile(path.join(root, "a.txt"), "hello\n");
    await initializeWorkspaceEditReview(root);
    expect(await flushWorkspaceEditReviewChanges(root)).toBeNull();
  });
});

describe("change detection", () => {
  it("captures a modified file as a review request with a diff", async () => {
    await writeFile(path.join(root, "a.txt"), "hello\n");
    await initializeWorkspaceEditReview(root);

    await writeFile(path.join(root, "a.txt"), "hello\nworld\n");
    noteWorkspaceEditReviewPath(root, "a.txt");
    const request = await flushWorkspaceEditReviewChanges(root);

    expect(request).not.toBeNull();
    expect(request.id).toMatch(/desktop-ai-edit-/);
    expect(request.sessionId).toBeTruthy();
    expect(request.files).toHaveLength(1);
    const file = request.files[0];
    expect(file.path).toBe("a.txt");
    expect(file.status).toBe("modified");
    expect(file.hunks.length).toBeGreaterThanOrEqual(1);
    expect(file.additions).toBeGreaterThanOrEqual(1);
    expect(file.beforeHash).not.toBe(file.afterHash);
  });

  it("captures a newly created file as status 'created'", async () => {
    await writeFile(path.join(root, "a.txt"), "hello\n");
    await initializeWorkspaceEditReview(root);

    await writeFile(path.join(root, "new.txt"), "brand new\n");
    noteWorkspaceEditReviewPath(root, "new.txt");
    const request = await flushWorkspaceEditReviewChanges(root);

    expect(request.files).toHaveLength(1);
    expect(request.files[0].path).toBe("new.txt");
    expect(request.files[0].status).toBe("created");
  });

  it("captures a deleted file as status 'deleted'", async () => {
    await writeFile(path.join(root, "a.txt"), "hello\n");
    await initializeWorkspaceEditReview(root);

    await rm(path.join(root, "a.txt"));
    noteWorkspaceEditReviewPath(root, "a.txt");
    const request = await flushWorkspaceEditReviewChanges(root);

    expect(request.files).toHaveLength(1);
    expect(request.files[0].status).toBe("deleted");
  });

  it("advances the baseline: a second flush with no new edits returns null", async () => {
    await writeFile(path.join(root, "a.txt"), "one\n");
    await initializeWorkspaceEditReview(root);

    await writeFile(path.join(root, "a.txt"), "one\ntwo\n");
    noteWorkspaceEditReviewPath(root, "a.txt");
    expect(await flushWorkspaceEditReviewChanges(root)).not.toBeNull();

    // No new edits noted -> nothing to report.
    expect(await flushWorkspaceEditReviewChanges(root)).toBeNull();
    // Re-noting the same, now-baselined file also yields nothing.
    noteWorkspaceEditReviewPath(root, "a.txt");
    expect(await flushWorkspaceEditReviewChanges(root)).toBeNull();
  });

  it("full-scan (empty note path) reports every changed file", async () => {
    await writeFile(path.join(root, "a.txt"), "a1\n");
    await writeFile(path.join(root, "b.txt"), "b1\n");
    await initializeWorkspaceEditReview(root);

    await writeFile(path.join(root, "a.txt"), "a1\na2\n");
    await writeFile(path.join(root, "b.txt"), "b1\nb2\n");
    noteWorkspaceEditReviewPath(root, ""); // triggers a full scan
    const request = await flushWorkspaceEditReviewChanges(root);

    expect(request.files.map((f) => f.path).sort()).toEqual(["a.txt", "b.txt"]);
  });
});

describe("absorb (accept into baseline)", () => {
  it("absorbed edits are not re-reported", async () => {
    await writeFile(path.join(root, "a.txt"), "hello\n");
    await initializeWorkspaceEditReview(root);

    await writeFile(path.join(root, "a.txt"), "hello\nchanged\n");
    await absorbWorkspaceEditReviewPath(root, "a.txt"); // accept current content as baseline

    noteWorkspaceEditReviewPath(root, "a.txt");
    expect(await flushWorkspaceEditReviewChanges(root)).toBeNull();
  });
});

describe("latest request + ignored paths", () => {
  it("exposes the latest request and ignores VCS/dependency dirs", async () => {
    await writeFile(path.join(root, "a.txt"), "hello\n");
    await mkdir(path.join(root, ".git"), { recursive: true });
    await initializeWorkspaceEditReview(root);

    // Edits under .git must not be tracked.
    await writeFile(path.join(root, ".git", "config"), "[core]\n");
    noteWorkspaceEditReviewPath(root, ".git/config");
    expect(await flushWorkspaceEditReviewChanges(root)).toBeNull();

    // A real edit is reported and retrievable via getLatest.
    await writeFile(path.join(root, "a.txt"), "hello\nmore\n");
    noteWorkspaceEditReviewPath(root, "a.txt");
    const request = await flushWorkspaceEditReviewChanges(root);
    expect(request).not.toBeNull();
    expect(getLatestWorkspaceEditReviewRequest(root)?.id).toBe(request.id);
  });
});

describe("path-traversal containment", () => {
  it("rejects noting a path outside the workspace root", async () => {
    await initializeWorkspaceEditReview(root);
    expect(() => noteWorkspaceEditReviewPath(root, "../escape.txt")).toThrow(/escapes the workspace root/i);
  });

  it("never snapshots or reports a symbolic link to an external file", async () => {
    const external = await mkdtemp(path.join(os.tmpdir(), "puppyone-review-external-"));
    try {
      const secretPath = path.join(external, "secret.txt");
      await writeFile(secretPath, "outside secret\n");
      await symlink(secretPath, path.join(root, "linked.txt"));

      await initializeWorkspaceEditReview(root);
      noteWorkspaceEditReviewPath(root, "linked.txt");
      expect(await flushWorkspaceEditReviewChanges(root)).toBeNull();
    } finally {
      await rm(external, { recursive: true, force: true });
    }
  });
});
