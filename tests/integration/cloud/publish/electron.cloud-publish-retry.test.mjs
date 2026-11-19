import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { git } from "../../../support/cloud/publishCoordinatorHarness.mjs";
import { createCoordinator, createFixture, setUpPublishCoordinator } from "../../../support/cloud/publishCoordinatorFixture";

setUpPublishCoordinator();

describe("Cloud publish coordinator: retry and restart", () => {
  it.each(["missing", "pending", "rejected"])("retry of a %s receipt uses a fresh attempt and only retargets after definitive rejection", async (outcome) => {
    const fixture = await createFixture("main");
    const crash = Object.assign(new Error("pause before push"), { simulateCrash: true });
    await expect(createCoordinator(fixture, {
      faultInjector: async (point) => { if (point === "after-push-remote-verified") throw crash; },
    }).startOrResume(fixture.request)).rejects.toBe(crash);
    const gitDir = await git(fixture.root, "rev-parse", "--absolute-git-dir");
    const journalPath = path.join(gitDir, "puppyone", "pending-cloud-publish.v1.json");
    const record = JSON.parse(await readFile(journalPath, "utf8"));
    record.push_state = record.attempt.state = "uncertain";
    await writeFile(journalPath, `${JSON.stringify(record)}\n`, { mode: 0o600 });
    await writeFile(path.join(fixture.root, "later.md"), "later local changes\n");
    await git(fixture.root, "add", "later.md");
    await git(fixture.root, "commit", "-qm", "keep working after interruption");
    const later = await git(fixture.root, "rev-parse", "HEAD");
    const pending = await createCoordinator(fixture).getState(fixture.request);
    expect(pending.state.availableActions).toContain("retry-push");
    const pushed = [];
    const result = await createCoordinator(fixture, {
      onExecGitCommand: (args) => { if (args.includes("push")) pushed.push(args); },
      fetchImpl: async () => ({ ok: outcome !== "missing", json: async () => ({ data: {
        project_id: record.project_id, request_key: record.attempt.attempt_id, status: outcome,
        result: outcome === "pending" ? null : {
          project_id: record.project_id, status: "rejected", refs: [{
            name_b64: Buffer.from("refs/heads/main").toString("base64"),
            observed: { kind: "absent" }, new: { kind: "oid", oid: record.attempt.commit_oid },
          }],
        },
      } }) }),
    }).startOrResume({ ...fixture.request, action: "reconcile" });
    const candidate = outcome === "rejected" ? later : record.attempt.commit_oid;
    expect(result).toMatchObject({ ok: true, state: {
      push: "accepted", attemptCount: record.attempt_count + 1,
      attemptCommitOid: candidate,
    } });
    expect(pushed).toHaveLength(1);
    expect(pushed[0]).toContain(`${candidate}:refs/heads/main`);
    expect(pushed[0].join(" ")).not.toContain(record.attempt.attempt_id);
    expect(await git(fixture.bare, "rev-parse", "refs/heads/main")).toBe(candidate);
    expect(await git(fixture.root, "rev-parse", "HEAD")).toBe(later);
    expect(fixture.cloud.requests.filter((entry) => entry.path === "/projects/")).toHaveLength(1);
    expect(fixture.cloud.requests.filter((entry) => entry.path.endsWith("/git-credentials"))).toHaveLength(1);
  });

  it.each(["uploading", "confirming"])("a restart during %s offers Retry without retargeting", async (state) => {
    const fixture = await createFixture("main");
    const crash = Object.assign(new Error("process stopped before push"), { simulateCrash: true });
    await expect(createCoordinator(fixture, {
      faultInjector: async (point) => { if (point === "after-push-remote-verified") throw crash; },
    }).startOrResume(fixture.request)).rejects.toBe(crash);
    const gitDir = await git(fixture.root, "rev-parse", "--absolute-git-dir");
    const journalPath = path.join(gitDir, "puppyone", "pending-cloud-publish.v1.json");
    const record = JSON.parse(await readFile(journalPath, "utf8"));
    record.push_state = record.attempt.state = state;
    await writeFile(journalPath, `${JSON.stringify(record)}\n`, { mode: 0o600 });
    const pending = await createCoordinator(fixture).getState(fixture.request);
    expect(pending).toMatchObject({ ok: true, state: {
      push: "uncertain", availableActions: expect.arrayContaining(["retry-push"]),
    } });
    const retried = await createCoordinator(fixture).startOrResume({ ...fixture.request, action: "retry-push" });
    expect(retried).toMatchObject({ ok: true, state: {
      push: "accepted", attemptCount: 2, attemptCommitOid: fixture.head,
    } });
  });

  it("an old upload completing just before Retry does not cause a false failure", async () => {
    const fixture = await createFixture("main");
    const crash = Object.assign(new Error("response lost"), { simulateCrash: true });
    await expect(createCoordinator(fixture, {
      faultInjector: async (point) => { if (point === "after-push-remote-verified") throw crash; },
    }).startOrResume(fixture.request)).rejects.toBe(crash);
    const result = await createCoordinator(fixture, {
      onExecGitCommand: async (args) => {
        if (args.includes("push")) {
          await git(fixture.root, "push", fixture.bare, `${fixture.head}:refs/heads/main`);
        }
      },
    }).startOrResume({ ...fixture.request, action: "retry-push" });
    expect(result).toMatchObject({ ok: true, state: { push: "accepted", attemptCount: 2 } });
    expect(await git(fixture.bare, "rev-list", "--count", "main")).toBe("1");
  });

  it("a second failure preserves unresolved intent across later local commits", async () => {
    const fixture = await createFixture("main");
    const crash = Object.assign(new Error("process stopped"), { simulateCrash: true });
    await expect(createCoordinator(fixture, {
      faultInjector: async (point) => { if (point === "after-push-remote-verified") throw crash; },
    }).startOrResume(fixture.request)).rejects.toBe(crash);
    const failed = await createCoordinator(fixture, {
      onExecGitCommand: (args) => { if (args.includes("push")) throw new Error("receive rejected"); },
    }).startOrResume({ ...fixture.request, action: "retry-push" });
    expect(failed).toMatchObject({ ok: false, state: {
      push: "uncertain", attemptCount: 2, availableActions: expect.arrayContaining(["retry-push"]),
    } });
    await writeFile(path.join(fixture.root, "later.md"), "new work\n");
    await git(fixture.root, "add", "later.md");
    await git(fixture.root, "commit", "-qm", "later local work");
    const result = await createCoordinator(fixture).startOrResume({ ...fixture.request, action: "push-latest" });
    expect(result).toMatchObject({ ok: true, state: {
      push: "accepted", attemptCount: 3, attemptCommitOid: fixture.head,
    } });
    expect(await git(fixture.bare, "rev-parse", "main")).toBe(fixture.head);
  });

  it("a concurrent different commit wins without being overwritten by Retry", async () => {
    const fixture = await createFixture("main");
    const crash = Object.assign(new Error("response lost"), { simulateCrash: true });
    await expect(createCoordinator(fixture, {
      faultInjector: async (point) => { if (point === "after-push-remote-verified") throw crash; },
    }).startOrResume(fixture.request)).rejects.toBe(crash);
    await writeFile(path.join(fixture.root, "other.md"), "another writer\n");
    await git(fixture.root, "add", "other.md");
    await git(fixture.root, "commit", "-qm", "other writer");
    const other = await git(fixture.root, "rev-parse", "HEAD");
    const result = await createCoordinator(fixture, {
      onExecGitCommand: async (args) => {
        if (args.includes("push")) await git(fixture.root, "push", fixture.bare, `${other}:refs/heads/main`);
      },
    }).startOrResume({ ...fixture.request, action: "retry-push" });
    expect(result).toMatchObject({ ok: false, error: { code: "REMOTE_REF_CONFLICT" } });
    expect(await git(fixture.bare, "rev-parse", "main")).toBe(other);
    expect(await git(fixture.root, "rev-parse", "HEAD")).toBe(other);
  });

  it("singleflights concurrent retries under the repository mutation lock", async () => {
    const fixture = await createFixture("main");
    let release;
    fixture.cloud.projectGate = new Promise((resolve) => { release = resolve; });
    const coordinator = createCoordinator(fixture);
    const first = coordinator.startOrResume(fixture.request);
    const second = coordinator.startOrResume(fixture.request);
    await vi.waitFor(() => {
      expect(fixture.cloud.requests.filter((entry) => entry.path === "/projects/")).toHaveLength(1);
    }, { timeout: 5_000 });
    release();
    const [left, right] = await Promise.all([first, second]);
    expect(left.ok).toBe(true);
    expect(right.ok).toBe(true);
    expect(fixture.cloud.requests.filter((entry) => entry.path === "/projects/")).toHaveLength(1);
  });

  it("serializes two independent coordinator instances with the common repository lease", async () => {
    const fixture = await createFixture("main");
    let release;
    fixture.cloud.projectGate = new Promise((resolve) => { release = resolve; });
    const first = createCoordinator(fixture).startOrResume(fixture.request);
    await vi.waitFor(() => {
      expect(fixture.cloud.requests.filter((entry) => entry.path === "/projects/")).toHaveLength(1);
    }, { timeout: 5_000 });

    const raced = await createCoordinator(fixture).startOrResume(fixture.request);
    expect(raced).toMatchObject({
      ok: false,
      error: { code: "JOURNAL_IO_FAILED", retryable: true },
    });
    expect(fixture.cloud.requests.filter((entry) => entry.path === "/projects/")).toHaveLength(1);

    release();
    await expect(first).resolves.toMatchObject({ ok: true });
  });
});
