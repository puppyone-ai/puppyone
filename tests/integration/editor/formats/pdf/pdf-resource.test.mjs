import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { PDF_MAX_SOURCE_BYTES, openPdfResource } from "../../../../../electron/main/pdf-resource.mjs";
import { registerLocalFileProtocol } from "../../../../../electron/main/local-file-protocol.mjs";
import { createLocalFileCapabilityStore, buildLocalFileCapabilityUrl } from "../../../../../electron/main/local-file-capabilities.mjs";
import { registerWorkspaceFileIpcHandlers } from "../../../../../electron/main/ipc/workspace-files-ipc.mjs";

let root, store, handler, url, openRoot, handlers, readWorkspaceFile;
beforeEach(async () => {
  root = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "pdf-admission-")));
  store = createLocalFileCapabilityStore(); openRoot = true; handlers = new Map();
  await fsp.writeFile(path.join(root, "report.pdf"), "%PDF-1.4\nfixture\n%%EOF");
  const token = store.issue({ senderId: 7, rootPath: root, relativePath: "report.pdf" });
  url = buildLocalFileCapabilityUrl({ relativePath: "report.pdf", token });
  readWorkspaceFile = vi.fn(() => { throw new Error("PDF must not use full-buffer text delivery"); });
  registerLocalFileProtocol({ protocol: { handle: (_, callback) => { handler = callback; } },
    readWorkspaceFile, getMimeType: () => "application/pdf", isOpenWorkspaceRoot: () => openRoot,
    resolveCapability: store.resolve, applicationUrl: "file:///app/index.html" });
  registerWorkspaceFileIpcHandlers({ ipcMain: { handle: (id, callback) => handlers.set(id, callback) },
    fs, authorizeWorkspaceRoot: async () => root, localFileCapabilities: store });
});
afterEach(async () => { await fsp.rm(root, { recursive: true, force: true }); });
const request = (method = "GET", range, target = url) => handler({ url: target, method,
  headers: new Headers({ Origin: "null", ...(range ? { Range: range } : {}) }) });
async function resize(size) { await fsp.truncate(path.join(root, "report.pdf"), size); }
const issue = () => handlers.get("workspace:get-file-url")({ sender: { id: 7 } }, { rootPath: root, path: "report.pdf" });

describe("PDF resource admission and streaming", () => {
  it("serves HEAD, complete GET, bounded and suffix ranges consistently", async () => {
    const head = await request("HEAD"); const full = await request();
    expect(head.status).toBe(200); expect(await head.text()).toBe("");
    expect(full.status).toBe(200); expect(full.headers.get("content-length")).toBe(head.headers.get("content-length"));
    expect(await full.text()).toContain("%PDF-1.4");
    const range = await request("GET", "bytes=0-7");
    expect(range.status).toBe(206); expect(await range.text()).toBe("%PDF-1.4");
    expect(await (await request("GET", "bytes=-5")).text()).toBe("%%EOF");
    expect((await request("GET", "bytes=9999-")).status).toBe(416);
    expect(readWorkspaceFile).not.toHaveBeenCalled();
  });

  it.each([101 * 1024 * 1024, PDF_MAX_SOURCE_BYTES])("admits %i bytes without the old 100 MiB buffer cap", async size => {
    await resize(size); expect((await issue()).url).toContain("puppyone-local:");
    const head = await request("HEAD"); expect(head.status).toBe(200);
    expect(Number(head.headers.get("content-length"))).toBe(size);
    const full = await request(); expect(full.status).toBe(200);
    const reader = full.body.getReader(); const first = await reader.read();
    expect(first.value.byteLength).toBeLessThanOrEqual(64 * 1024);
    expect(Buffer.from(first.value).subarray(0, 8).toString()).toBe("%PDF-1.4");
    await reader.cancel();
    const range = await request("GET", "bytes=0-7"); expect(range.status).toBe(206); await range.body.cancel();
    expect(readWorkspaceFile).not.toHaveBeenCalled();
  });

  it("enforces the manifest budget at issuance and after the issued file grows", async () => {
    await issue(); await resize(PDF_MAX_SOURCE_BYTES + 1);
    await expect(issue()).rejects.toThrow(/512 MiB/);
    for (const [method, range] of [["HEAD"], ["GET"], ["GET", "bytes=0-7"]]) {
      const response = await request(method, range);
      expect(response.status).toBe(413); expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("access-control-allow-origin")).toBe("null");
    }
  });

  it("rejects empty/mislabeled resources at issuance and every delivery entry point", async () => {
    for (const bytes of ["", "<html>not a PDF</html>"]) {
      await fsp.writeFile(path.join(root, "report.pdf"), bytes);
      await expect(issue()).rejects.toThrow(/PDF header/);
      for (const [method, range] of [["HEAD"], ["GET"], ["GET", "bytes=0-7"]]) expect((await request(method, range)).status).toBe(415);
    }
  });

  it("does not pretend that signature admission validates the PDF structure", async () => {
    await fsp.writeFile(path.join(root, "report.pdf"), "%PDF-1.7\nstructurally corrupt");
    expect((await request("HEAD")).status).toBe(200);
  });

  it("fails closed on revocation, retired roots, missing files and unsupported methods", async () => {
    expect((await request("POST")).status).toBe(405);
    openRoot = false; expect((await request()).status).toBe(403); openRoot = true;
    await fsp.unlink(path.join(root, "report.pdf")); expect((await request("HEAD")).status).toBe(404);
    store.revokeSender(7); expect((await request("HEAD")).status).toBe(403);
  });

  it("bounds an admitted stream even if the file is appended, and closes it on abort", async () => {
    const controller = new AbortController();
    const opened = await openPdfResource(root, "report.pdf", { method: "GET", signal: controller.signal });
    await fsp.appendFile(path.join(root, "report.pdf"), "not admitted");
    let count = 0; for await (const chunk of opened.stream) count += chunk.length;
    expect(count).toBe(opened.size); expect(opened.stream.closed).toBe(true);
    const aborted = await openPdfResource(root, "report.pdf", { method: "GET", signal: controller.signal });
    const closed = new Promise(resolve => aborted.stream.once("close", resolve));
    aborted.stream.on("error", () => {}); controller.abort(); await closed;
    expect(aborted.stream.destroyed).toBe(true);
  });
});
