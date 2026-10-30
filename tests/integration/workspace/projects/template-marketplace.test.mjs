import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseTemplatePackage, validateDownloadDescriptor } from "../../../../local-api/templates/package.mjs";
import { createTemplateMarketplaceService } from "../../../../electron/main/template-marketplace-service.mjs";
import { createProjectInitializationService } from "../../../../electron/main/project-initialization-service.mjs";
import { materializeTemplate } from "../../../../local-api/templates/materialize.mjs";
import { looksLikeTemplateLink, parseTemplateLink, resolveTemplateStoreOrigin } from "../../../../shared/desktop/template-link.mjs";

const { fixtures } = JSON.parse(await fs.readFile(new URL("../../../fixtures/workspace/projects/marketplace-packages.json", import.meta.url), "utf8"));
const first = fixtures[0];
const descriptor = first.descriptor;
const source = { kind: "template", ref: { sourceId: "marketplace", id: descriptor.template_id, releaseId: descriptor.release_id } };
const origin = "https://www.puppyone.ai";
let root;
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-marketplace-")); });
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

const packagePath = `/api/templates/${descriptor.template_id}/package?release=${descriptor.release_id}`;
const publicDescriptor = { ...descriptor, delivery: "github", download_url: packagePath };
const signInRequired = () => Response.json({ error: { code: "AUTH_REQUIRED" } }, { status: 401 });
function serviceFixture(extra = {}, store = signInRequired) {
  let session = { status: "authenticated", user_id: "template-user", session_generation: "session-1" };
  const fetchImpl = vi.fn(async (_url, init) => init?.method === "POST" ? store() : new Response(Buffer.from(first.zip, "base64")));
  const cloudAuthService = {
    readSession: async () => session,
    requestTemplateDownload: vi.fn(async () => structuredClone(descriptor)),
    ...extra,
  };
  const service = createTemplateMarketplaceService({ origin, channel: "stable", fetchImpl, cloudAuthService });
  return { service, fetchImpl, cloudAuthService, setSession: next => { session = next; } };
}

describe("published template interoperability", () => {
  it.each(fixtures)("imports the website publisher's $descriptor.locale $descriptor.template_id package", async fixture => {
    const ref = { id: fixture.descriptor.template_id, releaseId: fixture.descriptor.release_id };
    const value = validateDownloadDescriptor(fixture.descriptor, ref);
    const plan = await parseTemplatePackage(Buffer.from(fixture.zip, "base64"), value);
    await materializeTemplate({ parentPath: root, name: "Project", plan });
    const readme = await fs.readFile(path.join(root, "Project", plan.initialOpenPath), "utf8");
    expect(readme.length).toBeGreaterThan(100);
    expect(plan.files).toHaveLength(value.file_count);
    expect(plan.template).toMatchObject({ sourceId: "marketplace", releaseId: ref.releaseId });
    expect(await fs.readdir(root)).toEqual(["Project"]);
  });

  it("rejects traversing paths, extra root entries and symlink entries even with a matching ZIP digest", async () => {
    const original = Buffer.from(first.zip, "base64");
    const renamed = (from, to) => {
      const bytes = Buffer.from(original);
      expect(Buffer.byteLength(from)).toBe(Buffer.byteLength(to));
      for (let offset = bytes.indexOf(from); offset !== -1; offset = bytes.indexOf(from, offset + from.length)) bytes.write(to, offset);
      return bytes;
    };
    const symlink = Buffer.from(original);
    const directory = symlink.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    symlink.writeUInt32LE((0o120777 << 16) >>> 0, directory + 38);
    for (const bytes of [renamed("content/README.md", "content/../bad.md"), renamed("manifest.json", "external.json"), symlink]) {
      const checked = { ...descriptor, bundle_sha256: createHash("sha256").update(bytes).digest("hex") };
      await expect(parseTemplatePackage(bytes, checked)).rejects.toThrow();
    }
    expect(await fs.readdir(root)).toEqual([]);
  });

  it("rejects corruption, wrong release identity, expired descriptors and incorrect file hashes", async () => {
    const bytes = Buffer.from(first.zip, "base64");
    const corrupted = Buffer.from(bytes); corrupted[80] ^= 1;
    await expect(parseTemplatePackage(corrupted, descriptor)).rejects.toThrow(/verification/);
    await expect(parseTemplatePackage(bytes, { ...descriptor, content_sha256: "0".repeat(64) })).rejects.toThrow(/verification/);
    await expect(parseTemplatePackage(bytes, { ...descriptor, file_count: 1 })).rejects.toThrow(/verification/);
    await expect(parseTemplatePackage(bytes, { ...descriptor, release_id: randomUUID() })).rejects.toThrow(/verification/);
    expect(() => validateDownloadDescriptor({ ...descriptor, expires_at: "2000-01-01" }, { id: descriptor.template_id, releaseId: descriptor.release_id })).toThrow();
    expect(await fs.readdir(root)).toEqual([]);
  });
});

describe("Main-owned downloads and publication", () => {
  it("downloads without forwarding the session token and creates exactly once", async () => {
    const { service, fetchImpl, cloudAuthService } = serviceFixture();
    const initializer = createProjectInitializationService({ journalDirectory: path.join(root, "receipts"), resolveTemplate: service.resolveTemplate, validateSource: service.validateSource });
    const request = { parentPath: root, name: "CRM", source, locale: "en", operationId: randomUUID() };
    const receipt = await initializer.initialize(request);
    expect(cloudAuthService.requestTemplateDownload).toHaveBeenCalledWith({ id: descriptor.template_id, releaseId: descriptor.release_id });
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ method: "POST", redirect: "error" });
    expect(JSON.stringify(fetchImpl.mock.calls[0][1].headers)).not.toMatch(/authorization/i);
    expect(fetchImpl.mock.calls[1][1]).toMatchObject({ redirect: "error" });
    expect(fetchImpl.mock.calls[1][1].headers).toBeUndefined();
    const readmePath = path.join(receipt.path, receipt.initialOpenPath);
    await fs.writeFile(readmePath, "user edits");
    expect(await initializer.initialize(request)).toEqual(receipt);
    expect(await fs.readFile(readmePath, "utf8")).toBe("user edits");
    await expect(initializer.initialize({ ...request, operationId: randomUUID() })).rejects.toThrow();
    expect(await fs.readFile(readmePath, "utf8")).toBe("user edits");
  });

  it("rejects unauthenticated downloads and arbitrary download hosts before any writes", async () => {
    const { service, setSession, fetchImpl } = serviceFixture();
    setSession(null);
    await expect(service.resolveTemplate(source, "en")).rejects.toThrow(/Sign in/);
    expect(fetchImpl).toHaveBeenCalledOnce(); // Asked the store; downloaded nothing.
    const bad = serviceFixture({ requestTemplateDownload: async () => ({ ...descriptor, download_url: "https://example.com/stolen" }) });
    await expect(bad.service.resolveTemplate(source, "en")).rejects.toThrow(/destination/);
    expect(bad.fetchImpl).toHaveBeenCalledOnce();
    expect(await fs.readdir(root)).toEqual([]);
  });

  it("creates a public template with no account and survives a change of account", async () => {
    const { service, fetchImpl, cloudAuthService, setSession } = serviceFixture({}, () => Response.json(publicDescriptor));
    setSession(null);
    const initializer = createProjectInitializationService({
      resolveTemplate: service.resolveTemplate, validateSource: service.validateSource,
      materialize: async args => {
        setSession({ status: "authenticated", user_id: "someone-else", session_generation: "session-2" });
        return materializeTemplate(args);
      },
    });
    const receipt = await initializer.initialize({ parentPath: root, name: "CRM", source, locale: "en" });
    expect(await fs.readFile(path.join(receipt.path, receipt.initialOpenPath), "utf8")).not.toBe("");
    expect(cloudAuthService.requestTemplateDownload).not.toHaveBeenCalled();
    expect(fetchImpl.mock.calls[0][0]).toBe(`${origin}/api/templates/${descriptor.template_id}/download`);
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ release_id: descriptor.release_id });
    expect(JSON.stringify(fetchImpl.mock.calls[0][1].headers)).not.toMatch(/authorization/i);
    expect(fetchImpl.mock.calls[1][0]).toBe(`${origin}${packagePath}`);
  });

  it("accepts the store's package address only for this template", async () => {
    const destinations = [
      `/api/templates/${randomUUID()}/package?release=${descriptor.release_id}`,
      "/api/template-packages?key=packages/x",
      "/somewhere-else",
      `https://user:secret@www.puppyone.ai${packagePath}`,
      `http://www.puppyone.ai${packagePath}`,
      `https://www.puppyone.ai.example.com${packagePath}`,
    ];
    for (const download_url of destinations) {
      const { service, fetchImpl } = serviceFixture({}, () => Response.json({ ...publicDescriptor, download_url }));
      await expect(service.resolveTemplate(source, "en")).rejects.toThrow(/destination/);
      expect(fetchImpl).toHaveBeenCalledOnce();
    }
    expect(await fs.readdir(root)).toEqual([]);
  });

  it("describes a template for the card and says when it needs an account", async () => {
    const detail = { id: descriptor.template_id, release_id: descriptor.release_id, name: "CRM", description: "Customers", version: "1.0.0", author: "Puppyone", locale: "en", file_count: 12, icon: "🤝", delivery: "github" };
    const link = `https://www.puppyone.ai/t/${descriptor.template_id}`;
    const open = async (values) => createTemplateMarketplaceService({ origin, channel: "stable", cloudAuthService: {}, fetchImpl: vi.fn(async () => Response.json({ ...detail, ...values })) }).resolveLink(link, "en");
    expect(await open({})).toMatchObject({ fileCount: 12, icon: "🤝", requiresSignIn: false });
    expect(await open({ delivery: "managed", file_count: "12", icon: null })).toMatchObject({ fileCount: null, icon: null, requiresSignIn: true });
  });

  it("recognizes pasted template links without judging them", () => {
    const id = descriptor.template_id;
    for (const value of [`https://www.puppyone.ai/t/${id}`, `  https://www.puppyone.ai/t/${id}?release=${descriptor.release_id}\n`,
      `http://127.0.0.1:3035/t/${id}`, `puppyone://templates/import?id=${id}&release=${descriptor.release_id}`]) expect(looksLikeTemplateLink(value)).toBe(true);
    for (const value of ["", "hello", "https://www.puppyone.ai/templates", "sk-secret https://www.puppyone.ai/t/x", `see https://www.puppyone.ai/t/${id}`, null, "x".repeat(3000)]) expect(looksLikeTemplateLink(value)).toBe(false);
  });

  it("cancels publication when the user changes account during materialization", async () => {
    const { service, setSession } = serviceFixture();
    const initializer = createProjectInitializationService({
      resolveTemplate: service.resolveTemplate, validateSource: service.validateSource,
      materialize: async args => {
        setSession({ status: "authenticated", user_id: "different-user", session_generation: "session-2" });
        return materializeTemplate(args);
      },
    });
    await expect(initializer.initialize({ parentPath: root, name: "CRM", source, locale: "en" })).rejects.toThrow(/Sign in/);
    expect(await fs.readdir(root)).toEqual([]);
  });

  it("pins the preview's selected release when the latest version changes", async () => {
    const fetchImpl = vi.fn(async url => {
      expect(new URL(url).searchParams.get("release")).toBe(descriptor.release_id);
      return Response.json({ id: descriptor.template_id, release_id: descriptor.release_id, name: "CRM", description: "Customers", version: "1.0.0", author: "Puppyone", locale: "zh" });
    });
    const service = createTemplateMarketplaceService({ origin, channel: "stable", fetchImpl, cloudAuthService: {} });
    expect(await service.resolveLink(`${origin}/t/${descriptor.template_id}?release=${descriptor.release_id}`, "zh-Hans")).toMatchObject({ releaseId: descriptor.release_id });
    expect(new URL(fetchImpl.mock.calls[0][0]).searchParams.get("locale")).toBe("zh");
  });
});

describe("template links", () => {
  it("accepts official pinned links and the current channel only", () => {
    expect(parseTemplateLink(`${origin}/t/${descriptor.template_id}?release=${descriptor.release_id}`)).toEqual({ id: descriptor.template_id, releaseId: descriptor.release_id });
    expect(parseTemplateLink(`puppyone://templates/import?id=${descriptor.template_id}`)).toEqual({ id: descriptor.template_id, releaseId: null });
    for (const link of [
      `https://evil.example/t/${descriptor.template_id}`, `https://github.com/user/repo`,
      `${origin}/t/${descriptor.template_id}?release=${descriptor.release_id}&release=${descriptor.release_id}`,
      `puppyone-development://templates/import?id=${descriptor.template_id}`, `${origin}/t/${descriptor.template_id}#code`,
    ]) expect(() => parseTemplateLink(link)).toThrow();
    expect(resolveTemplateStoreOrigin({ isPackaged: true, override: "https://evil.example" })).toBe(origin);
    expect(() => resolveTemplateStoreOrigin({ isPackaged: false, override: "https://evil.example" })).toThrow();
  });
});
