import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseTemplatePackage, validateDownloadDescriptor } from "../../../../local-api/templates/package.mjs";
import { createTemplateMarketplaceService } from "../../../../electron/main/template-marketplace-service.mjs";
import { createProjectInitializationService } from "../../../../electron/main/project-initialization-service.mjs";
import { materializeTemplate } from "../../../../local-api/templates/materialize.mjs";
import { parseTemplateLink, resolveTemplateStoreOrigin } from "../../../../shared/desktop/template-link.mjs";

const { fixtures } = JSON.parse(await fs.readFile(new URL("../../../fixtures/workspace/projects/marketplace-packages.json", import.meta.url), "utf8"));
const first = fixtures[0];
const descriptor = first.descriptor;
const source = { kind: "template", ref: { sourceId: "marketplace", id: descriptor.template_id, releaseId: descriptor.release_id } };
const origin = "https://www.puppyone.ai";
let root;
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-marketplace-")); });
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

function serviceFixture(extra = {}) {
  let session = { status: "authenticated", user_id: "template-user", session_generation: "session-1" };
  const fetchImpl = vi.fn(async () => new Response(Buffer.from(first.zip, "base64")));
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
      const bytes = Buffer.from(original); let offset = 0;
      expect(Buffer.byteLength(from)).toBe(Buffer.byteLength(to));
      while ((offset = bytes.indexOf(from, offset)) !== -1) { bytes.write(to, offset); offset += from.length; }
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
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ redirect: "error" });
    expect(fetchImpl.mock.calls[0][1].headers).toBeUndefined();
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
    expect(fetchImpl).not.toHaveBeenCalled();
    const bad = serviceFixture({ requestTemplateDownload: async () => ({ ...descriptor, download_url: "https://example.com/stolen" }) });
    await expect(bad.service.resolveTemplate(source, "en")).rejects.toThrow(/destination/);
    expect(bad.fetchImpl).not.toHaveBeenCalled();
    expect(await fs.readdir(root)).toEqual([]);
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
