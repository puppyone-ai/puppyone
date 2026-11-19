import { describe, expect, it } from "vitest";
import { createRemoteHostClient } from "../../../../electron/main/hosts/remote-host-client.mjs";
import { HostSshError } from "../../../../electron/main/hosts/ssh/host-ssh-client.mjs";

const apiBase = "https://api.puppyone.ai/api/v1";
const folder = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const session = { userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", generation: "one" };
const wait = async () => {};

/** The folder's SSH connection as the client sees it: a files channel. */
function fakeSsh({ request = async () => ({ ok: true }), watch, get } = {}) {
  const ssh = { requests: [], closed: 0, gets: 0 };
  ssh.get = async (folderId, expected) => {
    ssh.gets++;
    if (get) await get(ssh.gets);
    expect(folderId).toBe(folder);
    expect(expected).toBe(session);
    return { files: async () => ({
      request: async (body, options) => { ssh.requests.push({ body, options }); return request(body, ssh.requests.length); },
      watch: watch ?? (async () => () => {}),
    }) };
  };
  ssh.close = () => { ssh.closed++; };
  return ssh;
}

describe("remote host client", () => {
  it("sends protocol operations inside the folder's SSH session, never other fields", async () => {
    const ssh = fakeSsh();
    const client = createRemoteHostClient({ apiBase, wait, auth: {}, ssh });
    await client.request(folder, { action: "list", path: "" }, session);
    await client.request(folder, { action: "write", path: "n.md", content_base64: "bmV3", expected_revision: null, folder_id: "x" }, session);
    await client.request(folder, { action: "move", path: "a.md", destination: "b/a.md" }, session);
    await client.request(folder, { action: "git", op: "status" }, session);
    expect(ssh.requests.map(({ body }) => body)).toEqual([
      { action: "list", path: "" },
      { action: "write", path: "n.md", content_base64: "bmV3", expected_revision: null },
      { action: "move", path: "a.md", destination: "b/a.md" },
      { action: "git", op: "status" },
    ]);
    expect(ssh.requests.map(({ options }) => options.mutating)).toEqual([false, true, true, false]);
    expect(await client.request("not-a-folder", { action: "list", path: "" }, session)).toMatchObject({ ok: false, status: 400 });
    expect(await client.request(folder, { action: "chmod", path: "x" }, session)).toMatchObject({ ok: false, status: 400 });
  });

  it("retries a read through a lost connection, but sends a write exactly once", async () => {
    const lost = () => { throw new HostSshError("network_unavailable", { status: 0 }); };
    const reads = fakeSsh({ request: async (_body, count) => (count < 3 ? lost() : { revision: "r" }) });
    const client = createRemoteHostClient({ apiBase, wait, auth: {}, ssh: reads });
    expect(await client.request(folder, { action: "read", path: "a.md" }, session)).toEqual({ ok: true, result: { revision: "r" } });
    expect(reads.requests).toHaveLength(3);
    expect(reads.closed).toBe(2);

    const writes = fakeSsh({ request: async () => { throw new HostSshError("network_unavailable", { status: 0, outcomeUnknown: true }); } });
    const writer = createRemoteHostClient({ apiBase, wait, auth: {}, ssh: writes });
    expect(await writer.request(folder, { action: "write", path: "a.md", content_base64: "", expected_revision: null }, session))
      .toEqual({ ok: false, status: 0, code: "network_unavailable", outcomeUnknown: true });
    expect(writes.requests).toHaveLength(1);
  });

  it("returns structured failures that survive IPC", async () => {
    const conflict = createRemoteHostClient({ apiBase, wait, auth: {}, ssh: fakeSsh({ request: async () => { throw new HostSshError("conflict"); } }) });
    expect(await conflict.request(folder, { action: "write", path: "a", content_base64: "", expected_revision: null }, session))
      .toEqual({ ok: false, status: 409, code: "conflict", outcomeUnknown: false });
    const offline = createRemoteHostClient({ apiBase, wait, auth: {}, ssh: fakeSsh({ get: async () => { throw new HostSshError("device_offline"); } }) });
    expect(await offline.request(folder, { action: "list", path: "" }, session))
      .toEqual({ ok: false, status: 503, code: "device_offline", outcomeUnknown: false });
    // A session API refusal (the certificate route) keeps its status and code.
    const revoked = createRemoteHostClient({ apiBase, wait, auth: {}, ssh: fakeSsh({ get: async () => {
      throw Object.assign(new Error('Request failed (404): {"detail":{"code":"device_unavailable"}}'), { status: 404 });
    } }) });
    expect(await revoked.request(folder, { action: "list", path: "" }, session))
      .toMatchObject({ ok: false, status: 404, code: "device_unavailable" });
  });

  it("watch delivers changes, reports offline, reconnects with a rescan, and ends on a definite denial", async () => {
    const events = [];
    let watches = 0;
    const ssh = fakeSsh({
      get: async (count) => { if (count === 3) throw new HostSshError("folder_unavailable"); },
      watch: async (onEvent, ended) => {
        watches++;
        setTimeout(() => { onEvent({ paths: ["a.md"], reset: false }); ended(); }, 0);
        return () => {};
      },
    });
    const client = createRemoteHostClient({ apiBase, wait, auth: {}, ssh });
    await client.watch(folder, session, async (event) => { events.push(event); }, new AbortController().signal);
    expect(watches).toBe(2);
    expect(events).toEqual([
      { type: "change", paths: ["a.md"], reset: false },
      { type: "offline", code: "device_offline" },
      // After an outage the editor rescans: it may have missed changes.
      { type: "change", paths: [], reset: true },
      { type: "change", paths: ["a.md"], reset: false },
      { type: "offline", code: "device_offline" },
      { type: "unavailable", retryable: false, code: "folder_unavailable" },
    ]);
  });
});
