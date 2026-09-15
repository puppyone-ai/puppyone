import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  inspectAutoCommitPreflight,
  recoverWorkspaceGitAutoCommit,
  resolveGitRepositoryIdentity,
  runWorkspaceGitAutoCommit,
} from "../../../../local-api/workspace.mjs";
import { execGit } from "../../../../local-api/git/runner.mjs";
import { createGitAutoCommitTransactionJournal } from "../../../../electron/main/git-auto-commit/transaction-journal.mjs";
import { gitAutoCommitWorkspaceKey } from "../../../../electron/main/git-auto-commit/identity.mjs";

const repositories = [];
afterEach(async () => {
  await Promise.all(repositories.splice(0).map((directory) => fs.rm(directory, {
    recursive: true,
    force: true,
  })));
});

async function createRepository() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-auto-commit-"));
  repositories.push(root);
  await execGit(root, ["init", "-b", "main"]);
  await execGit(root, ["config", "user.name", "Puppyone Test"]);
  await execGit(root, ["config", "user.email", "test@puppyone.invalid"]);
  await fs.writeFile(path.join(root, "tracked.txt"), "baseline\n");
  await execGit(root, ["add", "--", "tracked.txt"]);
  await execGit(root, ["commit", "-m", "baseline"]);
  const identity = await resolveGitRepositoryIdentity(root);
  const journal = createGitAutoCommitTransactionJournal();
  return { root, identity, journal, workspaceKey: gitAutoCommitWorkspaceKey(identity) };
}

async function run(fixture, overrides = {}) {
  return runWorkspaceGitAutoCommit(fixture.root, {
    identity: fixture.identity,
    journal: fixture.journal,
    workspaceKey: fixture.workspaceKey,
    contentEpoch: 7,
    isContentEpochCurrent: () => true,
    ...overrides,
  });
}

async function statusPorcelain(root) {
  return (await execGit(root, ["status", "--porcelain=v1"])).stdout;
}

describe("workspace Git Auto Commit transaction", () => {
  it("commits only untracked paths and preserves tracked modifications", async () => {
    const fixture = await createRepository();
    await fs.writeFile(path.join(fixture.root, "tracked.txt"), "local edit\n");
    await fs.mkdir(path.join(fixture.root, "notes"));
    await fs.writeFile(path.join(fixture.root, "notes", "one.md"), "one\n");
    await fs.writeFile(path.join(fixture.root, "two.txt"), "two\n");

    const result = await run(fixture);
    expect(result).toMatchObject({ outcome: "committed", pathCount: 2 });
    expect((await execGit(fixture.root, ["show", "--format=", "--name-only", "HEAD"])).stdout
      .trim().split("\n").sort()).toEqual(["notes/one.md", "two.txt"]);
    expect(await fs.readFile(path.join(fixture.root, "tracked.txt"), "utf8")).toBe("local edit\n");
    expect(await statusPorcelain(fixture.root)).toBe(" M tracked.txt\n");
    expect((await fixture.journal.read(fixture.root)).record).toBeNull();
  });

  it("preserves tracked deletions while treating an unstaged rename as one exact new path", async () => {
    const fixture = await createRepository();
    await fs.rename(
      path.join(fixture.root, "tracked.txt"),
      path.join(fixture.root, "renamed.txt"),
    );

    await expect(run(fixture)).resolves.toMatchObject({ outcome: "committed", pathCount: 1 });
    expect((await execGit(fixture.root, ["show", "HEAD:tracked.txt"])).stdout).toBe("baseline\n");
    expect((await execGit(fixture.root, ["show", "HEAD:renamed.txt"])).stdout).toBe("baseline\n");
    expect(await statusPorcelain(fixture.root)).toBe(" D tracked.txt\n");
  });

  it("skips when the user already has staged work", async () => {
    const fixture = await createRepository();
    await fs.writeFile(path.join(fixture.root, "tracked.txt"), "staged\n");
    await execGit(fixture.root, ["add", "--", "tracked.txt"]);
    await fs.writeFile(path.join(fixture.root, "new.txt"), "new\n");

    await expect(run(fixture)).resolves.toMatchObject({
      outcome: "skipped",
      reason: "user-staged-changes",
    });
    expect(await statusPorcelain(fixture.root)).toContain("M  tracked.txt");
    expect(await statusPorcelain(fixture.root)).toContain("?? new.txt");
  });

  it("preserves unrelated staging that races after preflight", async () => {
    const fixture = await createRepository();
    await fs.writeFile(path.join(fixture.root, "tracked.txt"), "external staged\n");
    await fs.writeFile(path.join(fixture.root, "new.txt"), "new\n");
    let stagedExternally = false;

    const result = await run(fixture, {
      afterPhase: async (phase) => {
        if (phase !== "staged" || stagedExternally) return;
        stagedExternally = true;
        await execGit(fixture.root, ["add", "--", "tracked.txt"]);
      },
    });
    expect(result.outcome).toBe("committed");
    expect((await execGit(fixture.root, ["diff", "--cached", "--name-only"])).stdout.trim())
      .toBe("tracked.txt");
    expect((await execGit(fixture.root, ["show", "--format=", "--name-only", "HEAD"])).stdout.trim())
      .toBe("new.txt");
  });

  it("preserves unrelated staging that races immediately after journal preparation", async () => {
    const fixture = await createRepository();
    await fs.writeFile(path.join(fixture.root, "tracked.txt"), "external staged\n");
    await fs.writeFile(path.join(fixture.root, "new.txt"), "new\n");

    const result = await run(fixture, {
      afterCheckpoint: async (checkpoint) => {
        if (checkpoint === "journal-prepared") {
          await execGit(fixture.root, ["add", "--", "tracked.txt"]);
        }
      },
    });

    expect(result.outcome).toBe("committed");
    expect((await execGit(fixture.root, ["diff", "--cached", "--name-only"])).stdout.trim())
      .toBe("tracked.txt");
    expect((await execGit(fixture.root, ["show", "--format=", "--name-only", "HEAD"])).stdout.trim())
      .toBe("new.txt");
  });

  it("fails closed for sensitive candidates and required signing", async () => {
    const sensitive = await createRepository();
    await fs.writeFile(path.join(sensitive.root, ".env"), "SECRET=value\n");
    await expect(run(sensitive)).resolves.toMatchObject({ reason: "sensitive-candidate" });

    const signing = await createRepository();
    await fs.writeFile(path.join(signing.root, "new.txt"), "new\n");
    await execGit(signing.root, ["config", "commit.gpgsign", "yes"]);
    await expect(run(signing)).resolves.toMatchObject({ reason: "commit-signing-required" });
  });

  it("respects ignores and fails closed for nested repositories, symlinks, and size budgets", async () => {
    const ignored = await createRepository();
    await fs.writeFile(path.join(ignored.root, ".gitignore"), "ignored.txt\n");
    await execGit(ignored.root, ["add", "--", ".gitignore"]);
    await execGit(ignored.root, ["commit", "-m", "ignore policy"]);
    await fs.writeFile(path.join(ignored.root, "ignored.txt"), "ignored\n");
    await expect(run(ignored)).resolves.toMatchObject({ reason: "no-untracked-files" });

    const nested = await createRepository();
    const nestedRoot = path.join(nested.root, "nested");
    await fs.mkdir(nestedRoot);
    await execGit(nestedRoot, ["init"]);
    await fs.writeFile(path.join(nestedRoot, "inside.txt"), "inside\n");
    await expect(run(nested)).resolves.toMatchObject({ reason: "nested-repository" });

    const symlink = await createRepository();
    await fs.writeFile(path.join(symlink.root, "outside.txt"), "target\n");
    await fs.symlink("outside.txt", path.join(symlink.root, "linked.txt"));
    await expect(run(symlink)).resolves.toMatchObject({ reason: "unsupported-candidate" });

    const oversized = await createRepository();
    await fs.writeFile(path.join(oversized.root, "large.txt"), "12345");
    await expect(run(oversized, { maxTotalBytes: 4 })).resolves.toMatchObject({
      reason: "candidate-size-limit",
    });

    const tooMany = await createRepository();
    await fs.writeFile(path.join(tooMany.root, "one.txt"), "one\n");
    await fs.writeFile(path.join(tooMany.root, "two.txt"), "two\n");
    await expect(run(tooMany, { maxPaths: 1 })).resolves.toMatchObject({
      reason: "candidate-count-limit",
    });
  });

  it("fails closed when the repository has unresolved conflicts", async () => {
    const fixture = await createRepository();
    await execGit(fixture.root, ["switch", "-c", "conflicting-branch"]);
    await fs.writeFile(path.join(fixture.root, "tracked.txt"), "branch edit\n");
    await execGit(fixture.root, ["add", "--", "tracked.txt"]);
    await execGit(fixture.root, ["commit", "-m", "branch edit"]);
    await execGit(fixture.root, ["switch", "main"]);
    await fs.writeFile(path.join(fixture.root, "tracked.txt"), "main edit\n");
    await execGit(fixture.root, ["add", "--", "tracked.txt"]);
    await execGit(fixture.root, ["commit", "-m", "main edit"]);
    await execGit(fixture.root, ["merge", "conflicting-branch"]).catch(() => undefined);
    // Isolate the index-conflict guard from the separately tested
    // repository-operation marker guard.
    await fs.rm(path.join(fixture.identity.gitDir, "MERGE_HEAD"), { force: true });
    await fs.writeFile(path.join(fixture.root, "new.txt"), "new\n");

    await expect(run(fixture)).resolves.toMatchObject({
      outcome: "skipped",
      reason: "conflicts-present",
    });
    expect((await execGit(fixture.root, ["diff", "--name-only", "--diff-filter=U"])).stdout.trim())
      .toBe("tracked.txt");
  });

  it("requires a named idle branch and a configured author", async () => {
    const detached = await createRepository();
    await fs.writeFile(path.join(detached.root, "new.txt"), "new\n");
    await execGit(detached.root, ["checkout", "--detach"]);
    await expect(run(detached)).resolves.toMatchObject({ reason: "named-branch-required" });

    const operation = await createRepository();
    await fs.writeFile(path.join(operation.root, "new.txt"), "new\n");
    await fs.writeFile(path.join(operation.identity.gitDir, "MERGE_HEAD"), "a".repeat(40));
    await expect(run(operation)).resolves.toMatchObject({ reason: "operation-in-progress" });

    const missingAuthor = await createRepository();
    await fs.writeFile(path.join(missingAuthor.root, "new.txt"), "new\n");
    await execGit(missingAuthor.root, ["config", "user.email", ""]);
    await expect(run(missingAuthor)).resolves.toMatchObject({ reason: "author-identity-required" });
  });

  it("supports unborn branches and literal Unicode, space, and leading-dash paths", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-auto-commit-unborn-"));
    repositories.push(root);
    await execGit(root, ["init", "-b", "main"]);
    await execGit(root, ["config", "user.name", "Puppyone Test"]);
    await execGit(root, ["config", "user.email", "test@puppyone.invalid"]);
    const identity = await resolveGitRepositoryIdentity(root);
    const fixture = {
      root,
      identity,
      journal: createGitAutoCommitTransactionJournal(),
      workspaceKey: gitAutoCommitWorkspaceKey(identity),
    };
    const names = ["-leading.txt", "space name.md", "笔记.md"];
    await Promise.all(names.map((name) => fs.writeFile(path.join(root, name), `${name}\n`)));

    await expect(run(fixture)).resolves.toMatchObject({ outcome: "committed", pathCount: 3 });
    const committed = (await execGit(root, ["ls-tree", "--name-only", "-z", "HEAD"]))
      .stdout.split("\0").filter(Boolean).sort();
    expect(committed).toEqual([...names].sort());
    expect((await execGit(root, ["log", "-1", "--format=%B"])).stdout)
      .toMatch(/Puppyone-Auto-Commit: [0-9a-f-]+/);
  });

  it("runs repository hooks and clean filters against the isolated transaction index", async () => {
    const fixture = await createRepository();
    await fs.writeFile(path.join(fixture.root, ".gitattributes"), "*.upper filter=upper\n");
    await execGit(fixture.root, ["add", "--", ".gitattributes"]);
    await execGit(fixture.root, ["commit", "-m", "add filter policy"]);
    await execGit(fixture.root, ["config", "filter.upper.clean", "tr 'a-z' 'A-Z'"]);
    await execGit(fixture.root, ["config", "filter.upper.required", "true"]);
    const hookPath = path.join(fixture.identity.gitDir, "hooks", "commit-msg");
    await fs.writeFile(
      hookPath,
      "#!/bin/sh\ntest -n \"$GIT_INDEX_FILE\" || exit 2\ngrep -q 'Puppyone-Auto-Commit:' \"$1\"\n",
      { mode: 0o700 },
    );
    await fs.writeFile(path.join(fixture.root, "filtered.upper"), "mixed Case\n");

    await expect(run(fixture)).resolves.toMatchObject({ outcome: "committed", pathCount: 1 });
    expect((await execGit(fixture.root, ["show", "HEAD:filtered.upper"])).stdout).toBe("MIXED CASE\n");
    expect(await statusPorcelain(fixture.root)).toBe("");
  });

  it("reports a fresh preflight candidate set without exposing ignored paths", async () => {
    const fixture = await createRepository();
    await fs.writeFile(path.join(fixture.root, "visible.txt"), "visible\n");
    const preflight = await inspectAutoCommitPreflight(fixture.root, { identity: fixture.identity });
    expect(preflight).toMatchObject({ ok: true, paths: ["visible.txt"], totalBytes: 8 });
  });

  it("fails closed when the bounded Git status result exceeds its product limit", { timeout: 60_000 }, async () => {
    const fixture = await createRepository();
    const count = 10_001;
    for (let start = 0; start < count; start += 250) {
      await Promise.all(Array.from({ length: Math.min(250, count - start) }, (_, offset) => (
        fs.writeFile(
          path.join(fixture.root, `candidate-${String(start + offset).padStart(5, "0")}.txt`),
          "",
        )
      )));
    }

    await expect(inspectAutoCommitPreflight(fixture.root, { identity: fixture.identity }))
      .resolves.toMatchObject({ ok: false, reason: "status-limit" });
  });

  it("does not move HEAD when content changes after isolated staging", async () => {
    const fixture = await createRepository();
    await fs.writeFile(path.join(fixture.root, "new.txt"), "new\n");
    const before = (await execGit(fixture.root, ["rev-parse", "HEAD"])).stdout.trim();
    let current = true;
    const result = await run(fixture, {
      isContentEpochCurrent: () => current,
      afterPhase: (phase) => {
        if (phase === "staged") current = false;
      },
    });
    expect(result).toMatchObject({ outcome: "skipped", reason: "content-changed" });
    expect((await execGit(fixture.root, ["rev-parse", "HEAD"])).stdout.trim()).toBe(before);
    expect(await statusPorcelain(fixture.root)).toBe("?? new.txt\n");
  });

  it("cancels before ref mutation when consent is disabled during a run", async () => {
    const fixture = await createRepository();
    await fs.writeFile(path.join(fixture.root, "new.txt"), "new\n");
    const before = (await execGit(fixture.root, ["rev-parse", "HEAD"])).stdout.trim();
    let allowed = true;
    const result = await run(fixture, {
      isExecutionAllowed: () => allowed,
      afterPhase: (phase) => {
        if (phase === "staged") allowed = false;
      },
    });
    expect(result).toMatchObject({ outcome: "skipped", reason: "feature-disabled" });
    expect((await execGit(fixture.root, ["rev-parse", "HEAD"])).stdout.trim()).toBe(before);
    expect(await statusPorcelain(fixture.root)).toBe("?? new.txt\n");
    expect((await fixture.journal.read(fixture.root)).record).toBeNull();
  });

  it("abandons safely when another Git client moves HEAD after staging", async () => {
    const fixture = await createRepository();
    await fs.writeFile(path.join(fixture.root, "tracked.txt"), "external commit\n");
    await fs.writeFile(path.join(fixture.root, "new.txt"), "new\n");
    let moved = false;
    const result = await run(fixture, {
      afterPhase: async (phase) => {
        if (phase !== "staged" || moved) return;
        moved = true;
        await execGit(fixture.root, ["add", "--", "tracked.txt"]);
        await execGit(fixture.root, ["commit", "-m", "external commit"]);
      },
    });
    expect(result).toMatchObject({ outcome: "skipped", reason: "repository-changed" });
    expect((await execGit(fixture.root, ["log", "-1", "--format=%s"])).stdout.trim())
      .toBe("external commit");
    expect(await statusPorcelain(fixture.root)).toBe("?? new.txt\n");
  });

  it("abandons safely when another Git client switches the current branch after staging", async () => {
    const fixture = await createRepository();
    await fs.writeFile(path.join(fixture.root, "new.txt"), "new\n");
    const result = await run(fixture, {
      afterCheckpoint: async (checkpoint) => {
        if (checkpoint === "journal-staged") {
          await execGit(fixture.root, ["switch", "-c", "external-branch"]);
        }
      },
    });

    expect(result).toMatchObject({ outcome: "skipped", reason: "repository-changed" });
    expect((await execGit(fixture.root, ["branch", "--show-current"])).stdout.trim())
      .toBe("external-branch");
    expect(await statusPorcelain(fixture.root)).toBe("?? new.txt\n");
    expect((await fixture.journal.read(fixture.root)).record).toBeNull();
  });

  it("preserves an externally staged candidate when index ownership becomes ambiguous", async () => {
    const fixture = await createRepository();
    await fs.writeFile(path.join(fixture.root, "new.txt"), "first\n");
    const result = await run(fixture, {
      afterPhase: async (phase) => {
        if (phase !== "staged") return;
        await fs.writeFile(path.join(fixture.root, "new.txt"), "second\n");
        await execGit(fixture.root, ["add", "--", "new.txt"]);
      },
    });
    expect(result).toMatchObject({ outcome: "needs-review", reason: "index-ownership-ambiguous" });
    expect((await execGit(fixture.root, ["show", "HEAD:new.txt"])).stdout).toBe("first\n");
    expect((await execGit(fixture.root, ["show", ":new.txt"])).stdout).toBe("second\n");
    expect((await fixture.journal.read(fixture.root)).record?.phase).toBe("committed");
  });

  it("cleans a prepared journal when a candidate disappears before staging", async () => {
    const fixture = await createRepository();
    await fs.writeFile(path.join(fixture.root, "new.txt"), "new\n");
    const result = await run(fixture, {
      afterPhase: async (phase) => {
        if (phase === "prepared") await fs.rm(path.join(fixture.root, "new.txt"));
      },
    });
    expect(result.outcome).toBe("failed");
    expect((await fixture.journal.read(fixture.root)).record).toBeNull();
    expect(await statusPorcelain(fixture.root)).toBe("");
  });

  it("cleans up after a rejecting hook without touching the real index", async () => {
    const fixture = await createRepository();
    await fs.writeFile(path.join(fixture.root, "new.txt"), "new\n");
    const hookPath = path.join(fixture.identity.gitDir, "hooks", "pre-commit");
    await fs.writeFile(hookPath, "#!/bin/sh\nexit 1\n", { mode: 0o700 });

    await expect(run(fixture)).resolves.toMatchObject({ outcome: "failed", reason: "commit-rejected" });
    expect(await statusPorcelain(fixture.root)).toBe("?? new.txt\n");
    expect((await fixture.journal.read(fixture.root)).record).toBeNull();
  });

  it("times out a hanging hook without touching the real index", { timeout: 10_000 }, async () => {
    const fixture = await createRepository();
    await fs.writeFile(path.join(fixture.root, "new.txt"), "new\n");
    const hookPath = path.join(fixture.identity.gitDir, "hooks", "pre-commit");
    await fs.writeFile(hookPath, "#!/bin/sh\nsleep 2\n", { mode: 0o700 });

    await expect(run(fixture, { mutationTimeoutMs: 50 })).resolves.toMatchObject({
      outcome: "failed",
      reason: "hook-timeout",
    });
    expect(await statusPorcelain(fixture.root)).toBe("?? new.txt\n");
    expect((await fixture.journal.read(fixture.root)).record).toBeNull();
  });

  for (const crashPoint of ["prepared", "staged", "committed"]) {
    it(`recovers idempotently after the ${crashPoint} journal phase`, async () => {
      const fixture = await createRepository();
      await fs.writeFile(path.join(fixture.root, "new.txt"), "new\n");
      await expect(run(fixture, {
        afterPhase: (phase) => {
          if (phase !== crashPoint) return;
          const error = new Error(`crash after ${phase}`);
          error.autoCommitCrash = true;
          throw error;
        },
      })).rejects.toMatchObject({ autoCommitCrash: true });

      const recovered = await recoverWorkspaceGitAutoCommit(fixture.root, {
        identity: fixture.identity,
        journal: fixture.journal,
        workspaceKey: fixture.workspaceKey,
      });
      expect(recovered.outcome).toBe(crashPoint === "committed" ? "committed" : "no-op");
      expect((await fixture.journal.read(fixture.root)).record).toBeNull();
      expect(await statusPorcelain(fixture.root)).toBe(crashPoint === "committed" ? "" : "?? new.txt\n");
    });
  }

  for (const checkpoint of [
    "journal-prepared",
    "isolated-index-prepared",
    "journal-staged",
    "commit-created",
    "journal-committed",
    "commit-verified",
    "index-reconciled",
  ]) {
    it(`recovers idempotently after the ${checkpoint} checkpoint`, async () => {
      const fixture = await createRepository();
      await fs.writeFile(path.join(fixture.root, "new.txt"), "new\n");
      await expect(run(fixture, {
        afterCheckpoint: (current) => {
          if (current !== checkpoint) return;
          const error = new Error(`crash after ${current}`);
          error.autoCommitCrash = true;
          throw error;
        },
      })).rejects.toMatchObject({ autoCommitCrash: true });

      const recovered = await recoverWorkspaceGitAutoCommit(fixture.root, {
        identity: fixture.identity,
        journal: fixture.journal,
        workspaceKey: fixture.workspaceKey,
      });
      const commitExists = [
        "commit-created",
        "journal-committed",
        "commit-verified",
        "index-reconciled",
      ].includes(checkpoint);
      expect(recovered.outcome).toBe(commitExists ? "committed" : "no-op");
      expect((await fixture.journal.read(fixture.root)).record).toBeNull();
      expect(await statusPorcelain(fixture.root)).toBe(commitExists ? "" : "?? new.txt\n");
    });
  }

  it("preserves an ambiguous journal when workspace identity or branch ownership changes", async () => {
    const identityChanged = await createRepository();
    await fs.writeFile(path.join(identityChanged.root, "new.txt"), "new\n");
    await expect(run(identityChanged, {
      afterCheckpoint: crashAt("journal-staged"),
    })).rejects.toMatchObject({ autoCommitCrash: true });
    await expect(recoverWorkspaceGitAutoCommit(identityChanged.root, {
      identity: identityChanged.identity,
      journal: identityChanged.journal,
      workspaceKey: "f".repeat(64),
    })).resolves.toMatchObject({ outcome: "needs-review", reason: "workspace-identity-changed" });
    expect((await identityChanged.journal.read(identityChanged.root)).record).not.toBeNull();

    const branchChanged = await createRepository();
    await fs.writeFile(path.join(branchChanged.root, "new.txt"), "new\n");
    await expect(run(branchChanged, {
      afterCheckpoint: crashAt("journal-staged"),
    })).rejects.toMatchObject({ autoCommitCrash: true });
    await execGit(branchChanged.root, ["switch", "-c", "other-branch"]);
    await expect(recoverWorkspaceGitAutoCommit(branchChanged.root, {
      identity: branchChanged.identity,
      journal: branchChanged.journal,
      workspaceKey: branchChanged.workspaceKey,
    })).resolves.toMatchObject({ outcome: "needs-review", reason: "branch-changed" });
    expect((await branchChanged.journal.read(branchChanged.root)).record).not.toBeNull();
  });

  it("recovers a commit that landed before the committed journal write", async () => {
    const fixture = await createRepository();
    await fs.writeFile(path.join(fixture.root, "new.txt"), "new\n");
    await expect(run(fixture, {
      afterGitCommit: () => {
        const error = new Error("crash after git commit");
        error.autoCommitCrash = true;
        throw error;
      },
    })).rejects.toMatchObject({ autoCommitCrash: true });

    const recovered = await recoverWorkspaceGitAutoCommit(fixture.root, {
      identity: fixture.identity,
      journal: fixture.journal,
      workspaceKey: fixture.workspaceKey,
    });
    expect(recovered).toMatchObject({ outcome: "committed", reason: "recovered-committed-transaction" });
    expect(await statusPorcelain(fixture.root)).toBe("");
  });
});

function crashAt(expectedCheckpoint) {
  return (checkpoint) => {
    if (checkpoint !== expectedCheckpoint) return;
    const error = new Error(`crash after ${checkpoint}`);
    error.autoCommitCrash = true;
    throw error;
  };
}
