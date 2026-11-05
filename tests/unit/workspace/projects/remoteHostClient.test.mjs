import { describe, expect, it } from "vitest";
import { createRemoteHostClient, readHostFolderEvents } from "../../../../electron/main/hosts/remote-host-client.mjs";

const apiBase = "https://api.puppyone.ai/api/v1";
const folder = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const session = { userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", generation: "one" };
const wait = async () => {};

function httpError(status, detail) {
  const error = new Error(`Request failed (${status}): ${JSON.stringify(detail)}`);
  error.status = status;
  return error;
}

describe("remote host client", () => {
  it("maps protocol operations to the folder API with credentials kept in Main", async () => {
    const calls = [];
    const client = createRemoteHostClient({ apiBase, wait, auth: { requestSessionApi: async (base, path, init, expected) => {
      calls.push({ base, path, method: init.method, body: init.body && JSON.parse(init.body), expected });
      return { ok: true };
    } } });
    await client.request(folder, { action: "list", path: "" }, session);
    await client.request(folder, { action: "read", path: "a b.md" }, session);
    await client.request(folder, { action: "write", path: "n.md", content_base64: "bmV3", expected_revision: null }, session);
    await client.request(folder, { action: "move", path: "a.md", destination: "b/a.md" }, session);
    await client.request(folder, { action: "remove", path: "b" }, session);
    expect(calls.map(({ path, method }) => `${method} ${path}`)).toEqual([
      `GET /hosts/folders/${folder}/files?path=`,
      `GET /hosts/folders/${folder}/file?path=a%20b.md`,
      `PUT /hosts/folders/${folder}/file`,
      `POST /hosts/folders/${folder}/files`,
      `POST /hosts/folders/${folder}/files`,
    ]);
    expect(calls[2].body).toEqual({ path: "n.md", content_base64: "bmV3", expected_revision: null });
    expect(calls[3].body).toEqual({ action: "move", path: "a.md", destination: "b/a.md" });
    expect(calls.every((call) => call.base === apiBase && call.expected === session)).toBe(true);
    expect(await client.request("not-a-folder", { action: "list", path: "" }, session)).toMatchObject({ ok: false, status: 400 });
    expect(await client.request(folder, { action: "chmod", path: "x" }, session)).toMatchObject({ ok: false, status: 400 });
  });

  it("retries a read through a transport hiccup, but sends a write exactly once", async () => {
    let reads = 0;
    let writes = 0;
    const client = createRemoteHostClient({ apiBase, wait, auth: { requestSessionApi: async (_base, path, init) => {
      if (init.method === "GET") {
        reads++;
        if (reads < 3) throw reads === 1 ? Object.assign(new Error("fetch failed"), {}) : httpError(502, { detail: {} });
        return { entries: [] };
      }
      writes++;
      throw Object.assign(new Error("socket hang up"), {});
    } } });
    expect(await client.request(folder, { action: "list", path: "" }, session)).toEqual({ ok: true, result: { entries: [] } });
    expect(reads).toBe(3);
    const write = await client.request(folder, { action: "write", path: "n.md", content_base64: "", expected_revision: null }, session);
    expect(writes).toBe(1);
    expect(write).toMatchObject({ ok: false, status: 0, outcomeUnknown: true });
  });

  it("returns structured failures that survive IPC", async () => {
    const client = createRemoteHostClient({ apiBase, wait, auth: { requestSessionApi: async () => {
      throw httpError(503, { detail: { code: "device_disconnected", outcome_unknown: true } });
    } } });
    expect(await client.request(folder, { action: "write", path: "n.md", content_base64: "", expected_revision: null }, session))
      .toEqual({ ok: false, status: 503, code: "device_disconnected", outcomeUnknown: true });
    const offline = createRemoteHostClient({ apiBase, wait, auth: { requestSessionApi: async () => {
      throw httpError(503, { detail: { code: "device_offline" } });
    } } });
    expect(await offline.request(folder, { action: "read", path: "n.md" }, session))
      .toEqual({ ok: false, status: 503, code: "device_offline", outcomeUnknown: false });
  });

  it("parses folder change events and stops at an unavailable event", async () => {
    const body = [
      ": keepalive\n\n",
      "event: change\ndata: {\"paths\": [], \"reset\": true}\n\n",
      "event: change\ndata: {\"paths\": [\"sub/a.md\"], \"reset\": false}\n\n",
      "event: unavailable\ndata: {\"retryable\": true}\n\n",
      "event: change\ndata: {\"paths\": [\"never.md\"], \"reset\": false}\n\n",
    ].join("");
    const response = new Response(body, { headers: { "content-type": "text/event-stream" } });
    const events = [];
    const end = await readHostFolderEvents(response, async (event) => { events.push(event); });
    expect(events).toEqual([{ type: "change", paths: [], reset: true }, { type: "change", paths: ["sub/a.md"], reset: false }]);
    expect(end).toEqual({ type: "unavailable", retryable: true });
    await expect(readHostFolderEvents(new Response("event: change\ndata: {\"paths\": [1]}\n\n",
      { headers: { "content-type": "text/event-stream" } }), async () => {})).rejects.toThrow("Invalid folder notification");
  });

  it("watch reports offline and reconnects, and ends on a definite denial", async () => {
    let attempts = 0;
    const emitted = [];
    const controller = new AbortController();
    const client = createRemoteHostClient({ apiBase, wait, auth: { requestSessionApi: async (_base, _path, init) => {
      attempts++;
      if (attempts === 1) return { type: "unavailable", retryable: true };
      if (attempts === 2) { await init.onHostFolderEvent({ type: "change", paths: ["a.md"], reset: false }); throw httpError(503, {}); }
      throw httpError(403, { detail: { code: "folder_unavailable" } });
    } } });
    await client.watch(folder, session, async (event) => { emitted.push(event); }, controller.signal);
    expect(emitted).toEqual([
      { type: "offline", code: "device_offline" },
      { type: "change", paths: ["a.md"], reset: false },
      { type: "offline", code: "file_operation_failed" },
      { type: "unavailable", retryable: false, code: "folder_unavailable" },
    ]);
  });
});
