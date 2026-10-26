import { describe, expect, it, vi } from "vitest";
import { readInitialPushReceipt } from "../../../../electron/main/cloud-publish-receipt.mjs";
import { createCloudPublishGitService } from "../../../../electron/main/cloud-publish-git.mjs";

const id = "11111111-1111-4111-8111-111111111111";
const oid = "a".repeat(40);
const remote = "https://api.puppyone.test/git/project-1.git";
const record = {
  operation_id: id, project_id: "project-1", credential_id: "credential-1",
  canonical_remote_url: remote, credential_username: "x-puppyone-token",
  credential_config_snapshot: { helper: "osxkeychain" }, remote_add_intent: true,
  selected_source_branch: "main", selected_source_ref: "refs/heads/main",
  attempt: { attempt_id: id, commit_oid: oid, state: "uploading" },
};
function envelope() {
  return { data: {
    project_id: record.project_id, request_key: id, status: "committed",
    result: { project_id: record.project_id, status: "committed", refs: [{
      name_b64: Buffer.from("refs/heads/main").toString("base64"),
      observed: { kind: "absent" }, new: { kind: "oid", oid },
    }] },
  } };
}
function harness({ lostResponse = false, response = envelope(), remoteHead } = {}) {
  const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => response }));
  const exec = vi.fn(async (_root, args) => {
    if (args.includes("ls-remote")) {
      if (remoteHead === undefined) throw new Error("remote discovery unavailable");
      return { stdout: remoteHead ? `${remoteHead}\trefs/heads/main\n` : "" };
    }
    if (args.includes("push") && lostResponse) throw Object.assign(new Error("timeout"), { code: "ETIMEDOUT" });
    if (args[0] === "remote" && args.length === 1) return { stdout: "puppyone\n" };
    if (args[0] === "remote" && args[1] === "get-url") return { stdout: `${remote}\n` };
    return { stdout: "" };
  });
  const service = createCloudPublishGitService({
    execGitCommand: exec, fetchImpl, getGitStatus: async () => ({ branch: "main" }),
    wait: async () => { throw new Error("receipt must avoid backoff"); },
    gitCredentialManager: {
      prepare: async () => ({}), approve: async () => ({ rollback: async () => {} }),
      assertManaged: async () => {}, cleanupManaged: async () => {},
      commandArgs: (_url, _snapshot, args) => args,
    },
  });
  return { service, exec, fetchImpl };
}

describe("initial push receipt", () => {
  it("normal initialization uses Git push acknowledgement without auxiliary network calls", async () => {
    const { service, exec, fetchImpl } = harness();
    await service.configureCanonicalRemote("/workspace", record, "secret");
    expect(await service.pushExpectedCommit("/workspace", record, "secret")).toEqual({ remoteHead: oid });
    await service.finalizeUpstreamAndStatus("/workspace", {
      ...record, push_state: "accepted", attempt: { ...record.attempt, state: "accepted" },
    });
    expect(exec.mock.calls.filter(([, args]) => args.includes("push"))).toHaveLength(1);
    expect(exec.mock.calls.filter(([, args]) => args.includes("ls-remote"))).toHaveLength(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("lost push response resolves by the bound receipt without ref discovery or backoff", async () => {
    const { service, fetchImpl } = harness({ lostResponse: true });
    expect(await service.pushExpectedCommit("/workspace", record, "secret")).toEqual({ remoteHead: oid });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe(`${remote}/operations/${id}`);
    expect(options.redirect).toBe("error");
    expect(options.cache).toBe("no-store");
  });
  it.each(["project", "attempt", "commit", "ref", "pending", "absent", "redirect"])(
    "does not accept a %s mismatch as success", async (fault) => {
      const value = envelope();
      if (fault === "project") value.data.project_id = "another-project";
      if (fault === "attempt") value.data.request_key = "22222222-2222-4222-8222-222222222222";
      if (fault === "commit") value.data.result.refs[0].new.oid = "b".repeat(40);
      if (fault === "ref") value.data.result.refs[0].name_b64 = Buffer.from("refs/heads/other").toString("base64");
      if (fault === "pending") { value.data.status = "pending"; value.data.result = null; }
      const fetchImpl = vi.fn(async () => ({ ok: !["absent", "redirect"].includes(fault), json: async () => value }));
      expect(await readInitialPushReceipt(record, "secret", fetchImpl)).toBeNull();
    },
  );
  it("a durable rejection terminates reconciliation", async () => {
    const response = envelope();
    response.data.status = response.data.result.status = "rejected";
    const { service, fetchImpl } = harness({ lostResponse: true, response });
    await expect(service.pushExpectedCommit("/workspace", record, "secret"))
      .rejects.toMatchObject({ publishCode: "PUSH_FAILED" });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it("a rejected retry is successful when another attempt published the same commit", async () => {
    const response = envelope();
    response.data.status = response.data.result.status = "rejected";
    const { service } = harness({ lostResponse: true, response, remoteHead: oid });
    expect(await service.pushExpectedCommit("/workspace", record, "secret")).toEqual({ remoteHead: oid });
    expect(await service.inspectCanonicalPushOutcome("/workspace", record, "secret")).toEqual({ remoteHead: oid, rejected: true });
  });
  it("a rejected receipt does not strand a retry when the remote is empty", async () => {
    const response = envelope();
    response.data.status = response.data.result.status = "rejected";
    const { service } = harness({ response, remoteHead: null });
    expect(await service.inspectCanonicalPushOutcome("/workspace", record, "secret")).toEqual({ remoteHead: null, rejected: true });
  });
  it("never converts a different remote commit into success or overwrites it", async () => {
    const { service, exec } = harness({ lostResponse: true, response: null, remoteHead: "b".repeat(40) });
    await expect(service.pushExpectedCommit("/workspace", record, "secret"))
      .rejects.toMatchObject({ publishCode: "REMOTE_REF_CONFLICT" });
    expect(exec.mock.calls.filter(([, args]) => args.includes("push"))).toHaveLength(1);
  });
});
