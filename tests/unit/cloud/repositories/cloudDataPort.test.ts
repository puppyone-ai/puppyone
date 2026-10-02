/** @vitest-environment happy-dom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkspaceResourceUri } from "@puppyone/shared-ui";
import { createCloudDataService } from "../../../../src/features/cloud/workbench/cloudDataPort";
import type { DesktopCloudSession } from "../../../../src/lib/cloudApi";

const API = "https://cloud-fixture.puppyone.ai/api/v1";
const session: DesktopCloudSession = { api_base_url: API, user_id: "owner", user_email: "owner@example.com",
  session_generation: "one", expires_at: Date.now() + 3_600_000, expires_in: 3600, status: "authenticated" };
const context = { status: "resolved" as const, projectId: "project", projectName: "Shared project",
  target: { kind: "project_root" as const, project_id: "project" }, capabilities: ["content.read", "content.write"] };
let bridge: ReturnType<typeof vi.fn>;
let files: Map<string, string>;
let revision: number;
const error = (status: number) => Object.assign(new Error(`Cloud HTTP ${status}`), { status });
const entry = (path: string) => ({ path, name: path.split("/").at(-1), type: path.endsWith(".md") ? "markdown" : "file" });

beforeEach(() => {
  files = new Map([["readme.md", "Cloud original"], ["data.json", '{"cloud":true}'], ["notes/a.md", "Scoped original"], ["movie.mp4", "binary"]]);
  revision = 1;
  bridge = vi.fn(async (request) => {
    const url = new URL(request.path, API);
    const operation = url.pathname.split("/").at(-1);
    const path = url.searchParams.get("path") ?? "";
    if (request.method === "GET") {
      if (operation === "ls") return { head_commit_id: `head-${revision}`, entries: [...files.keys()].filter((file) => file.startsWith(path ? `${path}/` : "") && !file.slice(path.length + (path ? 1 : 0)).includes("/")).map(entry) };
      if (!files.has(path)) throw error(404);
      if (operation === "stat") return { ...entry(path), exists: true, head_commit_id: `head-${revision}` };
      if (operation === "cat") return { path, type: entry(path).type, content_text: files.get(path), head_commit_id: `head-${revision}` };
    }
    const body = JSON.parse(request.body);
    if (operation === "sign") return { url: `/api/v1/content/project/inline?path=${encodeURIComponent(body.path)}&token=fixture-token` };
    if (body.base_commit_id !== `head-${revision}`) throw error(409);
    if (operation === "write") { files.set(body.path, body.content); revision++; return { path: body.path, commit_id: `head-${revision}`, conflicts: [] }; }
    if (operation === "mv") { files.set(body.new_path, files.get(body.old_path)!); files.delete(body.old_path); }
    if (operation === "rm") files.delete(body.path);
    revision++;
    return { path: body.path, commit_id: `head-${revision}` };
  });
  window.puppyoneDesktop = { requestCloudSessionApi: bridge } as unknown as NonNullable<typeof window.puppyoneDesktop>;
});
const service = (extra: Partial<Parameters<typeof createCloudDataService>[0]> = {}) => createCloudDataService({ session, context, apiBaseUrl: API, ...extra });
const save = (port: ReturnType<typeof service>["dataPort"], path: string, content: string, baseVersion: string | null) => port.documentPersistence!.persist({ path, content, baseVersion, revision: "edit-1", reason: "edit" });

describe("native Cloud provider", () => {
  it("uses Cloud URIs and secure host transport for the tree, source and save target", async () => {
    const cloud = service();
    const nodes = await cloud.dataPort.listChildren(null);
    const node = nodes.find((item) => item.name === "readme.md")!;
    expect(node.source).toBe("cloud");
    expect(node.path).toBe(createWorkspaceResourceUri(cloud.folder.uri, "readme.md"));
    expect(node.path).not.toContain("puppyone-local:");
    expect(await cloud.dataPort.readFile!(node.path)).toMatchObject({ content: "Cloud original", version: "head-1", path: node.path });
    expect(await save(cloud.dataPort, node.path, "Cloud edit", "head-1")).toEqual({ ok: true, version: "head-2" });
    expect(files.get("readme.md")).toBe("Cloud edit");
    expect(bridge.mock.calls.every(([request]) => request.apiBaseUrl === API && !request.headers.Authorization)).toBe(true);
    const write = bridge.mock.calls.find(([request]) => request.path.endsWith("/write"))![0];
    expect(JSON.parse(write.body)).toMatchObject({ path: "readme.md", content: "Cloud edit", base_commit_id: "head-1", node_type: "markdown" });
  });

  it("separates accounts, hosts, projects, scopes and local paths in storage identity", () => {
    const original = service();
    expect(service({ session: { ...session, user_id: "other" } }).workspace.id).not.toBe(original.workspace.id);
    expect(service({ apiBaseUrl: "https://other-fixture.puppyone.ai/api/v1" }).workspace.id).not.toBe(original.workspace.id);
    expect(service({ context: { ...context, projectId: "other", target: { kind: "project_root", project_id: "other" } } }).workspace.id).not.toBe(original.workspace.id);
    expect(original.dataPort.documentPersistence?.kind).toBe("cloud");
    expect(original.resolveResource("puppyone-local://workspace/id/readme.md")).toBeNull();
  });

  it("keeps scoped Cloud paths inside their own tree", async () => {
    const scoped = service({ context: { ...context, target: { kind: "scope", project_id: "project", scope_id: "notes-scope" }, scopePath: "notes" } });
    const [node] = await scoped.dataPort.listChildren(null);
    expect(node!.name).toBe("a.md");
    expect(scoped.resolveResource(node!.path)?.providerPath).toBe("a.md");
    expect((await scoped.dataPort.readFile!(node!.path)).content).toBe("Scoped original");
    await expect(scoped.dataPort.listChildren("../readme.md")).rejects.toThrow(/traversal/);
    expect(bridge.mock.calls.filter(([request]) => request.method === "GET").every(([request]) => new URL(request.path, API).searchParams.get("path")?.startsWith("notes"))).toBe(true);
  });

  it("does not accept entries outside the resolved Cloud scope", async () => {
    bridge.mockResolvedValueOnce({ entries: [entry("secret.md")], head_commit_id: "head-1" });
    const scoped = service({ context: { ...context, target: { kind: "scope", project_id: "project", scope_id: "scope" }, scopePath: "notes" } });
    await expect(scoped.dataPort.listChildren(null)).rejects.toThrow(/outside/);
  });

  it("requires a resolved scope before opening a scoped repository", () => {
    expect(() => service({ context: { ...context, target: { kind: "scope", project_id: "project", scope_id: "scope" } } })).toThrow(/scope/);
  });

  it("offers read capabilities only to Cloud viewers", async () => {
    const cloud = service({ context: { ...context, capabilities: ["content.read"] } });
    expect(await cloud.dataPort.readFile!("readme.md")).toMatchObject({ content: "Cloud original" });
    expect(cloud.writable).toBe(false);
    for (const name of ["documentPersistence", "createFile", "createFolder", "renameNode", "moveNode", "deleteNode"] as const) expect(cloud.dataPort[name]).toBeUndefined();
    expect(cloud.folder.capabilities).toMatchObject({ read: true, write: false, execute: false });
  });

  it("returns a same-file conflict without overwriting another writer", async () => {
    const cloud = service();
    await cloud.dataPort.readFile!("readme.md");
    files.set("readme.md", "Someone else's Cloud edit"); revision++;
    expect(await save(cloud.dataPort, "readme.md", "My edit", "head-1")).toEqual({ ok: false, kind: "conflict", content: "Someone else's Cloud edit", version: "head-2" });
    expect(files.get("readme.md")).toBe("Someone else's Cloud edit");
    expect(bridge.mock.calls.filter(([request]) => request.path.endsWith("/write"))).toHaveLength(1);
  });

  it("retries a project HEAD change only when the edited file's base bytes are unchanged", async () => {
    const cloud = service();
    await cloud.dataPort.readFile!("readme.md");
    files.set("data.json", '{"otherWriter":true}'); revision++;
    expect(await save(cloud.dataPort, "readme.md", "My edit", "head-1")).toEqual({ ok: true, version: "head-3" });
    expect(files.get("data.json")).toBe('{"otherWriter":true}');
    expect(bridge.mock.calls.filter(([request]) => request.path.endsWith("/write")).map(([request]) => JSON.parse(request.body).base_commit_id)).toEqual(["head-1", "head-2"]);
  });

  it("serializes writes from two editors without mistaking another file's save for a conflict", async () => {
    const cloud = service();
    await Promise.all([cloud.dataPort.readFile!("readme.md"), cloud.dataPort.readFile!("data.json")]);
    const result = await Promise.all([save(cloud.dataPort, "readme.md", "One", "head-1"), save(cloud.dataPort, "data.json", "{}", "head-1")]);
    expect(result.every((item) => item.ok)).toBe(true);
    expect(files.get("readme.md")).toBe("One"); expect(files.get("data.json")).toBe("{}");
  });

  it.each([null, ""])("never writes without a usable base revision (%s)", async (baseVersion) => {
    const cloud = service();
    expect(await save(cloud.dataPort, "readme.md", "Unknown edit", baseVersion)).toMatchObject({ ok: false, kind: "io" });
    expect(bridge).not.toHaveBeenCalled();
  });

  it("rejects an empty server revision before reading or creating a writable document", async () => {
    const actual = bridge.getMockImplementation()! as (request: unknown) => Promise<unknown>;
    bridge.mockImplementation(async (request) => {
      const response = await actual(request);
      return new URL(request.path, API).pathname.endsWith("/ls")
        ? { ...(response as object), head_commit_id: "" } : response;
    });
    const cloud = service();
    await expect(cloud.dataPort.readFile!("readme.md")).rejects.toThrow(/storage revision/);
    await expect(cloud.dataPort.createFile!("new.md", "New file")).rejects.toThrow(/storage revision/);
    expect(bridge.mock.calls.filter(([request]) => request.method === "POST")).toHaveLength(0);
    expect(files.get("readme.md")).toBe("Cloud original");
  });

  it("revokes old-account reads and queued writes before dispatch", async () => {
    let current = true;
    const cloud = service({ isCurrent: () => current });
    await cloud.dataPort.readFile!("readme.md");
    current = false;
    await expect(cloud.dataPort.listChildren(null)).rejects.toThrow(/session changed/);
    await expect(save(cloud.dataPort, "readme.md", "Stale edit", "head-1")).rejects.toThrow(/session changed/);
    expect(files.get("readme.md")).toBe("Cloud original");
    expect(bridge.mock.calls.filter(([request]) => request.method === "POST")).toHaveLength(0);
  });

  it("discards a result that arrives after the authority changed", async () => {
    let current = true;
    bridge.mockImplementationOnce(async () => { current = false; return { entries: [entry("readme.md")], head_commit_id: "head-1" }; });
    await expect(service({ isCurrent: () => current }).dataPort.listChildren(null)).rejects.toThrow(/session changed/);
  });

  it("keeps Cloud outages as Cloud errors instead of reading local files", async () => {
    bridge.mockRejectedValue(error(503));
    const localRead = vi.fn();
    Object.assign(window.puppyoneDesktop!, { readWorkspaceFile: localRead });
    await expect(service().dataPort.readFile!("readme.md")).rejects.toThrow(/503/);
    expect(localRead).not.toHaveBeenCalled();
  });

  it("uses signed inline URLs for native binary previews without decoding the binary as text", async () => {
    const cloud = service();
    expect(await cloud.dataPort.readFile!("movie.mp4")).toMatchObject({ content: null, type: "video" });
    const url = new URL(await cloud.dataPort.getFileUrl!("movie.mp4"));
    expect(url.origin).toBe("https://cloud-fixture.puppyone.ai"); expect(url.searchParams.get("path")).toBe("movie.mp4");
    expect(bridge.mock.calls.some(([request]) => request.path.includes("/cat"))).toBe(false);
    await expect(cloud.dataPort.getFileUrl!("movie.mp4", { expectedVersion: "head-1" })).rejects.toThrow(/Immutable/);
  });

  it.each([
    "https://untrusted.example/api/v1/content/project/inline?path=readme.md&token=secret",
    "/api/v1/content/another-project/inline?path=readme.md&token=secret",
    "/api/v1/content/project/inline?path=secret.md&token=secret",
  ])("rejects signed preview URLs for a different authority or resource: %s", async (url) => {
    bridge.mockResolvedValueOnce({ url });
    await expect(service().dataPort.getFileUrl!("readme.md")).rejects.toThrow(/invalid/);
  });

  it("creates and renames through Cloud CAS while refusing to replace an existing destination", async () => {
    const cloud = service();
    await expect(cloud.dataPort.createFile!("readme.md", "replacement")).rejects.toThrow(/already exists/);
    await cloud.dataPort.createFile!("new.md", "new");
    await cloud.dataPort.renameNode!("new.md", "renamed.md");
    await cloud.dataPort.deleteNode!("renamed.md");
    const move = bridge.mock.calls.find(([request]) => request.path.endsWith("/mv"))![0];
    expect(JSON.parse(move.body)).toMatchObject({ old_path: "new.md", new_path: "renamed.md", no_clobber: true, base_commit_id: "head-2" });
    expect(files.has("renamed.md")).toBe(false);
    expect(files.get("readme.md")).toBe("Cloud original");
    expect(cloud.dataPort.copyNode).toBeUndefined();
  });

  it("blocks repository-root mutation and traversal before sending a request", async () => {
    const cloud = service();
    await expect(cloud.dataPort.deleteNode!(cloud.folder.uri)).rejects.toThrow(/root/);
    await expect(cloud.dataPort.moveNode!(cloud.folder.uri, "destination")).rejects.toThrow(/root/);
    await expect(cloud.dataPort.renameNode!("readme.md", "../escape.md")).rejects.toThrow(/Invalid/);
    await expect(cloud.dataPort.readFile!("../outside.md")).rejects.toThrow(/traversal/);
    expect(bridge).not.toHaveBeenCalled();
  });

  it("preserves alternate extensions instead of silently appending .md or .json", async () => {
    files.set("notes.mdx", "before");
    const cloud = service(); await cloud.dataPort.readFile!("notes.mdx");
    expect(await save(cloud.dataPort, "notes.mdx", "after", "head-1")).toMatchObject({ ok: true });
    const request = bridge.mock.calls.find(([item]) => item.path.endsWith("/write"))![0];
    expect(JSON.parse(request.body).node_type).toBe("file");
  });

  it("rejects a mixed blob/HEAD response and retries before establishing a save baseline", async () => {
    const actual = bridge.getMockImplementation()! as (request: unknown) => Promise<unknown>;
    let firstCat = true;
    bridge.mockImplementation(async (request) => {
      if (request.path.includes("/cat") && firstCat) {
        firstCat = false; files.set("readme.md", "Published during read"); revision++;
        return { content_text: "Cloud original", head_commit_id: "head-2" };
      }
      return actual(request);
    });
    const cloud = service();
    expect(await cloud.dataPort.readFile!("readme.md")).toMatchObject({ content: "Published during read", version: "head-2" });
    expect(await save(cloud.dataPort, "readme.md", "Edited current version", "head-2")).toMatchObject({ ok: true });
  });

  it("does not overwrite a file created while the directory response was being assembled", async () => {
    const actual = bridge.getMockImplementation()! as (request: unknown) => Promise<unknown>;
    let directoryReads = 0;
    bridge.mockImplementation(async (request) => {
      if (request.path.includes("/ls") && ++directoryReads === 2) {
        files.set("new.md", "Other creator"); revision++;
        return { entries: [], head_commit_id: "head-2" };
      }
      return actual(request);
    });
    await expect(service().dataPort.createFile!("new.md", "My new file")).rejects.toThrow(/already exists/);
    expect(files.get("new.md")).toBe("Other creator");
    expect(bridge.mock.calls.some(([request]) => request.method === "POST")).toBe(false);
  });

  it("allows a restored baseline only through CAS and never retries it without the original bytes", async () => {
    expect(await save(service().dataPort, "readme.md", "Restored draft", "head-1")).toMatchObject({ ok: true });
    const restored = service();
    files.set("readme.md", "New writer"); revision++;
    expect(await save(restored.dataPort, "readme.md", "Older draft", "head-1")).toMatchObject({ ok: false, kind: "conflict", content: "New writer" });
    expect(files.get("readme.md")).toBe("New writer");
  });

  it("does not load an aborted editor input", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(service().dataPort.readFile!("readme.md", { signal: controller.signal })).rejects.toThrow();
    expect(bridge).not.toHaveBeenCalled();
  });
});
