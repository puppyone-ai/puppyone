import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHostFileService, MAX_BYTES, MAX_ENTRIES } from "../../../../electron/main/hosts/host-file-service.mjs";

const roots = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

async function folder() {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-host-limits-")));
  roots.push(root);
  const service = createHostFileService({ resolveFolder: async (id) => id === "folder"
    ? { rootPath: root, state: "active", capabilities: ["folder.read", "folder.write"] } : null });
  return { root, service };
}

// The smallest valid files of each preview kind, byte for byte.
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4c50000000049454e44ae426082", "hex");
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n", "latin1");

describe("host file service limits", () => {
  it("lists a directory of exactly 10,000 entries and refuses one more", async () => {
    const { root, service } = await folder();
    const big = path.join(root, "big");
    await fs.mkdir(big);
    await Promise.all(Array.from({ length: MAX_ENTRIES }, (_, index) =>
      fs.writeFile(path.join(big, `file-${String(index).padStart(5, "0")}.md`), "")));
    const started = performance.now();
    const listed = await service.run({ action: "list", folder_id: "folder", path: "big" });
    const elapsed = performance.now() - started;
    expect(listed.entries).toHaveLength(MAX_ENTRIES);
    expect(listed.entries[0].name).toBe("file-00000.md");
    expect(listed.entries.at(-1).name).toBe("file-09999.md");
    // A full directory still answers well inside the gateway's 25 s request timeout.
    expect(elapsed).toBeLessThan(10_000);
    await fs.writeFile(path.join(big, "one-more.md"), "");
    await expect(service.run({ action: "list", folder_id: "folder", path: "big" }))
      .rejects.toMatchObject({ code: "too_many_entries" });
  }, 60_000);

  it("returns preview files byte for byte and refuses files over 8 MiB", async () => {
    const { root, service } = await folder();
    const files = { "image.png": PNG, "doc.pdf": PDF, "table.csv": Buffer.from("a,b\n1,\"x,y\"\n"),
      "note.md": Buffer.from("# Title\n\nUnicode: 中文 ✓\n") };
    for (const [name, bytes] of Object.entries(files)) await fs.writeFile(path.join(root, name), bytes);
    for (const [name, bytes] of Object.entries(files)) {
      const read = await service.run({ action: "read", folder_id: "folder", path: name });
      expect(Buffer.from(read.content_base64, "base64").equals(bytes)).toBe(true);
      expect(read.revision).toMatch(/^[a-f0-9]{64}$/);
    }
    await fs.writeFile(path.join(root, "limit.bin"), Buffer.alloc(MAX_BYTES, 1));
    const atLimit = await service.run({ action: "read", folder_id: "folder", path: "limit.bin" });
    expect(Buffer.from(atLimit.content_base64, "base64")).toHaveLength(MAX_BYTES);
    await fs.writeFile(path.join(root, "over.bin"), Buffer.alloc(MAX_BYTES + 1, 1));
    await expect(service.run({ action: "read", folder_id: "folder", path: "over.bin" }))
      .rejects.toMatchObject({ code: "unsupported_file" });
    // Writing a binary file is checked the same way and lands unchanged.
    await service.run({ action: "write", folder_id: "folder", path: "copy.png",
      content_base64: PNG.toString("base64"), expected_revision: null });
    expect((await fs.readFile(path.join(root, "copy.png"))).equals(PNG)).toBe(true);
  }, 60_000);
});
