import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { git } from "../../../support/cloud/publishCoordinatorHarness.mjs";
import { createCoordinator, createFixture, setUpPublishCoordinator } from "../../../support/cloud/publishCoordinatorFixture";

setUpPublishCoordinator();

describe("Cloud publish coordinator: creating the Cloud project", () => {
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
});
