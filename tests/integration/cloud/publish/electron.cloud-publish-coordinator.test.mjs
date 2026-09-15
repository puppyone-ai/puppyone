import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCloudPublishCoordinator } from "../../../../electron/main/cloud-publish-coordinator.mjs";
import { execGit } from "../../../../local-api/git/runner.mjs";

const execFileAsync = promisify(execFile);
const roots = [];

// These are real-Git fault/restart integration tests. A loaded CI host can
// legitimately spend more than Vitest's unit-test default on process I/O.
vi.setConfig({ testTimeout: 15_000 });

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Cloud publish coordinator", () => {
  it("rejects an unborn branch before creating any Cloud resources", async () => {
    const fixture = await createFixture("main");
    await git(fixture.root, "update-ref", "-d", "refs/heads/main");

    const result = await createCoordinator(fixture).startOrResume(fixture.request);

    expect(result).toMatchObject({
      ok: false,
      state: null,
      error: { code: "COMMIT_REQUIRED", retryable: false },
    });
    expect(fixture.cloud.requests).toEqual([]);
    const gitDir = await git(fixture.root, "rev-parse", "--absolute-git-dir");
    await expect(readFile(path.join(gitDir, "puppyone", "pending-cloud-publish.v1.json"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("creates once, keeps the credential out of the journal, and maps a feature branch to Cloud main", async () => {
    const fixture = await createFixture("feature/design");
    const coordinator = createCoordinator(fixture);
    const progress = [];

    const result = await coordinator.startOrResume(fixture.request, {
      onProgress: (event) => progress.push(event),
    });

    expect(result.ok).toBe(true);
    expect(result.state).toMatchObject({
      project: "published",
      push: "accepted",
      cleanup: "none",
      destinationBranch: "main",
      availableActions: [],
    });
    expect(fixture.cloud.requests.filter((entry) => entry.path === "/projects/")).toHaveLength(1);
    expect(fixture.cloud.requests.find((entry) => entry.path === "/projects/")?.body).toEqual({
      org_id: "org-1",
      name: "Publish fixture",
      description: null,
    });
    const credentialRequest = fixture.cloud.requests.find((entry) => entry.path.endsWith("/git-credentials"));
    expect(credentialRequest?.init.headers).toMatchObject({
      "Idempotency-Key": expect.stringMatching(/^[0-9a-f-]{36}$/),
      "X-PuppyOne-Repository-Contract": "2",
    });
    expect(credentialRequest?.body.credential).toMatch(/^pwg_/);
    expect(await git(fixture.root, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"))
      .toBe("puppyone/main");
    expect(await git(fixture.bare, "rev-parse", "refs/heads/main")).toBe(fixture.head);
    const gitDir = await git(fixture.root, "rev-parse", "--absolute-git-dir");
    await expect(readFile(path.join(gitDir, "puppyone", "pending-cloud-publish.v1.json"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
    expect([...fixture.vault.values()].join("\n")).not.toContain("pwg_");
    expect([...new Set(progress.map(({ stage }) => stage))]).toEqual([
      "validating",
      "creating-project",
      "securing-credential",
      "configuring-remote",
      "checking-remote",
      "uploading",
      "confirming",
      "finalizing",
      "completed",
    ]);
    expect(progress.at(-1)).toMatchObject({
      rootPath: fixture.root,
      stage: "completed",
      state: { project: "published", push: "accepted" },
    });
    expect(JSON.stringify(progress)).not.toContain("pwg_");
  });

  it("recovers after a crash immediately after remote add without creating another Project", async () => {
    const fixture = await createFixture("main");
    const crash = new Error("simulated crash");
    crash.simulateCrash = true;
    const first = createCoordinator(fixture, {
      faultInjector: async (point) => {
        if (point === "after-remote-add") throw crash;
      },
    });

    await expect(first.startOrResume(fixture.request)).rejects.toBe(crash);
    expect(await git(fixture.root, "remote", "get-url", "puppyone")).toBe(fixture.remoteUrl);

    const resumed = await createCoordinator(fixture).startOrResume(fixture.request);
    expect(resumed.ok).toBe(true);
    expect(fixture.cloud.requests.filter((entry) => entry.path === "/projects/")).toHaveLength(1);
    expect(await git(fixture.bare, "rev-parse", "refs/heads/main")).toBe(fixture.head);
  });

  it("fails closed when a pending operation finds the canonical remote at a different URL", async () => {
    const fixture = await createFixture("main");
    const crash = new Error("pause after Project");
    crash.simulateCrash = true;
    const first = createCoordinator(fixture, {
      faultInjector: async (point) => {
        if (point === "after-project-created") throw crash;
      },
    });
    await expect(first.startOrResume(fixture.request)).rejects.toBe(crash);
    await git(fixture.root, "remote", "add", "puppyone", `${fixture.bare}-wrong`);

    const result = await createCoordinator(fixture).startOrResume(fixture.request);
    expect(result).toMatchObject({ ok: false, error: { code: "REMOTE_CONFLICT", retryable: false } });
    expect(await git(fixture.root, "remote", "get-url", "puppyone")).toBe(`${fixture.bare}-wrong`);
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

  it("never persists the main-owned raw credential in a crash journal", async () => {
    const fixture = await createFixture("main");
    const crash = Object.assign(new Error("crash after credential"), { simulateCrash: true });
    await expect(createCoordinator(fixture, {
      faultInjector: async (point) => {
        if (point === "after-credential-issued") throw crash;
      },
    }).startOrResume(fixture.request)).rejects.toBe(crash);

    const gitDir = await git(fixture.root, "rev-parse", "--absolute-git-dir");
    const journal = await readFile(path.join(gitDir, "puppyone", "pending-cloud-publish.v1.json"), "utf8");
    const secret = [...fixture.vault.values()][0];
    expect(secret).toMatch(/^pwg_/);
    expect(journal).not.toContain(secret);
    expect(journal).not.toContain("pwg_");
  });

  it("rejects a tampered journal remote before reading a secret or running network Git", async () => {
    const fixture = await createFixture("main");
    const crash = Object.assign(new Error("pause with credential state"), { simulateCrash: true });
    await expect(createCoordinator(fixture, {
      faultInjector: async (point) => {
        if (point === "after-credential-config-journaled") throw crash;
      },
    }).startOrResume(fixture.request)).rejects.toBe(crash);

    const gitDir = await git(fixture.root, "rev-parse", "--absolute-git-dir");
    const journalPath = path.join(gitDir, "puppyone", "pending-cloud-publish.v1.json");
    const record = JSON.parse(await readFile(journalPath, "utf8"));
    record.canonical_remote_url = "https://attacker.invalid/git/project-1.git";
    record.credential_config_snapshot.scope_url = record.canonical_remote_url;
    await writeFile(journalPath, `${JSON.stringify(record)}\n`, { mode: 0o600 });

    const secretGet = vi.fn(fixture.secretVault.get);
    const networkGit = [];
    const result = await createCoordinator(fixture, {
      secretVault: { ...fixture.secretVault, get: secretGet },
      validateRemoteUrl: (value) => {
        if (value !== fixture.remoteUrl) throw new Error("untrusted remote");
        return value;
      },
      onExecGitCommand: (args) => {
        if (args.includes("ls-remote") || args.includes("push")) networkGit.push(args);
      },
    }).startOrResume(fixture.request);

    expect(result).toMatchObject({ ok: false, error: { code: "REMOTE_CONFLICT" } });
    expect(secretGet).not.toHaveBeenCalled();
    expect(networkGit).toEqual([]);
  });

  it("replays Project creation with the same UUID after its response is lost", async () => {
    const fixture = await createFixture("main");
    const crash = Object.assign(new Error("lost Project response"), { simulateCrash: true });
    await expect(createCoordinator(fixture, {
      faultInjector: async (point) => {
        if (point === "after-project-response") throw crash;
      },
    }).startOrResume(fixture.request)).rejects.toBe(crash);

    const resumed = await createCoordinator(fixture).startOrResume(fixture.request);
    expect(resumed.ok).toBe(true);
    const creates = fixture.cloud.requests.filter((entry) => entry.path === "/projects/");
    expect(creates).toHaveLength(2);
    expect(new Set(creates.map((entry) => entry.init.headers["Idempotency-Key"])).size).toBe(1);
    expect(creates[0].body).toEqual(creates[1].body);
  });

  it("accepts a server-allocated display name without losing the durable Project identity", async () => {
    const fixture = await createFixture("main");
    fixture.cloud.projectName = "Untitled Project 2";

    const result = await createCoordinator(fixture).startOrResume({
      ...fixture.request,
      projectName: "Untitled Project",
    });

    expect(result).toMatchObject({ ok: true, state: { project: "published", push: "accepted" } });
    expect(fixture.cloud.requests.find((entry) => entry.path === "/projects/")?.body.name)
      .toBe("Untitled Project");
    expect(fixture.cloud.requests.filter((entry) => entry.path.endsWith("/git-credentials")))
      .toHaveLength(1);
  });

  it("rejects a Project response that omits the explicitly requested Organization", async () => {
    const fixture = await createFixture("main");
    fixture.cloud.omitProjectOrganization = true;

    const result = await createCoordinator(fixture).startOrResume(fixture.request);

    expect(result).toMatchObject({
      ok: false,
      error: { code: "PROJECT_CREATE_FAILED", retryable: false },
    });
    expect(fixture.cloud.requests.filter((entry) => entry.path.endsWith("/git-credentials")))
      .toHaveLength(0);
  });

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

  it("replays credential issuance with the same secret after its response is lost", async () => {
    const fixture = await createFixture("main");
    const crash = Object.assign(new Error("lost credential response"), { simulateCrash: true });
    await expect(createCoordinator(fixture, {
      faultInjector: async (point) => {
        if (point === "after-credential-response") throw crash;
      },
    }).startOrResume(fixture.request)).rejects.toBe(crash);

    const resumed = await createCoordinator(fixture).startOrResume(fixture.request);
    const credentialRequests = fixture.cloud.requests.filter((entry) => entry.path.endsWith("/git-credentials"));

    expect(resumed.ok).toBe(true);
    expect(credentialRequests).toHaveLength(2);
    expect(credentialRequests[0].body.credential).toBe(credentialRequests[1].body.credential);
    expect(credentialRequests[0].init.headers["Idempotency-Key"])
      .toBe(credentialRequests[1].init.headers["Idempotency-Key"]);
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

async function createFixture(branch) {
  const root = await mkdtemp(path.join(os.tmpdir(), "puppyone-publish-root-"));
  const bare = await mkdtemp(path.join(os.tmpdir(), "puppyone-publish-bare-"));
  roots.push(root, bare);
  await git(root, "init", "-q");
  await git(root, "config", "user.email", "test@puppyone.invalid");
  await git(root, "config", "user.name", "PuppyOne Test");
  await execFileAsync("sh", ["-c", "printf publish > README.md"], { cwd: root });
  await git(root, "add", "README.md");
  await git(root, "commit", "-qm", "initial");
  if (branch !== "master") await git(root, "branch", "-M", branch);
  await git(bare, "init", "--bare", "-q");
  const head = await git(root, "rev-parse", "HEAD");
  const vault = new Map();
  const secretVault = {
    createRef: () => "11111111-1111-4111-8111-111111111111",
    put: async (ref, secret) => { vault.set(ref, secret); },
    get: async (ref) => vault.get(ref) ?? null,
    clear: async (ref) => { vault.delete(ref); },
  };
  const cloud = createCloud(root, bare);
  const remoteUrl = "https://api.puppyone.test/git/project-1.git";
  cloud.remoteUrl = remoteUrl;
  return {
    root,
    bare,
    head,
    vault,
    secretVault,
    cloud,
    remoteUrl,
    request: {
      rootPath: root,
      apiBaseUrl: "http://127.0.0.1:8000/api/v1",
      userId: "user-1",
      organizationId: "org-1",
      projectName: "Publish fixture",
      sourceBranch: branch,
      action: "initialize",
    },
  };
}

function createCloud(_root, _bare) {
  const requests = [];
  const cloud = {
    requests,
    projectGate: null,
    readSession: async () => ({
      user_id: "user-1",
      api_base_url: "http://127.0.0.1:8000/api/v1",
      status: "authenticated",
    }),
    requestSessionApi: async (_api, requestPath, init) => {
      const body = init.body ? JSON.parse(init.body) : null;
      requests.push({ path: requestPath, init, body });
      if (requestPath === "/projects/") {
        if (cloud.projectGate) await cloud.projectGate;
        return {
          id: "project-1",
          ...(cloud.omitProjectOrganization ? {} : { org_id: body.org_id }),
          name: cloud.projectName ?? body.name,
        };
      }
      if (requestPath === "/projects/project-1/git-credentials") {
        if (cloud.projectUnavailable) {
          throw Object.assign(new Error("Project no longer exists"), { status: 404 });
        }
        return {
          id: "credential-1",
          mode: "rw",
          remote: {
            url: cloud.remoteUrl,
            username: "x-puppyone-token",
            target: body.target,
          },
        };
      }
      if (requestPath === "/projects/project-1/initialization/abandon") {
        if (cloud.projectUnavailable) {
          throw Object.assign(new Error("Project no longer exists"), { status: 404 });
        }
        if (cloud.abandonFailures > 0) {
          cloud.abandonFailures -= 1;
          throw Object.assign(new Error("temporary cleanup failure"), { status: 503 });
        }
        return { abandoned: true };
      }
      if (
        requestPath === "/projects/project-1/git-credentials/credential-1"
        && init.method === "DELETE"
      ) {
        return null;
      }
      throw new Error(`Unexpected request: ${requestPath}`);
    },
  };
  return cloud;
}

function createCoordinator(fixture, options = {}) {
  const credentialConfigSnapshot = {
    version: 1,
    scope_url: fixture.remoteUrl,
    helper: "osxkeychain",
    previous_helpers: [],
    previous_use_http_path: [],
  };
  return createCloudPublishCoordinator({
    cloudAuthService: fixture.cloud,
    secretVault: options.secretVault ?? fixture.secretVault,
    gitCredentialManager: {
      prepare: async () => credentialConfigSnapshot,
      approve: async () => ({ rollback: async () => undefined }),
      assertManaged: async () => undefined,
      cleanupManaged: async () => undefined,
      commandArgs: (remoteUrl, snapshot, args) => [
        "-c", `credential.${remoteUrl}.helper=`,
        "-c", `credential.${remoteUrl}.helper=${snapshot.helper}`,
        "-c", `credential.${remoteUrl}.useHttpPath=true`,
        ...args,
      ],
    },
    execGitCommand: async (rootPath, args, commandOptions) => {
      options.onExecGitCommand?.(args);
      const mapped = args.some((arg) => ["ls-remote", "push"].includes(arg))
        ? args.map((arg) => arg === fixture.remoteUrl ? fixture.bare : arg)
        : args;
      return execGit(rootPath, mapped, commandOptions);
    },
    validateRemoteUrl: options.validateRemoteUrl ?? ((value) => value),
    faultInjector: options.faultInjector,
    telemetry: options.telemetry,
  });
}

async function replacePausedOperationWithV1(fixture, phase) {
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

async function git(cwd, ...args) {
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], {
    env: { ...process.env, LC_ALL: "C", LANG: "C" },
  });
  return stdout.trim();
}

async function snapshotUserGitState(root) {
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
