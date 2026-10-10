/** @vitest-environment happy-dom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FILE_FORMATS, createWorkspaceResourceUri, getEditorSourceRequirement, isDocumentDataNode, resolveEditorViewer } from "@puppyone/shared-ui";
import { createCloudDataService } from "../../../../src/features/cloud/files/cloudDataPort";
import { cloudCache } from "../../../../src/features/cloud/cache/cloudCache";
import type { DesktopCloudSession } from "../../../../src/lib/cloudApi";
import { captureCloudWorkspaceShareResource } from "../../../../src/features/cloud/share/cloudWorkspaceShareResource";
import type { NativeCloudWorkbench } from "../../../../src/features/cloud/workbench/useNativeCloudWorkbench";

import { nativeSnapshot, nativeVersion, nativeReceipt } from "../../../fixtures/cloud/repositories/nativeRepository";

const API = "https://cloud-fixture.puppyone.ai/api/v1";
const session: DesktopCloudSession = { api_base_url: API, user_id: "owner", user_email: "owner@example.com",
  session_generation: "one", expires_at: Date.now() + 3_600_000, expires_in: 3600, status: "authenticated" };
const context = { status: "resolved" as const, projectId: "project", projectName: "Shared project",
  target: { kind: "project_root" as const, project_id: "project" }, capabilities: ["content.read", "content.write"] };
let bridge: ReturnType<typeof vi.fn>;
let files: Map<string, string>;
let revision: number;
let mimeTypes: Map<string, string>;
const error = (status: number) => Object.assign(new Error(`Cloud HTTP ${status}`), { status });
const entry = (path: string) => ({ path, name: path.split("/").at(-1), type: path.endsWith(".md") ? "markdown" : "file", mime_type: mimeTypes.get(path) });

beforeEach(() => {
  cloudCache.clear();
  vi.restoreAllMocks();
  files = new Map([["readme.md", "Cloud original"], ["data.json", '{"cloud":true}'], ["notes/a.md", "Scoped original"], ["movie.mp4", "binary"]]);
  revision = 1;
  mimeTypes = new Map();
  bridge = vi.fn(async (request) => {
    const url = new URL(request.path, API);
    const operation = url.pathname.split("/").at(-1);
    const path = url.searchParams.get("path") ?? "";
    if (request.method === "GET") {
      if (operation === "ls") return { ...nativeSnapshot(`head-${revision}`), entries: [...files.keys()].filter((file) => file.startsWith(path ? `${path}/` : "") && !file.slice(path.length + (path ? 1 : 0)).includes("/")).map(entry) };
      if (!files.has(path)) throw error(404);
      if (operation === "stat") return { ...entry(path), exists: true, ...nativeSnapshot(`head-${revision}`) };
      if (operation === "cat") return { path, type: entry(path).type, content_text: files.get(path), ...nativeSnapshot(`head-${revision}`) };
    }
    const body = JSON.parse(request.body);
    if (operation === "sign") return { url: `/api/v1/content/project/inline?path=${encodeURIComponent(body.path)}&token=fixture-token` };
    if (body.base_commit_id !== `head-${revision}`) throw error(409);
    if (operation === "write") { files.set(body.path, body.content); revision++; return { path: body.path, ...nativeReceipt(`head-${revision}`), conflicts: [] }; }
    if (operation === "mv") { files.set(body.new_path, files.get(body.old_path)!); files.delete(body.old_path); }
    if (operation === "rm") files.delete(body.path);
    revision++;
    return { path: body.path, ...nativeReceipt(`head-${revision}`) };
  });
  window.puppyoneDesktop = { requestCloudSessionApi: bridge } as unknown as NonNullable<typeof window.puppyoneDesktop>;
});
const service = (extra: Partial<Parameters<typeof createCloudDataService>[0]> = {}) => createCloudDataService({ session, context, apiBaseUrl: API, ...extra });
const save = (port: ReturnType<typeof service>["dataPort"], path: string, content: string, baseVersion: string | null) => port.documentPersistence!.persist({ path, content, baseVersion, revision: "edit-1", reason: "edit" });

describe("Web-aligned Cloud reads", () => {
  const count = (operation: string) => bridge.mock.calls.filter(([request]) => new URL(request.path, API).pathname.endsWith(`/${operation}`)).length;
  it("captures the active tab's accepted bytes and siblings without another request", async () => {
    const cloud = service();
    await cloud.dataPort.listChildren(cloud.folder.uri);
    const path = createWorkspaceResourceUri(cloud.folder.uri, "readme.md");
    await cloud.dataPort.readFile(path);
    const before = bridge.mock.calls.length;
    const editorWorkbench = { activePath: path } as NativeCloudWorkbench["editorWorkbench"];
    const resource = captureCloudWorkspaceShareResource({ service: cloud,
      activeNode: { id: "old", path: "data.json", name: "data.json", type: "json" }, editorWorkbench });
    expect(resource?.path).toBe("readme.md");
    expect(resource?.directory).toBe(false);
    expect(resource?.file?.content?.content).toBe("Cloud original");
    expect(resource?.entries?.some(entry => entry.name === "data.json")).toBe(true);
    expect(bridge.mock.calls.length).toBe(before);
  });
  it("captures a selected scoped folder, then falls back to the authorized root", () => {
    const cloud = service({ context: { ...context, target: { kind: "scope", project_id: "project", scope_id: "notes" }, scopePath: "notes" } });
    const path = createWorkspaceResourceUri(cloud.folder.uri, "Research");
    const editorWorkbench = { activePath: null } as NativeCloudWorkbench["editorWorkbench"];
    expect(captureCloudWorkspaceShareResource({ service: cloud, activeNode: { id: path, path, name: "Research", type: "folder" }, editorWorkbench }))
      .toMatchObject({ path: "notes/Research", directory: true });
    expect(captureCloudWorkspaceShareResource({ service: cloud, activeNode: null, editorWorkbench }))
      .toMatchObject({ path: "notes", directory: true });
    expect(bridge).not.toHaveBeenCalled();
  });
  it("does not substitute a root for an active file outside the current provider", () => {
    expect(captureCloudWorkspaceShareResource({ service: service(), activeNode: null,
      editorWorkbench: { activePath: "puppyone-cloud://outside/readme.md" } as NativeCloudWorkbench["editorWorkbench"] })).toBeNull();
    expect(bridge).not.toHaveBeenCalled();
  });

  it("copies plain repository paths without requests or write permission", () => {
    const cloud = service({ context: { ...context, capabilities: ["content.read"] } });
    expect(cloud.getPathForCopy(createWorkspaceResourceUri(cloud.folder.uri, "docs/笔记 #1.md")))
      .toBe("docs/笔记 #1.md");
    expect(cloud.getPathForCopy(cloud.folder.uri)).toBe(".");
    expect(bridge).not.toHaveBeenCalled();
  });

  it("includes the resolved Cloud scope in copied repository paths", () => {
    const cloud = service({ context: { ...context, target: { kind: "scope", project_id: "project", scope_id: "notes" }, scopePath: "notes" } });
    expect(cloud.getPathForCopy(createWorkspaceResourceUri(cloud.folder.uri, "a.md"))).toBe("notes/a.md");
    expect(cloud.getPathForCopy(cloud.folder.uri)).toBe("notes");
    expect(bridge).not.toHaveBeenCalled();
  });

  it("rejects outside resources and retired Cloud sessions before copying a path", () => {
    let current = true;
    const cloud = service({ isCurrent: () => current });
    expect(() => cloud.getPathForCopy("puppyone-cloud://outside/readme.md")).toThrow();
    expect(() => cloud.getPathForCopy("../readme.md")).toThrow();
    current = false;
    expect(() => cloud.getPathForCopy("readme.md")).toThrow(/session changed/);
    expect(bridge).not.toHaveBeenCalled();
  });

  it("shares preflight, explorer and folder-view reads across provider instances", async () => {
    let finish!: (value: unknown) => void;
    bridge.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const preflight = service();
    const mounted = service();
    const first = preflight.dataPort.listChildren(null);
    const second = mounted.dataPort.listChildren(null);
    expect(count("ls")).toBe(1);
    finish({ entries: [entry("readme.md")], ...nativeSnapshot("head-1") });
    const [left, right] = await Promise.all([first, second]);
    expect(left).toEqual(right);
    expect(mounted.dataPort.getCachedChildren!(null)).toEqual(right);
    await service().dataPort.listChildren(null);
    expect(count("ls")).toBe(1);
  });

  it("paints stale directories while revalidating, then invalidates them after a write", async () => {
    let time = Date.now(); vi.spyOn(Date, "now").mockImplementation(() => time);
    const cloud = service();
    await cloud.dataPort.listChildren(null);
    time += 30_001;
    files.set("new.md", "new");
    expect(cloud.dataPort.getCachedChildren!(null)?.some((node) => node.name === "new.md")).toBe(false);
    await Promise.all([cloud.dataPort.listChildren(null), service().dataPort.listChildren(null)]);
    expect(count("ls")).toBe(2);
    expect(cloud.dataPort.getCachedChildren!(null)?.some((node) => node.name === "new.md")).toBe(true);
    await cloud.dataPort.deleteNode!("new.md");
    expect(cloud.dataPort.getCachedChildren!(null)).toBeUndefined();
    await cloud.dataPort.listChildren(null);
    expect(cloud.dataPort.getCachedChildren!(null)?.some((node) => node.name === "new.md")).toBe(false);
  });

  it("keeps preview signing read-only and protects an observed revision with CAS", async () => {
    const cloud = service();
    await cloud.dataPort.listChildren(null);
    await cloud.dataPort.getFileUrl!("movie.mp4");
    await cloud.dataPort.listChildren(null);
    expect(count("ls")).toBe(1);
    revision++;
    await expect(cloud.dataPort.deleteNode!("movie.mp4")).rejects.toMatchObject({ status: 409 });
    const deletion = bridge.mock.calls.find(([request]) => request.path.endsWith("/rm"))![0];
    expect(JSON.parse(deletion.body).base_commit_id).toBe("head-1");
    expect(count("ls")).toBe(1);
  });

  it("opens text with one cat request and shares it without coupling cancellation", async () => {
    const actual = bridge.getMockImplementation()! as (request: unknown) => Promise<unknown>;
    let finish!: (value: unknown) => void;
    bridge.mockImplementation((request) => request.path.includes("/cat")
      ? new Promise((resolve) => { finish = resolve; }) : actual(request));
    const controller = new AbortController();
    const cancelled = service().dataPort.readFile!("readme.md", { signal: controller.signal });
    const surviving = service().dataPort.readFile!("readme.md");
    await vi.waitFor(() => expect(count("cat")).toBe(1));
    const rejection = expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
    controller.abort(); await rejection;
    expect(count("stat")).toBe(0);
    expect(count("ls")).toBe(0);
    finish({ path: "readme.md", type: "markdown", content_text: "Cloud original", ...nativeSnapshot("head-1") });
    expect(await surviving).toMatchObject({ content: "Cloud original", version: nativeVersion("head-1") });
    expect(count("cat")).toBe(1);
  });

  it("isolates directory caches by scope, permissions and authenticated generation", async () => {
    await service().dataPort.listChildren(null);
    const restricted = service({ context: { ...context, capabilities: ["content.read"] } });
    expect(restricted.dataPort.getCachedChildren!(null)).toBeUndefined();
    const scoped = service({ context: { ...context, target: { kind: "scope", project_id: "project", scope_id: "notes" }, scopePath: "notes" } });
    expect(scoped.dataPort.getCachedChildren!(null)).toBeUndefined();
    expect((await scoped.dataPort.listChildren(null))[0]?.name).toBe("a.md");
    const signedInAgain = service({ session: { ...session, session_generation: "two" } });
    expect(signedInAgain.dataPort.getCachedChildren!(null)).toBeUndefined();
    await signedInAgain.dataPort.listChildren(null);
    expect(count("ls")).toBe(3);
  });

  it("keeps a replacement provider's shared read alive after the first UI lease is revoked", async () => {
    let current = true;
    let finish!: (value: unknown) => void;
    bridge.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const retired = service({ isCurrent: () => current }).dataPort.readFile!("readme.md");
    const mounted = service().dataPort.readFile!("readme.md");
    const rejected = expect(retired).rejects.toThrow(/session changed/);
    current = false;
    finish({ path: "readme.md", type: "markdown", content_text: "Cloud original", ...nativeSnapshot("head-1") });
    await rejected;
    expect(await mounted).toMatchObject({ content: "Cloud original", version: nativeVersion("head-1") });
    expect(count("cat")).toBe(1);
  });

  it("clears stale directory snapshots when access is revoked", async () => {
    const cloud = service();
    await cloud.dataPort.listChildren(null);
    bridge.mockRejectedValue(error(403));
    await expect(cloud.dataPort.readFile!("readme.md")).rejects.toMatchObject({ status: 403 });
    expect(cloud.dataPort.getCachedChildren!(null)).toBeUndefined();
  });

  it("reads unknown text through stat then cat, and binary metadata without cat", async () => {
    files.set("opaque-source", "plain text"); mimeTypes.set("opaque-source", "text/plain");
    const cloud = service();
    expect(await cloud.dataPort.readFile!("opaque-source")).toMatchObject({ content: "plain text" });
    expect(bridge.mock.calls.map(([r]) => new URL(r.path, API).pathname.split("/").at(-1))).toEqual(["stat", "cat"]);
    bridge.mockClear();
    expect(await cloud.dataPort.readFile!("movie.mp4")).toMatchObject({ content: null });
    expect(count("stat")).toBe(1); expect(count("cat")).toBe(0); expect(count("ls")).toBe(0);
  });

  it("accepts a coherent pinned response even when another writer commits during the read", async () => {
    bridge.mockImplementation(async () => {
      revision++;
      return { path: "readme.md", type: "markdown", content_text: "Captured bytes", ...nativeSnapshot("head-1") };
    });
    expect(await service().dataPort.readFile!("readme.md")).toMatchObject({ content: "Captured bytes", version: nativeVersion("head-1") });
    expect(count("cat")).toBe(1); expect(count("ls")).toBe(0);
  });
});

describe("Cloud HTML projection ownership", () => {
  const projectionBridge = () => {
    const create = vi.fn(async () => ({ url: "puppyone-preview://document/fixture/index.html" }));
    const revoke = vi.fn(async () => ({ revoked: true }));
    const revokeResource = vi.fn(async (_request: { url: string }) => undefined);
    Object.assign(window.puppyoneDesktop!, { createSandboxedPreviewDocument: create,
      revokeSandboxedPreviewDocument: revoke, revokeCloudPreviewResource: revokeResource });
    return { create, revoke, revokeResource };
  };
  it("releases document and signed assets together, once", async () => {
    const { revoke, revokeResource } = projectionBridge();
    const projection = await service().dataPort.previewServices!.documentProjection!.create(
      "index.html", '<img src="picture.png"><img src="picture.png">', new AbortController().signal,
    );
    await projection.close(); await projection.close();
    expect(revoke).toHaveBeenCalledOnce();
    expect(revokeResource).toHaveBeenCalledOnce();
    expect(revokeResource.mock.calls[0][0]).toMatchObject({ url: expect.stringContaining('path=picture.png') });
  });
  it("releases a late signature after a sibling stylesheet fails", async () => {
    const { create, revokeResource } = projectionBridge();
    let release!: (value: { url: string }) => void;
    const retain = vi.fn(() => new Promise<{ url: string }>((resolve) => { release = resolve; }));
    Object.assign(window.puppyoneDesktop!, { retainCloudPreviewResource: retain });
    const result = service().dataPort.previewServices!.documentProjection!.create("index.html",
      '<img src="picture.png"><link rel="stylesheet" href="missing.css">', new AbortController().signal);
    await expect(result).rejects.toThrow();
    release({ url: API + '/content/project/inline?path=picture.png&token=fixture' });
    await vi.waitFor(() => expect(revokeResource).toHaveBeenCalledOnce());
    expect(create).not.toHaveBeenCalled();
  });
});

// Explicit acceptance families keep the provider contract independent of the
// implementation's legacy text/category heuristic. A new family must declare
// what it needs before this inventory can pass.
const SOURCE_REQUIREMENTS: Record<string, string> = {
  "context-map-viewer": "content", "puppyflow-editor": "content", "markdown-editor": "content",
  "monaco-code": "content", "plain-text": "content", "csv-table": "content", "app-preview": "content",
  "html-artifact": "content-and-resource", "image-preview": "resource", "audio-preview": "resource",
  "video-preview": "resource", "pdf-preview": "resource", "office-preview": "resource",
  "database-preview": "resource-session", "binary-placeholder": "none",
};

describe("complete Cloud format input acceptance", () => {
  it.each(FILE_FORMATS)("$id preserves every registered name and supplies the declared editor input", async (format) => {
    // Existing semantic media fallback also tries the browser decoder for
    // recognized legacy containers; that is routing, not codec acceptance.
    const semanticMedia = format.defaultViewer === "binary-placeholder"
      && ["image", "audio", "video"].includes(format.category);
    const expected = semanticMedia ? "resource" : SOURCE_REQUIREMENTS[format.defaultViewer];
    expect(expected, `Declare acceptance for ${format.defaultViewer}`).toBeDefined();
    const names = [...(format.extensions ?? []).map((extension) => `sample${extension}`),
      ...(format.filenames ?? []), ...(format.filenamePatterns ?? []).map((pattern) => pattern
        .replaceAll("**/", "scope/").replaceAll("**", "scope").replaceAll("*", "fixture").replaceAll("?", "x"))];
    if (!names.length) names.push(`sample-${format.id}`);
    const cloud = service();
    for (const name of new Set(names)) {
      files.set(name, '{"cloud":"registered-source"}');
      if (format.mimeTypes?.[0]) mimeTypes.set(name, format.mimeTypes[0]);
      const path = createWorkspaceResourceUri(cloud.folder.uri, name);
      const node = (await cloud.dataPort.resolveNode!(path))!;
      if (!isDocumentDataNode(node)) throw new Error("Expected a format document.");
      expect(getEditorSourceRequirement(node), name).toBe(expected);
      const local = { ...node, path: name, source: "local" as const };
      expect(resolveEditorViewer({ ...node, sourceKind: "cloud" }).viewer.id, name)
        .toBe(resolveEditorViewer({ ...local, sourceKind: "local" }).viewer.id);
      const content = await cloud.dataPort.readFile!(path);
      if (expected === "content" || expected === "content-and-resource") {
        expect(content.content, name).toBe('{"cloud":"registered-source"}');
        const result = await save(cloud.dataPort, path, '{"cloud":"saved"}', content.version!);
        expect(result, name).toMatchObject({ ok: true });
        expect(files.get(name)).toBe('{"cloud":"saved"}');
        if (expected === "content-and-resource") {
          const url = await cloud.dataPort.getFileUrl!(path, { expectedVersion: content.version! });
          expect(url).toMatch(/^blob:/);
          await cloud.dataPort.revokeFileUrl!(url);
        }
      } else {
        expect(content.content, name).toBeNull();
        if (expected === "resource") {
          const url = new URL(await cloud.dataPort.getFileUrl!(path));
          expect(url.origin).toBe(new URL(API).origin);
          expect(url.searchParams.get("path")).toBe(name);
          expect(url.searchParams.get("token")).toBe("fixture-token");
        }
      }
    }
  });
});

describe("native Cloud provider", () => {
  it("moves an observed directory with one atomic command and no root listing or per-file calls", async () => {
    const cloud = service();
    bridge.mockResolvedValueOnce({ entries: [{ path: "notes", name: "notes", type: "folder", children_count: 1000 }], ...nativeSnapshot("head-1") });
    await cloud.dataPort.listChildren(null);
    bridge.mockClear();
    await cloud.dataPort.moveNode!("notes", "archive/notes");
    expect(bridge).toHaveBeenCalledOnce();
    const request = bridge.mock.calls[0][0];
    expect(request.path).toBe("/content/project/mv");
    expect(JSON.parse(request.body)).toMatchObject({ old_path: "notes", new_path: "archive/notes", no_clobber: true,
      native: { repository_revision: nativeSnapshot("head-1").repository_revision, request_key: expect.stringMatching(/^[\da-f-]{36}$/) } });
    expect(revision).toBe(2);
  });

  it("reuses the exact operation UUID and input after a committed response is lost", async () => {
    const actual = bridge.getMockImplementation()! as (request: unknown) => Promise<unknown>;
    const receipts = new Map<string, unknown>();
    const cloud = service();
    await cloud.dataPort.readFile!("readme.md");
    bridge.mockClear();
    bridge.mockImplementation(async (request) => {
      const key = JSON.parse(request.body).native.request_key;
      if (receipts.has(key)) return receipts.get(key);
      const receipt = await actual(request); receipts.set(key, receipt);
      throw error(503);
    });
    expect(await save(cloud.dataPort, "readme.md", "Once", nativeVersion("head-1"))).toMatchObject({ ok: true });
    expect(bridge).toHaveBeenCalledTimes(2);
    expect(bridge.mock.calls[0][0].body).toBe(bridge.mock.calls[1][0].body);
    expect(revision).toBe(2); expect(files.get("readme.md")).toBe("Once");
  });

  it("keeps an unconfirmed operation identity for an explicit retry in the same provider", async () => {
    const actual = bridge.getMockImplementation()! as (request: unknown) => Promise<unknown>;
    const cloud = service(); await cloud.dataPort.readFile!("readme.md"); bridge.mockClear();
    bridge.mockRejectedValue(error(503));
    expect(await save(cloud.dataPort, "readme.md", "Retry", nativeVersion("head-1"))).toMatchObject({ ok: false, kind: "io" });
    const originalBody = bridge.mock.calls[0][0].body;
    bridge.mockImplementation(actual);
    expect(await save(cloud.dataPort, "readme.md", "Retry", nativeVersion("head-1"))).toMatchObject({ ok: true });
    expect(bridge.mock.calls[2][0].body).toBe(originalBody);
  });

  it("does not rebase an edit onto a different branch even when the file bytes match", async () => {
    const cloud = service(); await cloud.dataPort.readFile!("readme.md");
    const actual = bridge.getMockImplementation()! as (request: unknown) => Promise<unknown>;
    bridge.mockClear();
    bridge.mockImplementation(async (request) => {
      if (request.method === "POST") throw error(409);
      const result = await actual(request) as ReturnType<typeof nativeSnapshot>;
      const ref = btoa("refs/heads/another");
      return { ...result, repository_revision: { ...result.repository_revision, target_ref_b64: ref,
        head_guard: { kind: "symbolic", target_b64: ref } } };
    });
    expect(await save(cloud.dataPort, "readme.md", "My edit", nativeVersion("head-1"))).toMatchObject({ ok: false, kind: "conflict" });
    expect(bridge.mock.calls.filter(([r]) => r.method === "POST")).toHaveLength(1);
  });

  it("rejects a transaction receipt belonging to another project", async () => {
    const cloud = service(); await cloud.dataPort.readFile!("readme.md"); bridge.mockClear();
    bridge.mockResolvedValue({ path: "readme.md", ...nativeReceipt("head-2", "another") });
    expect(await save(cloud.dataPort, "readme.md", "My edit", nativeVersion("head-1"))).toMatchObject({ ok: false, kind: "io" });
    expect(bridge).toHaveBeenCalledOnce();
  });

  it("creates the first file and folder with the existing empty-repository CAS contract", async () => {
    bridge.mockImplementation(async (request) => {
      if (request.method === "GET") return { entries: [], ...nativeSnapshot("") };
      expect(JSON.parse(request.body).native.repository_revision).toBeDefined();
      return { path: JSON.parse(request.body).path, ...nativeReceipt("first-head") };
    });
    const cloud = service();
    await cloud.dataPort.createFile!("first.md", "First file");
    await cloud.dataPort.createFolder!("empty-folder");
    expect(bridge.mock.calls.filter(([request]) => request.method === "POST")).toHaveLength(2);
  });

  it("uses Cloud URIs and secure host transport for the tree, source and save target", async () => {
    const cloud = service();
    const nodes = await cloud.dataPort.listChildren(null);
    const node = nodes.find((item) => item.name === "readme.md")!;
    expect(node.source).toBe("cloud");
    expect(node.path).toBe(createWorkspaceResourceUri(cloud.folder.uri, "readme.md"));
    expect(node.path).not.toContain("puppyone-local:");
    expect(await cloud.dataPort.readFile!(node.path)).toMatchObject({ content: "Cloud original", version: nativeVersion("head-1"), path: node.path });
    expect(await save(cloud.dataPort, node.path, "Cloud edit", nativeVersion("head-1"))).toEqual({ ok: true, version: nativeVersion("head-2") });
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
    bridge.mockResolvedValueOnce({ entries: [entry("secret.md")], ...nativeSnapshot("head-1") });
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
    expect(await save(cloud.dataPort, "readme.md", "My edit", nativeVersion("head-1"))).toEqual({ ok: false, kind: "conflict", content: "Someone else's Cloud edit", version: nativeVersion("head-2") });
    expect(files.get("readme.md")).toBe("Someone else's Cloud edit");
    expect(bridge.mock.calls.filter(([request]) => request.path.endsWith("/write"))).toHaveLength(1);
  });

  it("retries a project HEAD change only when the edited file's base bytes are unchanged", async () => {
    const cloud = service();
    await cloud.dataPort.readFile!("readme.md");
    files.set("data.json", '{"otherWriter":true}'); revision++;
    expect(await save(cloud.dataPort, "readme.md", "My edit", nativeVersion("head-1"))).toEqual({ ok: true, version: nativeVersion("head-3") });
    expect(files.get("data.json")).toBe('{"otherWriter":true}');
    expect(bridge.mock.calls.filter(([request]) => request.path.endsWith("/write")).map(([request]) => JSON.parse(request.body).base_commit_id)).toEqual(["head-1", "head-2"]);
  });

  it("serializes writes from two editors without mistaking another file's save for a conflict", async () => {
    const cloud = service();
    await Promise.all([cloud.dataPort.readFile!("readme.md"), cloud.dataPort.readFile!("data.json")]);
    const result = await Promise.all([save(cloud.dataPort, "readme.md", "One", nativeVersion("head-1")), save(cloud.dataPort, "data.json", "{}", nativeVersion("head-1"))]);
    expect(result.every((item) => item.ok)).toBe(true);
    expect(files.get("readme.md")).toBe("One"); expect(files.get("data.json")).toBe("{}");
  });

  it.each([null, ""])("never writes without a usable base revision (%s)", async (baseVersion) => {
    const cloud = service();
    expect(await save(cloud.dataPort, "readme.md", "Unknown edit", baseVersion)).toMatchObject({ ok: false, kind: "io" });
    expect(bridge).not.toHaveBeenCalled();
  });

  it("rejects a missing server revision before reading or creating a writable document", async () => {
    const actual = bridge.getMockImplementation()! as (request: unknown) => Promise<unknown>;
    bridge.mockImplementation(async (request) => {
      const response = await actual(request);
      return /\/(ls|cat)(\?|$)/.test(request.path)
        ? { ...(response as object), head_commit_id: null } : response;
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
    await expect(save(cloud.dataPort, "readme.md", "Stale edit", nativeVersion("head-1"))).rejects.toThrow(/session changed/);
    expect(files.get("readme.md")).toBe("Cloud original");
    expect(bridge.mock.calls.filter(([request]) => request.method === "POST")).toHaveLength(0);
  });

  it("discards a result that arrives after the authority changed", async () => {
    let current = true;
    bridge.mockImplementationOnce(async () => { current = false; return { entries: [entry("readme.md")], ...nativeSnapshot("head-1") }; });
    await expect(service({ isCurrent: () => current }).dataPort.listChildren(null)).rejects.toThrow(/session changed/);
  });

  it("keeps Cloud outages as Cloud errors instead of reading local files", async () => {
    bridge.mockRejectedValue(error(503));
    const localRead = vi.fn();
    Object.assign(window.puppyoneDesktop!, { readWorkspaceFile: localRead });
    await expect(service().dataPort.readFile!("readme.md")).rejects.toThrow(/503/);
    expect(localRead).not.toHaveBeenCalled();
  });

  it.each(["notes.md", "records.csv", "settings.json", "worker.ts", "page.html"])("reads and saves %s through Cloud CAS without local file access", async (path) => {
    files.set(path, "original");
    const cloud = service();
    const document = await cloud.dataPort.readFile!(createWorkspaceResourceUri(cloud.folder.uri, path));
    expect(document).toMatchObject({ content: "original", version: nativeVersion("head-1") });
    expect(await save(cloud.dataPort, document.path, "edited", document.version!)).toMatchObject({ ok: true, version: nativeVersion("head-2") });
    expect(files.get(path)).toBe("edited");
    expect(JSON.parse(bridge.mock.calls.find(([request]) => request.path.endsWith("/write"))![0].body))
      .toMatchObject({ path, content: "edited", base_commit_id: "head-1" });
  });

  it("supplies immutable HTML from the accepted snapshot and releases only its own blob URLs", async () => {
    files.set("page.html", "<h1>Original</h1>");
    const createUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:cloud-html");
    const revokeUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const cloud = service();
    await cloud.dataPort.readFile!("page.html");
    files.set("page.html", "<h1>New HEAD</h1>"); revision++;
    expect(await cloud.dataPort.getFileUrl!("page.html", { expectedVersion: nativeVersion("head-1") })).toBe("blob:cloud-html");
    expect(await (createUrl.mock.calls[0][0] as Blob).text()).toBe("<h1>Original</h1>");
    expect(bridge.mock.calls.some(([request]) => request.path.endsWith("/inline/sign"))).toBe(false);
    await cloud.dataPort.revokeFileUrl!("blob:foreign");
    await cloud.dataPort.revokeFileUrl!("blob:cloud-html");
    await cloud.dataPort.revokeFileUrl!("blob:cloud-html");
    expect(revokeUrl).toHaveBeenCalledExactlyOnceWith("blob:cloud-html");
    await expect(cloud.dataPort.getFileUrl!("page.html", { expectedVersion: "unknown" })).rejects.toThrow(/version/);
  });

  it("uses signed inline URLs for native binary previews without decoding the binary as text", async () => {
    const cloud = service();
    expect(await cloud.dataPort.readFile!("movie.mp4")).toMatchObject({ content: null, type: "video" });
    const url = new URL(await cloud.dataPort.getFileUrl!("movie.mp4"));
    expect(url.origin).toBe("https://cloud-fixture.puppyone.ai"); expect(url.searchParams.get("path")).toBe("movie.mp4");
    expect(bridge.mock.calls.some(([request]) => request.path.includes("/cat"))).toBe(false);
    await expect(cloud.dataPort.getFileUrl!("movie.mp4", { expectedVersion: nativeVersion("head-1") })).rejects.toThrow(/version/);
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
    expect(await save(cloud.dataPort, "notes.mdx", "after", nativeVersion("head-1"))).toMatchObject({ ok: true });
    const request = bridge.mock.calls.find(([item]) => item.path.endsWith("/write"))![0];
    expect(JSON.parse(request.body).node_type).toBe("file");
  });

  it("rejects a response whose commit and pinned revision disagree", async () => {
    bridge.mockResolvedValue({ path: "readme.md", type: "markdown", content_text: "bytes",
      ...nativeSnapshot("head-1"), head_commit_id: "head-2" });
    await expect(service().dataPort.readFile!("readme.md")).rejects.toThrow(/inconsistent storage revision/);
    expect(bridge).toHaveBeenCalledTimes(1);
  });

  it("does not overwrite a file created after the directory snapshot", async () => {
    const actual = bridge.getMockImplementation()! as (request: unknown) => Promise<unknown>;
    bridge.mockImplementation(async (request) => {
      const response = await actual(request);
      if (request.path.includes("/ls")) { files.set("new.md", "Other creator"); revision++; }
      return response;
    });
    await expect(service().dataPort.createFile!("new.md", "My new file")).rejects.toMatchObject({ status: 409 });
    expect(files.get("new.md")).toBe("Other creator");
    expect(bridge.mock.calls.filter(([request]) => request.path.includes("/ls"))).toHaveLength(1);
  });

  it("allows a restored baseline only through CAS and never retries it without the original bytes", async () => {
    expect(await save(service().dataPort, "readme.md", "Restored draft", nativeVersion("head-1"))).toMatchObject({ ok: true });
    const restored = service();
    files.set("readme.md", "New writer"); revision++;
    expect(await save(restored.dataPort, "readme.md", "Older draft", nativeVersion("head-1"))).toMatchObject({ ok: false, kind: "conflict", content: "New writer" });
    expect(files.get("readme.md")).toBe("New writer");
  });

  it("does not load an aborted editor input", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(service().dataPort.readFile!("readme.md", { signal: controller.signal })).rejects.toThrow();
    expect(bridge).not.toHaveBeenCalled();
  });
});
