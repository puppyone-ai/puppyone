import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { git } from "../../../support/cloud/publishCoordinatorHarness.mjs";
import { createCoordinator, createFixture, replacePausedOperationWithV1, setUpPublishCoordinator, snapshotUserGitState } from "../../../support/cloud/publishCoordinatorFixture";

setUpPublishCoordinator();

describe("Cloud publish coordinator: cleanup and migration", () => {
  it("finishes a failed explicit cleanup after branch, HEAD, and dirty state change", async () => {
    const fixture = await createFixture("main");
    const crash = Object.assign(new Error("pause with empty Project"), { simulateCrash: true });
    await expect(createCoordinator(fixture, {
      faultInjector: async (point) => {
        if (point === "after-remote-configured") throw crash;
      },
    }).startOrResume(fixture.request)).rejects.toBe(crash);
    const pending = await createCoordinator(fixture).getState(fixture.request);
    fixture.cloud.abandonFailures = 1;

    const firstCleanup = await createCoordinator(fixture).cleanup({
      ...fixture.request,
      operationId: pending.state.operationId,
    });
    expect(firstCleanup).toMatchObject({
      ok: false,
      state: { cleanup: "failed", availableActions: ["finish-cleanup"] },
      error: { code: "CLEANUP_FAILED", retryable: true },
    });

    await git(fixture.root, "switch", "-c", "work-after-cleanup-request");
    await writeFile(path.join(fixture.root, "after-request.md"), "committed after cleanup intent\n");
    await git(fixture.root, "add", "after-request.md");
    await git(fixture.root, "commit", "-qm", "work after cleanup request");
    await writeFile(path.join(fixture.root, "dirty-after-request.txt"), "must survive cleanup\n");
    const beforeFinish = await snapshotUserGitState(fixture.root);

    const finished = await createCoordinator(fixture).cleanup({
      ...fixture.request,
      operationId: pending.state.operationId,
    });

    expect(finished).toMatchObject({ ok: true, state: null });
    expect(await snapshotUserGitState(fixture.root)).toEqual(beforeFinish);
    await expect(git(fixture.root, "remote", "get-url", "puppyone")).rejects.toBeTruthy();
    expect(fixture.cloud.requests.filter((entry) => entry.path.endsWith("/initialization/abandon")))
      .toHaveLength(2);
  });

  it("lets the user explicitly replace a deleted source branch with the current branch", async () => {
    const fixture = await createFixture("main");
    const crash = Object.assign(new Error("pause after Project create"), { simulateCrash: true });
    await expect(createCoordinator(fixture, {
      faultInjector: async (point) => {
        if (point === "after-project-created") throw crash;
      },
    }).startOrResume(fixture.request)).rejects.toBe(crash);
    await git(fixture.root, "switch", "-c", "replacement");
    await git(fixture.root, "branch", "-D", "main");

    const pending = await createCoordinator(fixture).getState(fixture.request);
    expect(pending).toMatchObject({
      ok: true,
      state: {
        local: "source-missing",
        selectedSourceBranch: "main",
        currentBranch: "replacement",
        availableActions: expect.arrayContaining(["choose-source", "delete-empty-project"]),
      },
    });

    const recovered = await createCoordinator(fixture).startOrResume({
      ...fixture.request,
      sourceBranch: "replacement",
      operationId: pending.state.operationId,
      action: "choose-source",
    });

    expect(recovered).toMatchObject({
      ok: true,
      state: {
        push: "accepted",
        selectedSourceBranch: "replacement",
        attemptCount: 2,
      },
    });
  });

  it("replays explicit deletion after the server response is lost", async () => {
    const fixture = await createFixture("main");
    const pause = Object.assign(new Error("pause before push"), { simulateCrash: true });
    await expect(createCoordinator(fixture, {
      faultInjector: async (point) => {
        if (point === "after-remote-configured") throw pause;
      },
    }).startOrResume(fixture.request)).rejects.toBe(pause);
    const pending = await createCoordinator(fixture).getState(fixture.request);
    const lost = Object.assign(new Error("lost deletion response"), { simulateCrash: true });
    await expect(createCoordinator(fixture, {
      faultInjector: async (point) => {
        if (point === "after-cleanup-server-response") throw lost;
      },
    }).cleanup({
      ...fixture.request,
      operationId: pending.state.operationId,
    })).rejects.toBe(lost);

    const finished = await createCoordinator(fixture).cleanup({
      ...fixture.request,
      operationId: pending.state.operationId,
    });
    const deletes = fixture.cloud.requests.filter((entry) => entry.path.endsWith("/initialization/abandon"));

    expect(finished).toMatchObject({ ok: true, state: null });
    expect(deletes).toHaveLength(2);
    expect(deletes[0].init.headers["Idempotency-Key"]).toBe(deletes[1].init.headers["Idempotency-Key"]);
  });

  it("finishes local cleanup after a crash immediately after owned remote removal", async () => {
    const fixture = await createFixture("main");
    const pause = Object.assign(new Error("pause before push"), { simulateCrash: true });
    await expect(createCoordinator(fixture, {
      faultInjector: async (point) => {
        if (point === "after-remote-configured") throw pause;
      },
    }).startOrResume(fixture.request)).rejects.toBe(pause);
    const pending = await createCoordinator(fixture).getState(fixture.request);
    const localCrash = Object.assign(new Error("lost local cleanup completion"), { simulateCrash: true });
    await expect(createCoordinator(fixture, {
      faultInjector: async (point) => {
        if (point === "after-abandon-remote-removed") throw localCrash;
      },
    }).cleanup({
      ...fixture.request,
      operationId: pending.state.operationId,
    })).rejects.toBe(localCrash);
    await expect(git(fixture.root, "remote", "get-url", "puppyone")).rejects.toBeTruthy();

    const finished = await createCoordinator(fixture).cleanup({
      ...fixture.request,
      operationId: pending.state.operationId,
    });

    expect(finished).toMatchObject({ ok: true, state: null });
    expect(fixture.cloud.requests.filter((entry) => entry.path.endsWith("/initialization/abandon")))
      .toHaveLength(1);
  });

  it("lets the server prove emptiness when the owned local remote was already removed", async () => {
    const fixture = await createFixture("main");
    const pause = Object.assign(new Error("pause before push"), { simulateCrash: true });
    await expect(createCoordinator(fixture, {
      faultInjector: async (point) => {
        if (point === "after-remote-configured") throw pause;
      },
    }).startOrResume(fixture.request)).rejects.toBe(pause);
    const pending = await createCoordinator(fixture).getState(fixture.request);
    await git(fixture.root, "remote", "remove", "puppyone");

    const finished = await createCoordinator(fixture).cleanup({
      ...fixture.request,
      operationId: pending.state.operationId,
    });

    expect(finished).toMatchObject({ ok: true, state: null });
    expect(fixture.cloud.requests.filter((entry) => entry.path.endsWith("/initialization/abandon")))
      .toHaveLength(1);
  });

  it("reconciles canonical remote truth when server refuses cleanup after local remote removal", async () => {
    const fixture = await createFixture("main");
    const pause = Object.assign(new Error("pause before push"), { simulateCrash: true });
    await expect(createCoordinator(fixture, {
      faultInjector: async (point) => {
        if (point === "after-remote-configured") throw pause;
      },
    }).startOrResume(fixture.request)).rejects.toBe(pause);
    const pending = await createCoordinator(fixture).getState(fixture.request);
    await git(fixture.root, "remote", "remove", "puppyone");
    const originalRequest = fixture.cloud.requestSessionApi;
    fixture.cloud.requestSessionApi = async (apiBase, requestPath, init) => {
      if (requestPath.endsWith("/initialization/abandon")) {
        fixture.cloud.requests.push({ path: requestPath, init, body: JSON.parse(init.body) });
        await git(fixture.root, "push", fixture.bare, `${fixture.head}:refs/heads/main`);
        throw Object.assign(new Error("Project accepted its first push"), {
          status: 409,
          code: "initialization_not_abandonable",
        });
      }
      return originalRequest(apiBase, requestPath, init);
    };

    const result = await createCoordinator(fixture).cleanup({
      ...fixture.request,
      operationId: pending.state.operationId,
    });

    expect(result).toMatchObject({
      ok: true,
      state: { project: "published", push: "accepted", availableActions: [] },
    });
    expect(await git(fixture.bare, "rev-parse", "refs/heads/main")).toBe(fixture.head);
  });

  it.each(["after-project-created", "after-remote-configured"])(
    "keeps sending available after a definitive discard refusal at %s, including restart",
    async (pointToStop) => {
      const fixture = await createFixture("main");
      const pause = Object.assign(new Error("interrupted initialization"), { simulateCrash: true });
      await expect(createCoordinator(fixture, {
        faultInjector: async (point) => { if (point === pointToStop) throw pause; },
      }).startOrResume(fixture.request)).rejects.toBe(pause);
      const pending = await createCoordinator(fixture).getState(fixture.request);
      const originalRequest = fixture.cloud.requestSessionApi;
      fixture.cloud.requestSessionApi = async (apiBase, requestPath, init) => {
        if (requestPath.endsWith("/initialization/abandon")) {
          fixture.cloud.requests.push({ path: requestPath, init, body: JSON.parse(init.body) });
          throw Object.assign(new Error("Project has an independent resource"), {
            status: 409, code: "initialization_not_abandonable",
          });
        }
        return originalRequest(apiBase, requestPath, init);
      };
      await writeFile(path.join(fixture.root, "keep-local.txt"), "local work survives\n");
      const refused = await createCoordinator(fixture).cleanup({
        ...fixture.request, operationId: pending.state.operationId,
      });
      expect(refused).toMatchObject({
        ok: false, error: { code: "CLEANUP_NOT_ALLOWED", retryable: false },
        state: { cleanup: "none", availableActions: ["retry-push"] },
      });
      const restarted = await createCoordinator(fixture).getState(fixture.request);
      expect(restarted.state).toMatchObject({
        cleanup: "none", lastError: { code: "CLEANUP_NOT_ALLOWED" },
        availableActions: ["retry-push"],
      });
      const retried = await createCoordinator(fixture).startOrResume({
        ...fixture.request, operationId: pending.state.operationId, action: "retry-push",
      });
      expect(retried).toMatchObject({ ok: true, state: { push: "accepted" } });
      expect(await readFile(path.join(fixture.root, "keep-local.txt"), "utf8")).toBe("local work survives\n");
      expect(fixture.cloud.requests.filter((entry) => entry.path.endsWith("/initialization/abandon"))).toHaveLength(1);
      expect(fixture.cloud.requests.filter((entry) => entry.path === "/projects/")).toHaveLength(1);
    },
  );

  it("migrates v1 pre-push state by authoritative absent, accepted, and divergent remote refs", async () => {
    for (const remoteState of ["absent", "accepted", "divergent"]) {
      const fixture = await createFixture("main");
      await replacePausedOperationWithV1(fixture, "remote-configured");
      let competingCommit = null;
      if (remoteState === "accepted") {
        await git(fixture.root, "push", fixture.bare, `${fixture.head}:refs/heads/main`);
      } else if (remoteState === "divergent") {
        await git(fixture.root, "switch", "-c", "remote-winner");
        await writeFile(path.join(fixture.root, "remote-winner.md"), "remote winner\n");
        await git(fixture.root, "add", "remote-winner.md");
        await git(fixture.root, "commit", "-qm", "remote winner");
        competingCommit = await git(fixture.root, "rev-parse", "HEAD");
        await git(fixture.root, "push", fixture.bare, `${competingCommit}:refs/heads/main`);
      }

      const result = await createCoordinator(fixture).getState(fixture.request);

      if (remoteState === "absent") {
        expect(result).toMatchObject({
          ok: true,
          state: {
            project: "empty",
            push: "idle",
            availableActions: expect.arrayContaining(["retry-push", "delete-empty-project"]),
          },
        });
      } else if (remoteState === "accepted") {
        expect(result).toMatchObject({
          ok: true,
          state: { project: "published", push: "accepted", availableActions: [] },
        });
      } else {
        expect(result).toMatchObject({
          ok: true,
          state: { project: "published", push: "conflict", availableActions: [] },
        });
        expect(await git(fixture.bare, "rev-parse", "refs/heads/main")).toBe(competingCommit);
      }
    }
  });

  it("finishes migrated v1 compensation after the local branch and HEAD change", async () => {
    const fixture = await createFixture("main");
    const legacy = await replacePausedOperationWithV1(fixture, "compensation-pending");
    await git(fixture.root, "switch", "-c", "continued-after-v1");
    await writeFile(path.join(fixture.root, "continued.md"), "continued work\n");
    await git(fixture.root, "add", "continued.md");
    await git(fixture.root, "commit", "-qm", "continued work");
    await writeFile(path.join(fixture.root, "dirty-after-v1.txt"), "preserve me\n");
    const before = await snapshotUserGitState(fixture.root);

    const pending = await createCoordinator(fixture).getState(fixture.request);
    expect(pending).toMatchObject({
      ok: true,
      state: { cleanup: "requested", availableActions: ["finish-cleanup"] },
    });

    const finished = await createCoordinator(fixture).cleanup({
      ...fixture.request,
      operationId: legacy.operation_id,
    });

    expect(finished).toMatchObject({ ok: true, state: null });
    expect(await snapshotUserGitState(fixture.root)).toEqual(before);
  });

  it("offers only Finish cleanup when the Cloud Project is already unavailable", async () => {
    const fixture = await createFixture("main");
    fixture.cloud.projectUnavailable = true;

    const failed = await createCoordinator(fixture).startOrResume(fixture.request);

    expect(failed).toMatchObject({
      ok: false,
      error: { code: "PROJECT_UNAVAILABLE", retryable: false },
      state: {
        project: "unavailable",
        availableActions: ["finish-cleanup"],
      },
    });
    expect(fixture.vault.size).toBe(1);

    const finished = await createCoordinator(fixture).cleanup({
      ...fixture.request,
      operationId: failed.state.operationId,
    });

    expect(finished).toMatchObject({ ok: true, state: null });
    expect(fixture.vault.size).toBe(0);
    expect(fixture.cloud.requests.filter((entry) => entry.path.endsWith("/initialization/abandon")))
      .toHaveLength(1);
    const gitDir = await git(fixture.root, "rev-parse", "--absolute-git-dir");
    await expect(readFile(path.join(gitDir, "puppyone", "pending-cloud-publish.v1.json"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
  });
});
