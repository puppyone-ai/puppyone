import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createProjectInitializationService } from "../../../../electron/main/project-initialization-service.mjs";
import { materializeTemplate, validateTemplatePlan } from "../../../../local-api/templates/materialize.mjs";
import { publishDirectory } from "../../../../local-api/templates/publish-directory.mjs";
import { resolveProjectTemplate } from "../../../../local-api/templates/project-catalog.mjs";

let root, parentPath, journalDirectory;
const source = { kind: "template", ref: { sourceId: "builtin", id: "puppyone.project.getting-started", version: 1 } };
const request = (extra = {}) => ({ parentPath, name: "Notes", operationId: randomUUID(), source, locale: "en", ...extra });
const guide = { files: [{ path: "Getting Started.md", content: "hello" }], initialOpenPath: "Getting Started.md" };

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-initialization-"));
  parentPath = path.join(root, "projects");
  journalDirectory = path.join(root, "operations");
  await fs.mkdir(parentPath);
});
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

describe("shared template materializer", () => {
  it.each(["../outside", "/absolute", "a\\b", "a/../b", "a//b", "a:", "NUL.txt", "a.\u0020", "a/CON", "a\0b"])("rejects unsafe output %s", async (filePath) => {
    await expect(materializeTemplate({ parentPath, name: "Notes", plan: { files: [{ path: filePath, content: "no" }] } })).rejects.toThrow(/invalid/i);
    expect(await fs.readdir(parentPath)).toEqual([]);
  });

  it("rejects collisions, invalid entrypoints and over-budget plans before writes", () => {
    for (const files of [
      [{ path: "A.md", content: "a" }, { path: "a.md", content: "b" }],
      [{ path: "a", content: "a" }, { path: "a/b", content: "b" }],
      [{ path: "é.md", content: "a" }, { path: "e\u0301.md", content: "b" }],
      [{ path: "A/b", content: "a" }, { path: "a/c", content: "b" }],
    ]) expect(() => validateTemplatePlan({ files })).toThrow(/conflict/i);
    expect(() => validateTemplatePlan({ ...guide, initialOpenPath: "https://example.com" })).toThrow(/opening document/i);
    expect(() => validateTemplatePlan({ files: Array(257).fill(guide.files[0]) })).toThrow(/count/i);
    expect(() => validateTemplatePlan({ files: [{ path: "big", content: Buffer.alloc(32 * 1024 * 1024 + 1) }] })).toThrow(/budget/i);
    expect(() => validateTemplatePlan({ files: [{ path: "a", content: { script: "run" } }] })).toThrow(/content/i);
  });

  it("does not replace even an empty directory created by another process before publication", async () => {
    await expect(materializeTemplate({ parentPath, name: "Notes", plan: guide }, {
      publish: async (staging, target) => {
        await expect(fs.access(target)).rejects.toMatchObject({ code: "ENOENT" });
        expect(await fs.readFile(path.join(staging, "Getting Started.md"), "utf8")).toBe("hello");
        await fs.mkdir(target);
        await publishDirectory(staging, target);
      },
    })).rejects.toMatchObject({ code: "EEXIST" });
    expect(await fs.readdir(path.join(parentPath, "Notes"))).toEqual([]);
    expect(await fs.readdir(parentPath)).toEqual(["Notes"]);
  });

  it("cleans only its staging after a write failure and never publishes a partial project", async () => {
    await fs.writeFile(path.join(parentPath, "keep.txt"), "keep");
    let writes = 0;
    await expect(materializeTemplate({ parentPath, name: "Notes", plan: { files: [{ path: "a", content: "a" }, { path: "b", content: "b" }] } }, {
      io: { ...fs, writeFile: async (...args) => { if (++writes === 2) throw new Error("disk full"); return fs.writeFile(...args); } },
    })).rejects.toThrow("disk full");
    expect(await fs.readdir(parentPath)).toEqual(["keep.txt"]);
    expect(await fs.readFile(path.join(parentPath, "keep.txt"), "utf8")).toBe("keep");
  });

  it("fails closed when the publisher cannot provide no-replace semantics", async () => {
    await expect(materializeTemplate({ parentPath, name: "Notes", plan: guide }, {
      publish: async () => { throw new Error("unsupported filesystem"); },
    })).rejects.toThrow("unsupported filesystem");
    expect(await fs.readdir(parentPath)).toEqual([]);
  });
});

describe("project initialization receipts", () => {
  it("creates an ordinary localized guide and a separately selectable true blank folder", async () => {
    const service = createProjectInitializationService({ journalDirectory });
    const receipt = await service.initialize(request({ locale: "zh-Hans" }));
    expect(receipt).toMatchObject({ outcome: "committed", initialOpenPath: "Getting Started.md", createdPaths: ["Getting Started.md"], template: { version: 1, resolvedLocale: "zh-Hans" } });
    expect(receipt.template.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(await fs.readFile(path.join(receipt.path, receipt.initialOpenPath), "utf8")).toContain("云端模型");
    expect(await fs.readdir(receipt.path)).toEqual(["Getting Started.md"]);
    const blank = await service.initialize(request({ name: "Blank", source: { kind: "blank" } }));
    expect(blank.initialOpenPath).toBeNull();
    expect(blank.template).toBeNull();
    expect(await fs.readdir(blank.path)).toEqual([]);
  });

  it("resolves every renderer locale and falls back only for unsupported locales", async () => {
    const supportedLocales = ["de", "en", "es", "fr", "ja", "ko", "pt-BR", "zh-Hans"];
    const english = (await resolveProjectTemplate(source, "en")).files[0].content.toString();
    for (const locale of supportedLocales) {
      const plan = await resolveProjectTemplate(source, locale);
      expect(plan.template.resolvedLocale).toBe(locale);
      expect(plan.files).toHaveLength(1);
      expect(plan.files[0].path).toBe("Getting Started.md");
      if (locale !== "en") expect(plan.files[0].content.toString()).not.toBe(english);
    }
    expect((await resolveProjectTemplate(source, "it")).template.resolvedLocale).toBe("en");
    for (const ref of [{ ...source.ref, version: 2 }, { ...source.ref, sourceId: "remote" }, { ...source.ref, id: "slides.default" }]) {
      await expect(resolveProjectTemplate({ kind: "template", ref }, "en")).rejects.toThrow(/unsupported/i);
    }
  });

  it("coalesces retries and never rewrites an edited or deleted guide, including after restart", async () => {
    const service = createProjectInitializationService({ journalDirectory });
    const input = request();
    const [one, two] = await Promise.all([service.initialize(input), service.initialize(input)]);
    expect(two).toEqual(one);
    const file = path.join(one.path, one.initialOpenPath);
    await fs.writeFile(file, "my edits");
    await expect(service.initialize(input)).resolves.toEqual(one);
    expect(await fs.readFile(file, "utf8")).toBe("my edits");
    await fs.unlink(file);
    await expect(createProjectInitializationService({ journalDirectory }).initialize(input)).resolves.toEqual(one);
    expect(await fs.readdir(one.path)).toEqual([]);
    await expect(service.initialize({ ...input, name: "Another" })).rejects.toThrow(/different request/i);
  });

  it.each(["published", "staged"])("recovers a %s directory with a lost acknowledgement by identity", async (state) => {
    const input = request();
    const receipt = await createProjectInitializationService({ journalDirectory }).initialize(input);
    const journalPath = path.join(journalDirectory, `${input.operationId}.json`);
    const record = JSON.parse(await fs.readFile(journalPath, "utf8"));
    record.state = "publishing";
    if (state === "staged") await fs.rename(receipt.path, record.stagingPath);
    await fs.writeFile(journalPath, JSON.stringify(record));
    await expect(createProjectInitializationService({ journalDirectory }).initialize(input)).resolves.toEqual(receipt);
    expect(await fs.readdir(parentPath)).toEqual(["Notes"]);
    expect(await fs.readdir(receipt.path)).toEqual(["Getting Started.md"]);
  });

  it("fails safely on ambiguous recovery without modifying the replacement directory", async () => {
    const input = request();
    const receipt = await createProjectInitializationService({ journalDirectory }).initialize(input);
    const journalPath = path.join(journalDirectory, `${input.operationId}.json`);
    const record = JSON.parse(await fs.readFile(journalPath, "utf8"));
    record.state = "publishing";
    await fs.rename(receipt.path, path.join(parentPath, "Moved"));
    await fs.mkdir(receipt.path);
    await fs.writeFile(path.join(receipt.path, "keep"), "user data");
    await fs.writeFile(journalPath, JSON.stringify(record));
    await expect(createProjectInitializationService({ journalDirectory }).initialize(input)).rejects.toThrow(/safely recovered/i);
    expect(await fs.readFile(path.join(receipt.path, "keep"), "utf8")).toBe("user data");
  });
});
