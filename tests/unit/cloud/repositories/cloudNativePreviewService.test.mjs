import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createCloudNativePreviewService } from "../../../../electron/main/cloud-native-preview-service.mjs";

const base = "https://cloud-fixture.puppyone.ai/api/v1";
const input = (name = "data.sqlite") => ({ id: "fixture-id", apiBaseUrl: base, projectId: "fixture-project", path: name,
  expectedSession: { userId: "fixture-user", generation: "fixture-generation" } });
const cases = [];
async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cloud-native-preview-test-"));
  let session = { user_id: "fixture-user", session_generation: "fixture-generation", api_base_url: base };
  const database = { open: vi.fn(async (_owner, request, authorize) => {
    expect(await authorize()).toBe(request.rootPath);
    expect(await fs.readFile(path.join(request.rootPath, request.path), "utf8")).toBe("immutable source");
    return { engine: "sqlite" };
  }), page: vi.fn(async (_owner, _request, authorize) => { await authorize(); return { rows: [] }; }), close: vi.fn(async () => {}) };
  const auth = { readSession: vi.fn(async () => session), requestSessionApi: vi.fn(async (_base, endpoint, init, expected) => {
    expect(expected).toEqual(input().expectedSession);
    expect(init.signal).toBeInstanceOf(AbortSignal);
    if (endpoint.endsWith("/ls")) return { head_commit_id: "fixture-head" };
    if (endpoint.includes("/stat?")) throw Object.assign(new Error("missing"), { status: 404 });
    const source = JSON.parse(init.body);
    return { url: `${base}/content/fixture-project/inline?path=${encodeURIComponent(source.path)}&token=fixture-token` };
  }) };
  const fetchResource = vi.fn(async () => new Response("immutable source"));
  const convertOffice = vi.fn(async (directory, name, options) => {
    options.signal.throwIfAborted();
    expect(await fs.readFile(path.join(directory, name), "utf8")).toBe("immutable source");
    return { bytes: new Uint8Array([1, 2]), warnings: [] };
  });
  const service = createCloudNativePreviewService({ auth, database, convertOffice, fetchResource, temporaryRoot: root });
  const fixture = { root, service, auth, database, fetchResource, convertOffice, setSession: (next) => { session = next; } };
  cases.push(fixture); return fixture;
}
afterEach(async () => {
  for (const fixture of cases.splice(0)) { await fixture.service.closeAll(); await fs.rm(fixture.root, { recursive: true, force: true }); }
});
describe("authenticated Cloud native decoder leases", () => {
  it("shares the read-only engine, keeps bytes private and drains before deleting input", async () => {
    const f = await setup();
    expect(await f.service.openDatabase(7, input())).toEqual({ engine: "sqlite" });
    const request = f.database.open.mock.calls[0][1];
    expect(request.path).toBe("source.sqlite");
    expect((await fs.stat(path.join(request.rootPath, request.path))).mode & 0o777).toBe(0o400);
    expect(await f.service.readDatabase(7, { id: input().id, objectId: "object" })).toEqual({ rows: [] });
    await expect(f.service.readDatabase(8, { id: input().id })).rejects.toMatchObject({ code: "session-expired" });
    let release;
    f.database.close.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    const closing = f.service.close(7, input().id);
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    expect(await fs.readdir(f.root)).toHaveLength(1);
    // close is called again by cleanup; all subsequent calls acknowledge exit.
    f.database.close.mockResolvedValue(); release(); await closing;
    expect(await fs.readdir(f.root)).toEqual([]);
  });
  it("converts only supported Office inputs and cleans up on success", async () => {
    const f = await setup();
    expect((await f.service.convertOffice(7, input("report.rtf"))).bytes).toEqual(new Uint8Array([1, 2]));
    expect(await fs.readdir(f.root)).toEqual([]);
    await expect(f.service.convertOffice(7, input("image.png"))).rejects.toThrow(/Unsupported/);
    expect(f.convertOffice).toHaveBeenCalledTimes(1);
  });
  it.each(["https://other.test/private?path=data.sqlite&token=x", `${base}/content/other/inline?path=data.sqlite&token=x`,
    `${base}/content/fixture-project/inline?path=other.sqlite&token=x`])("rejects forged signed endpoints before native fetch: %s", async (url) => {
    const f = await setup();
    f.auth.requestSessionApi.mockImplementation(async (_base, endpoint) => endpoint.endsWith("/ls") ? { head_commit_id: "h" } : { url });
    await expect(f.service.openDatabase(7, input())).rejects.toMatchObject({ code: "permission-denied" });
    expect(f.fetchResource).not.toHaveBeenCalled(); expect(await fs.readdir(f.root)).toEqual([]);
  });
  it("rejects session changes and revokes existing leases without revoking token refreshes", async () => {
    const f = await setup(); await f.service.openDatabase(7, input());
    await f.service.reconcileSession(); expect(f.database.page).not.toHaveBeenCalled();
    expect(await fs.readdir(f.root)).toHaveLength(1);
    f.setSession(null); await f.service.reconcileSession();
    expect(await fs.readdir(f.root)).toEqual([]);
    await expect(f.service.openDatabase(7, input())).rejects.toMatchObject({ code: "permission-denied" });
  });
  it("rejects recovery sidecars and changing HEAD before starting a decoder", async () => {
    const f = await setup();
    const original = f.auth.requestSessionApi.getMockImplementation();
    f.auth.requestSessionApi.mockImplementation(async (...args) => args[1].includes("/stat?") ? { exists: true } : original(...args));
    await expect(f.service.openDatabase(7, input())).rejects.toMatchObject({ code: "recovery-required" });
    let head = 0;
    f.auth.requestSessionApi.mockImplementation(async (...args) => args[1].endsWith("/ls") ? { head_commit_id: `${++head}` } : original(...args));
    await expect(f.service.openDatabase(7, input())).rejects.toMatchObject({ code: "stale-input" });
    expect(f.database.open).not.toHaveBeenCalled(); expect(await fs.readdir(f.root)).toEqual([]);
  });
  it.each([{ length: "9000000000", body: "too large", code: "budget-exceeded" },
    { length: "1", body: "truncated mismatch", code: "missing-member" }, { length: "-1", body: "invalid", code: "budget-exceeded" }])(
    "bounds declared and actual download bytes: $code/$length", async ({ length, body, code }) => {
      const f = await setup(); f.fetchResource.mockResolvedValue(new Response(body, { headers: { "content-length": length } }));
      await expect(f.service.openDatabase(7, input())).rejects.toMatchObject({ code });
      expect(f.database.open).not.toHaveBeenCalled(); expect(await fs.readdir(f.root)).toEqual([]);
    });
  it("cancels a pending download and waits for it before removing its private directory", async () => {
    const f = await setup();
    f.fetchResource.mockImplementation((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }));
    const opening = f.service.openDatabase(7, input());
    void opening.catch(() => {});
    await vi.waitFor(() => expect(f.fetchResource).toHaveBeenCalled());
    await f.service.closeOwner(7); await expect(opening).rejects.toThrow();
    expect(await fs.readdir(f.root)).toEqual([]); expect(f.database.open).not.toHaveBeenCalled();
  });
});
