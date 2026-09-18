import { describe, it, expect } from "vitest";
import { getPreferredMimeType, resolveFileFormat } from "../../../../packages/shared-ui/src/core/fileFormats";
import { getEditorSourceRequirement, resolveEditorViewer } from "../../../../packages/shared-ui/src/editor/registry/viewerRegistry";
import { createDatabasePreviewPort, type DatabaseBridge } from "../../../../src/platform/databasePreviewClient";

describe("database candidate routing and cancellation", () => {
  it.each(["sample.DB", "sample.db3", "sample.sqlite", "sample.sqlite3", "sample.duckdb", "sample.ddb"])("routes %s to a lazy native session, never a full-file buffer", (name) => {
    expect(resolveFileFormat({ name }).id).toBe("database-candidate");
    expect(getEditorSourceRequirement({ name })).toBe("resource-session");
    expect(resolveEditorViewer({ name, path: name, type: "file" }).viewer).toMatchObject({
      capability: "preview", surfaceIsolation: "inline", computeIsolation: "native-process", runtime: "lazy",
    });
  });
  it("does not manufacture SQLite identity from .db or register all binary MIME as database", () => {
    expect(getPreferredMimeType("sample.db")).toBe("application/octet-stream");
    expect(getPreferredMimeType("sample.duckdb")).toBe("application/vnd.duckdb");
    expect(resolveFileFormat({ name: "unknown", mimeType: "application/octet-stream" }).defaultViewer).not.toBe("database-preview");
  });
  it("sends cancellation while open is pending, and awaits native exit before resolving", async () => {
    let closeCalls = 0, opened!: (value: Awaited<ReturnType<DatabaseBridge["openDatabasePreview"]>>) => void;
    let exited!: (value: Awaited<ReturnType<DatabaseBridge["closeDatabasePreview"]>>) => void;
    const bridge: DatabaseBridge = {
      openDatabasePreview: () => new Promise((resolve) => { opened = resolve; }),
      closeDatabasePreview: () => { closeCalls++; return new Promise((resolve) => { exited = resolve; }); },
      readDatabasePreviewPage: async () => { throw new Error("not reached"); },
    };
    const abort = new AbortController();
    const allocation = await createDatabasePreviewPort("root", () => bridge).open("sample.db", abort.signal);
    const result = expect(allocation.ready).rejects.toThrow();
    abort.abort(); expect(closeCalls).toBe(1);
    opened({ ok: false, error: { code: "cancelled" } });
    exited({ ok: true, value: undefined });
    await result; expect(closeCalls).toBe(1);
  });
  it("keeps a retriable close handle even if startup and the first close cannot confirm exit", async () => {
    let calls = 0;
    const bridge: DatabaseBridge = {
      openDatabasePreview: async () => ({ ok: false, error: { code: "host-failed" } }),
      closeDatabasePreview: async () => ++calls === 1 ? { ok: false, error: { code: "exit-unconfirmed" } } : { ok: true, value: undefined },
      readDatabasePreviewPage: async () => { throw new Error("not reached"); },
    };
    const allocation = await createDatabasePreviewPort("root", () => bridge).open("sample.db", new AbortController().signal);
    await expect(allocation.ready).rejects.toMatchObject({ code: "exit-unconfirmed" });
    await allocation.close(); expect(calls).toBe(2);
  });
});
