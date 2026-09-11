import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("node:child_process", () => ({ execFile: execute }));
import { convertMacosOfficeDocumentToDocx } from "../electron/main/platform/macos/office-document-converter.mjs";

describe("native Office conversion lifetime", () => {
  it("waits for actual child exit after the cancellation callback, before releasing temporary files", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-office-exit-test-"));
    const child = new EventEmitter(); child.kill = vi.fn();
    let outputPath;
    execute.mockImplementation((_file, args, options, callback) => {
      outputPath = args.at(-1);
      options.signal.addEventListener("abort", () => callback(Object.assign(new Error("cancelled"), { name: "AbortError" })));
      return child;
    });
    try {
      await fs.writeFile(path.join(root, "note.rtf"), "{\\rtf1 test}");
      const controller = new AbortController();
      let settled = false;
      const conversion = convertMacosOfficeDocumentToDocx(root, "note.rtf", { signal: controller.signal })
        .finally(() => { settled = true; });
      const rejected = expect(conversion).rejects.toThrow("Office conversion was cancelled");
      await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
      controller.abort();
      await Promise.resolve(); await Promise.resolve();
      expect(settled).toBe(false);
      expect((await fs.stat(path.dirname(outputPath))).isDirectory()).toBe(true);
      child.emit("close", null, "SIGTERM");
      await rejected;
      await expect(fs.stat(path.dirname(outputPath))).rejects.toMatchObject({ code: "ENOENT" });
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });
});
