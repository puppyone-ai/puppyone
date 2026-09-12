import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  acpWorkspaceFilePolicy,
  createAcpWorkspaceFileSystem,
} from "../../../../../electron/main/agent/security/acp-workspace-files.mjs";

const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.promises.rm(root, { recursive: true, force: true })));
});

describe("ACP workspace file delegate", () => {
  it("reads bounded line windows and writes only regular workspace files", async () => {
    const root = await temporaryRoot();
    await fs.promises.writeFile(path.join(root, "README.md"), "one\ntwo\nthree\n", "utf8");
    const delegate = createAcpWorkspaceFileSystem({ workspaceRoot: root });

    await expect(delegate.readTextFile({ path: "README.md", line: 2, limit: 1 })).resolves.toEqual({ content: "two" });
    await expect(delegate.writeTextFile({ path: "nested/result.txt", content: "safe" })).resolves.toEqual({});
    await expect(fs.promises.readFile(path.join(root, "nested", "result.txt"), "utf8")).resolves.toBe("safe");
  });

  it("rejects traversal and symlink escapes for reads, parents and targets", async () => {
    const root = await temporaryRoot();
    const outside = await temporaryRoot();
    await fs.promises.writeFile(path.join(outside, "secret.txt"), "secret", "utf8");
    await fs.promises.symlink(path.join(outside, "secret.txt"), path.join(root, "read-link"));
    await fs.promises.symlink(outside, path.join(root, "write-link"));
    const delegate = createAcpWorkspaceFileSystem({ workspaceRoot: root });

    await expect(delegate.readTextFile({ path: "../secret.txt" })).rejects.toThrow(/workspace/i);
    await expect(delegate.readTextFile({ path: "read-link" })).rejects.toThrow(/workspace/i);
    await expect(delegate.writeTextFile({ path: "write-link/result.txt", content: "unsafe" })).rejects.toThrow(/workspace directory/i);
    await expect(delegate.writeTextFile({ path: "../outside.txt", content: "unsafe" })).rejects.toThrow(/workspace/i);
  });

  it("rejects binary and oversized text payloads", async () => {
    const root = await temporaryRoot();
    await fs.promises.writeFile(path.join(root, "binary.dat"), Buffer.from([0, 1, 2]));
    const delegate = createAcpWorkspaceFileSystem({ workspaceRoot: root });

    await expect(delegate.readTextFile({ path: "binary.dat" })).rejects.toThrow(/binary/i);
    await expect(delegate.writeTextFile({
      path: "huge.txt",
      content: "x".repeat(acpWorkspaceFilePolicy.maxTextFileBytes + 1),
    })).rejects.toThrow(/4 MB/i);
  });
});

async function temporaryRoot() {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "puppyone-acp-files-"));
  roots.push(root);
  return root;
}
