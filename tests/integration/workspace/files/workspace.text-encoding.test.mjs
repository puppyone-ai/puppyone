import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readWorkspaceTextFile } from "../../../../electron/local-api/workspace.mjs";

// 姓名,金额\n张三,100\n in GBK.
const GBK_CSV = Buffer.from("d0d5c3fb2cbdf0b6ee0ad5c5c8fd2c3130300a", "hex");

describe("reading text files of unknown encoding", () => {
  let root;
  const write = (name, bytes) => fs.writeFile(path.join(root, name), bytes);

  beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-text-encoding-")); });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

  it("reports UTF-8, including a byte order mark", async () => {
    await write("a.csv", "姓名,金额\n");
    await write("bom.csv", Buffer.from([0xef, 0xbb, 0xbf, 0x61]));

    await expect(readWorkspaceTextFile(root, "a.csv")).resolves.toMatchObject({ encoding: "utf-8", content: "姓名,金额\n" });
    await expect(readWorkspaceTextFile(root, "bom.csv")).resolves.toMatchObject({ encoding: "utf-8" });
  });

  it("keeps project reads unchanged while flagging text it cannot round-trip", async () => {
    await write("gbk.csv", GBK_CSV);
    const file = await readWorkspaceTextFile(root, "gbk.csv");

    expect(file.encoding).toBe("unknown");
    expect(file.content).toContain("�");
  });

  it("decodes legacy Chinese text for a read-only host", async () => {
    await write("gbk.csv", GBK_CSV);
    const file = await readWorkspaceTextFile(root, "gbk.csv", { decodeLegacyText: true });

    expect(file.encoding).toBe("gb18030");
    expect(file.content).toBe("姓名,金额\n张三,100\n");
  });

  it("does not guess when no decoder fits", async () => {
    await write("noise.md", Buffer.from([0xff, 0xff, 0xff, 0xff, 0x81]));
    const file = await readWorkspaceTextFile(root, "noise.md", { decodeLegacyText: true });

    expect(file.encoding).toBe("unknown");
    expect(file.content).toContain("�");
  });

  it("leaves binary content unread", async () => {
    await write("utf16.csv", Buffer.from([0xff, 0xfe, 0x61, 0x00]));
    await expect(readWorkspaceTextFile(root, "utf16.csv", { decodeLegacyText: true })).resolves.toMatchObject({ content: null });
  });
});
