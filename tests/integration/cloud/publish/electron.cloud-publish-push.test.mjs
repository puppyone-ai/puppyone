import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { git } from "../../../support/cloud/publishCoordinatorHarness.mjs";
import { createCoordinator, createFixture, roots, setUpPublishCoordinator, snapshotUserGitState } from "../../../support/cloud/publishCoordinatorFixture";

setUpPublishCoordinator();

describe("Cloud publish coordinator: pushing", () => {
  it("reconciles a crash after the push side effect without creating another Project", async () => {
    const fixture = await createFixture("main");
    const crash = Object.assign(new Error("crash after push"), { simulateCrash: true });
    await expect(createCoordinator(fixture, {
      faultInjector: async (point) => {
        if (point === "after-push-side-effect") throw crash;
      },
    }).startOrResume(fixture.request)).rejects.toBe(crash);
    expect(await git(fixture.bare, "rev-parse", "refs/heads/main")).toBe(fixture.head);

    const resumed = await createCoordinator(fixture).startOrResume(fixture.request);
    expect(resumed).toMatchObject({ ok: true, state: { project: "published", push: "accepted" } });
    expect(fixture.cloud.requests.filter((entry) => entry.path === "/projects/")).toHaveLength(1);
  });

  it("reconciles accepted remote truth before cleanup can delete anything", async () => {
    const fixture = await createFixture("main");
    const crash = Object.assign(new Error("pause before push"), { simulateCrash: true });
    const coordinator = createCoordinator(fixture, {
      faultInjector: async (point) => {
        if (point === "after-remote-configured") throw crash;
      },
    });
    await expect(coordinator.startOrResume(fixture.request)).rejects.toBe(crash);
    await git(fixture.root, "push", fixture.bare, `${fixture.head}:refs/heads/main`);

    const pending = await createCoordinator(fixture).getState(fixture.request);
    expect(pending).toMatchObject({
      ok: true,
      state: { project: "published", push: "accepted", availableActions: [] },
    });
    const cleaned = await createCoordinator(fixture).cleanup({
      ...fixture.request,
      operationId: pending.state.operationId,
    });
    expect(cleaned).toMatchObject({ ok: true, state: null });
    expect(fixture.cloud.requests.filter((entry) => entry.path.endsWith("/initialization/abandon")))
      .toHaveLength(0);
    expect(await git(fixture.root, "remote", "get-url", "puppyone")).toBe(fixture.remoteUrl);
  });

  it("uses the journaled canonical URL when another Git process mutates the remote name", async () => {
    const fixture = await createFixture("main");
    const attacker = await mkdtemp(path.join(os.tmpdir(), "puppyone-publish-attacker-"));
    roots.push(attacker);
    await git(attacker, "init", "--bare", "-q");
    let mutated = false;
    const result = await createCoordinator(fixture, {
      faultInjector: async (point) => {
        if (point === "after-push-remote-verified" && !mutated) {
          mutated = true;
          await git(fixture.root, "remote", "set-url", "puppyone", pathToFileURL(attacker).toString());
        }
      },
    }).startOrResume(fixture.request);

    expect(result).toMatchObject({ ok: true, state: { project: "published", push: "accepted" } });
    expect(await git(fixture.bare, "rev-parse", "refs/heads/main")).toBe(fixture.head);
    await expect(git(attacker, "rev-parse", "refs/heads/main")).rejects.toBeTruthy();
  });

  it("pins the allowlisted helper in command scope across a local config mutation race", async () => {
    const fixture = await createFixture("main");
    let pushArgs = null;
    const result = await createCoordinator(fixture, {
      faultInjector: async (point) => {
        if (point === "after-push-remote-verified") {
          await git(
            fixture.root,
            "config",
            "--local",
            "--replace-all",
            `credential.${fixture.remoteUrl}.helper`,
            "!malicious-capture",
          );
        }
      },
      onExecGitCommand: (args) => {
        if (args.includes("push")) pushArgs = [...args];
      },
    }).startOrResume(fixture.request);

    expect(result.ok).toBe(true);
    expect(pushArgs).toContain(`credential.${fixture.remoteUrl}.helper=`);
    expect(pushArgs).toContain(`credential.${fixture.remoteUrl}.helper=osxkeychain`);
    expect(pushArgs.join(" ")).not.toContain("malicious-capture");
    expect(await git(fixture.bare, "rev-parse", "refs/heads/main")).toBe(fixture.head);
  });

  it("durably owns a remote added just before a crash and removes it on later Abandon", async () => {
    const fixture = await createFixture("main");
    const firstCrash = Object.assign(new Error("crash after remote add"), { simulateCrash: true });
    await expect(createCoordinator(fixture, {
      faultInjector: async (point) => {
        if (point === "after-remote-add") throw firstCrash;
      },
    }).startOrResume(fixture.request)).rejects.toBe(firstCrash);
    expect(await git(fixture.root, "remote", "get-url", "puppyone")).toBe(fixture.remoteUrl);

    const secondCrash = Object.assign(new Error("pause after ownership recovery"), { simulateCrash: true });
    await expect(createCoordinator(fixture, {
      faultInjector: async (point) => {
        if (point === "after-remote-configured") throw secondCrash;
      },
    }).startOrResume(fixture.request)).rejects.toBe(secondCrash);
    const pending = await createCoordinator(fixture).getState(fixture.request);
    expect(pending).toMatchObject({
      ok: true,
      state: {
        project: "empty",
        push: "preparing",
        availableActions: expect.arrayContaining(["retry-push", "delete-empty-project"]),
      },
    });

    const abandoned = await createCoordinator(fixture).cleanup({
      ...fixture.request,
      operationId: pending.state.operationId,
    });
    expect(abandoned.ok).toBe(true);
    await expect(git(fixture.root, "remote", "get-url", "puppyone")).rejects.toBeTruthy();
  });

  it("pushes only the committed tree and preserves staged, unstaged, and untracked bytes", async () => {
    const fixture = await createFixture("main");
    await writeFile(path.join(fixture.root, "README.md"), Buffer.from([0x64, 0x69, 0x72, 0x74, 0x79, 0x0a]));
    await writeFile(path.join(fixture.root, "STAGED.md"), "staged version\n");
    await git(fixture.root, "add", "STAGED.md");
    await writeFile(path.join(fixture.root, "STAGED.md"), "working version\n");
    await writeFile(path.join(fixture.root, "untracked.bin"), Buffer.from([0x00, 0xff, 0x41, 0x0a]));
    const before = await snapshotUserGitState(fixture.root);

    const result = await createCoordinator(fixture).startOrResume(fixture.request);

    expect(result).toMatchObject({
      ok: true,
      state: { push: "accepted", hasUncommittedChanges: true },
    });
    expect(await snapshotUserGitState(fixture.root)).toEqual(before);
    expect(await git(fixture.bare, "rev-parse", "refs/heads/main")).toBe(fixture.head);
  });

  it("continues an immutable attempt after HEAD advances on another checked-out branch", async () => {
    const fixture = await createFixture("main");
    const crash = Object.assign(new Error("pause before push"), { simulateCrash: true });
    await expect(createCoordinator(fixture, {
      faultInjector: async (point) => {
        if (point === "after-remote-configured") throw crash;
      },
    }).startOrResume(fixture.request)).rejects.toBe(crash);

    await git(fixture.root, "switch", "-c", "feature/continued-work");
    await writeFile(path.join(fixture.root, "continued.md"), "new local commit\n");
    await git(fixture.root, "add", "continued.md");
    await git(fixture.root, "commit", "-qm", "continue locally");
    const advancedHead = await git(fixture.root, "rev-parse", "HEAD");

    const resumed = await createCoordinator(fixture).startOrResume(fixture.request);

    expect(resumed).toMatchObject({
      ok: true,
      state: {
        push: "accepted",
        local: "branch-switched",
        attemptCommitOid: fixture.head,
      },
    });
    expect(await git(fixture.root, "rev-parse", "--abbrev-ref", "HEAD")).toBe("feature/continued-work");
    expect(await git(fixture.root, "rev-parse", "HEAD")).toBe(advancedHead);
    expect(await git(fixture.bare, "rev-parse", "refs/heads/main")).toBe(fixture.head);
  });

  it("creates a new immutable attempt from the selected branch tip on Push latest", async () => {
    const fixture = await createFixture("main");
    const telemetry = { record: vi.fn() };
    const failed = await createCoordinator(fixture, {
      telemetry,
      onExecGitCommand: (args) => {
        if (args.includes("push")) throw new Error("definite transport failure");
      },
    }).startOrResume(fixture.request);
    expect(failed).toMatchObject({
      ok: false,
      state: {
        project: "empty",
        push: "failed",
        attemptCount: 1,
        availableActions: expect.arrayContaining(["retry-push", "delete-empty-project"]),
      },
      error: { code: "PUSH_FAILED" },
    });
    expect(telemetry.record).toHaveBeenCalledWith(
      "empty_project_retained",
      expect.objectContaining({
        duration_ms: expect.any(Number),
        error_code: "PUSH_FAILED",
        outcome: "retained",
      }),
    );

    await writeFile(path.join(fixture.root, "latest.md"), "latest committed content\n");
    await git(fixture.root, "add", "latest.md");
    await git(fixture.root, "commit", "-qm", "latest source tip");
    const latest = await git(fixture.root, "rev-parse", "refs/heads/main");

    const retried = await createCoordinator(fixture).startOrResume({
      ...fixture.request,
      operationId: failed.state.operationId,
      action: "push-latest",
    });

    expect(retried).toMatchObject({
      ok: true,
      state: { push: "accepted", attemptCount: 2, attemptCommitOid: latest },
    });
    expect(await git(fixture.bare, "rev-parse", "refs/heads/main")).toBe(latest);
    expect(fixture.cloud.requests.filter((entry) => entry.path === "/projects/")).toHaveLength(1);
  });

  it("does not overwrite a Cloud main ref that wins the expected-absent race", async () => {
    const fixture = await createFixture("main");
    const crash = Object.assign(new Error("pause before CAS"), { simulateCrash: true });
    await expect(createCoordinator(fixture, {
      faultInjector: async (point) => {
        if (point === "after-remote-configured") throw crash;
      },
    }).startOrResume(fixture.request)).rejects.toBe(crash);

    await git(fixture.root, "switch", "-c", "contender");
    await writeFile(path.join(fixture.root, "winner.md"), "another accepted history\n");
    await git(fixture.root, "add", "winner.md");
    await git(fixture.root, "commit", "-qm", "remote winner");
    const winner = await git(fixture.root, "rev-parse", "HEAD");
    await git(fixture.root, "push", fixture.bare, `${winner}:refs/heads/main`);

    const result = await createCoordinator(fixture).startOrResume(fixture.request);

    expect(result).toMatchObject({
      ok: false,
      state: { project: "published", push: "conflict", availableActions: [] },
      error: { code: "REMOTE_REF_CONFLICT", retryable: false },
    });
    expect(await git(fixture.bare, "rev-parse", "refs/heads/main")).toBe(winner);
  });

  it("lets server CAS reject a competitor that appears after the pre-push read", async () => {
    const fixture = await createFixture("main");
    await git(fixture.root, "switch", "-c", "race-winner");
    await writeFile(path.join(fixture.root, "race-winner.md"), "wins expected-absent CAS\n");
    await git(fixture.root, "add", "race-winner.md");
    await git(fixture.root, "commit", "-qm", "race winner");
    const winner = await git(fixture.root, "rev-parse", "HEAD");
    await git(fixture.root, "switch", "main");

    const result = await createCoordinator(fixture, {
      faultInjector: async (point) => {
        if (point === "after-push-remote-verified") {
          await git(fixture.root, "push", fixture.bare, `${winner}:refs/heads/main`);
        }
      },
    }).startOrResume(fixture.request);

    expect(result).toMatchObject({
      ok: false,
      state: { push: "conflict" },
      error: { code: "REMOTE_REF_CONFLICT", retryable: false },
    });
    expect(await git(fixture.bare, "rev-parse", "refs/heads/main")).toBe(winner);
  });
});
