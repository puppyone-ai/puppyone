import { mkdtemp, writeFile, readFile, readdir, rm, mkdir, symlink } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import io from "node:fs/promises";
import { saveWorkspaceDocumentConversion } from "../../../../electron/local-api/files/document-conversion-save.mjs";
let root;
const original = Buffer.from("original docx bytes");
const fingerprint = createHash("sha256").update(original).digest("hex");
const request = () => ({ path: "report.docx", fingerprint, primaryPath: "report.md", files: [
  { path: "report.md", bytes: new TextEncoder().encode("# Report\n\n![Chart](assets/image-001.png)\n") },
  { path: "assets/image-001.png", bytes: new Uint8Array([137,80,78,71,13,10,26,10]) },
  { path: "tables/table-001.csv", bytes: new TextEncoder().encode("Code\r\n0012\r\n") },
] });
beforeEach(async () => { root = await mkdtemp(path.join(os.tmpdir(), "puppy-conversion-save-")); await writeFile(path.join(root, "report.docx"), original); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
describe("native document conversion persistence", () => {
  it("persists generated binary assets and text together without touching the original", async () => {
    const saved = await saveWorkspaceDocumentConversion(root, request());
    expect(saved.ok).toBe(true);
    expect(saved.folderPath).toBe("converted/report");
    expect(await readFile(path.join(root, saved.openPath), "utf8")).toContain("# Report");
    expect(await readFile(path.join(root, saved.folderPath, "assets/image-001.png"))).toEqual(Buffer.from(request().files[1].bytes));
    expect(await readFile(path.join(root, "report.docx"))).toEqual(original);
  });
  it("rechecks source content in the authoritative process before creating output", async () => {
    await writeFile(path.join(root, "report.docx"), "changed");
    expect(await saveWorkspaceDocumentConversion(root, request())).toEqual({ ok: false, reason: "source-changed" });
    expect(await readdir(root)).toEqual(["report.docx"]);
  });
  it("uses distinct exclusive destinations for simultaneous saves", async () => {
    await mkdir(path.join(root, "converted/report"), { recursive: true });
    const results = await Promise.all([saveWorkspaceDocumentConversion(root, request()), saveWorkspaceDocumentConversion(root, request())]);
    expect(results.every(result => result.ok)).toBe(true);
    expect(new Set(results.map(result => result.folderPath)).size).toBe(2);
    expect(results.map(result => result.folderPath)).not.toContain("converted/report");
    expect(results.map(result => result.folderPath).sort()).toEqual(["converted/report-2", "converted/report-3"]);
  });
  it("collects nested sources at the project root without creating adjacent folders", async () => {
    await mkdir(path.join(root, "资料"));
    await writeFile(path.join(root, "资料/report.docx"), original);
    const input = request(); input.path = "资料/report.docx";
    const result = await saveWorkspaceDocumentConversion(root, input);
    expect(result.folderPath).toBe("converted/report");
    expect(result.openPath).toBe("converted/report/report.md");
    expect(await readdir(path.join(root, "资料"))).toEqual(["report.docx"]);
  });
  it("keeps existing converted contents and numbers equal names from different source folders", async () => {
    await mkdir(path.join(root, "converted"));
    await writeFile(path.join(root, "converted/keep.md"), "user content");
    await mkdir(path.join(root, "other"));
    await writeFile(path.join(root, "other/report.docx"), original);
    const first = await saveWorkspaceDocumentConversion(root, request());
    const second = await saveWorkspaceDocumentConversion(root, { ...request(), path: "other/report.docx" });
    expect([first.folderPath, second.folderPath]).toEqual(["converted/report", "converted/report-2"]);
    expect(await readFile(path.join(root, "converted/keep.md"), "utf8")).toBe("user content");
  });
  it("refuses a converted file instead of replacing it", async () => {
    await writeFile(path.join(root, "converted"), "user content");
    await expect(saveWorkspaceDocumentConversion(root, request())).rejects.toThrow();
    expect(await readFile(path.join(root, "converted"), "utf8")).toBe("user content");
  });
  it("refuses a converted symlink, including an in-project destination", async () => {
    await mkdir(path.join(root, "elsewhere"));
    await symlink(path.join(root, "elsewhere"), path.join(root, "converted"), "junction");
    await expect(saveWorkspaceDocumentConversion(root, request())).rejects.toThrow();
    expect(await readdir(path.join(root, "elsewhere"))).toEqual([]);
  });
  it.each(["../outside.md", "/outside.md", "assets/../../outside.png", "execute.js", ".git/config"])("rejects an unauthorized output %s", async bad => {
    const input = request(); input.files[0].path = bad; input.primaryPath = bad;
    expect((await saveWorkspaceDocumentConversion(root, input)).ok).toBe(false);
    expect(await readdir(root)).toEqual(["report.docx"]);
  });
  it("rejects case-insensitive duplicate outputs and invalid image signatures", async () => {
    const duplicate = request(); duplicate.files.push(duplicate.files[0]);
    expect((await saveWorkspaceDocumentConversion(root, duplicate)).ok).toBe(false);
    const image = request(); image.files[1].bytes = new TextEncoder().encode("<script>bad</script>");
    expect((await saveWorkspaceDocumentConversion(root, image)).ok).toBe(false);
  });
  it("reports the new folder when a write fails and preserves already created outputs", async () => {
    const write = io.writeFile.bind(io);
    const spy = vi.spyOn(io, "writeFile").mockImplementation(async (file, ...args) => {
      if (String(file).endsWith(".png")) throw new Error("disk full");
      return write(file, ...args);
    });
    try {
      const result = await saveWorkspaceDocumentConversion(root, request());
      expect(result).toEqual({ ok: false, reason: "io", folderPath: "converted/report" });
      expect(await readFile(path.join(root, result.folderPath, "report.md"), "utf8")).toContain("# Report");
      expect(await readFile(path.join(root, "report.docx"))).toEqual(original);
    } finally { spy.mockRestore(); }
  });
});
