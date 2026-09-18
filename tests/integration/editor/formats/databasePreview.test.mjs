import { describe, it, expect, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fork } from "node:child_process";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import { DatabaseSync } from "node:sqlite";
import { DuckDBInstance } from "@duckdb/node-api";
import { createDatabasePreviewService } from "../../../../electron/main/database-preview/service.mjs";
import { inspectDatabaseSource, verifyDatabaseSource } from "../../../../electron/main/database-preview/source.mjs";
import { detectDatabase, publicDatabaseFailure, DATABASE_BUDGET } from "../../../../shared/database-preview/contract.mjs";

const require = createRequire(import.meta.url);
const electron = require("electron");
function service(children = []) {
  return createDatabasePreviewService({ spawnHost() {
    const child = fork(path.resolve("electron/utility/database-preview/main.mjs"), [], {
      execPath: electron, execArgv: [], env: { ELECTRON_RUN_AS_NODE: "1" }, stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    child.postMessage = (message) => child.send(message);
    children.push(child);
    return child;
  } });
}
async function fixture(engine) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-db-test-"));
  const file = path.join(root, "sample.db");
  if (engine === "sqlite") {
    const db = new DatabaseSync(file);
    db.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, label TEXT, big INTEGER); CREATE VIEW unsafe AS SELECT * FROM items;");
    const statement = db.prepare("INSERT INTO items VALUES (?, ?, ?)");
    for (let i = 0; i < 57; i++) statement.run(i, `<b>row ${i}</b>`, 9223372036854775807n);
    db.close();
  } else {
    const db = await DuckDBInstance.create(file); const connection = await db.connect();
    await connection.run("CREATE TABLE items AS SELECT range AS id, 'row' AS label, 123456789012345678901234567890::HUGEINT AS big FROM range(57)");
    connection.closeSync(); db.closeSync();
  }
  return { root, file, cleanup: () => fs.rm(root, { recursive: true, force: true }) };
}

describe("real isolated database engines", () => {
  it("uses bounded signatures and redacts native paths/SQL from errors", () => {
    for (const header of [Buffer.alloc(0), Buffer.alloc(8), Buffer.from("SQLite format 3\0"), Buffer.from("secret data")]) {
      expect(() => detectDatabase(header)).toThrow("unrecognized-format");
    }
    expect(publicDatabaseFailure(new Error("SQL /private/secret.db contains private value"))).toEqual({ code: "host-failed" });
  });
  for (const engine of ["sqlite", "duckdb"]) it(`${engine}: detects .db content, pages losslessly and leaves source unchanged`, async () => {
    const input = await fixture(engine); const host = service();
    try {
      const before = await fs.readFile(input.file);
      const info = await host.open(1, { id: "first", rootPath: input.root, path: "sample.db" }, async () => input.root);
      expect(info.engine).toBe(engine);
      const table = info.objects.find((entry) => entry.name.endsWith("items"));
      const page = await host.page(1, { id: "first", objectId: table.id }, async () => input.root);
      expect(page.rows).toHaveLength(50); expect(page.hasMore).toBe(true);
      expect(page.rows[0][2].text).toBe(engine === "sqlite" ? "9223372036854775807" : "123456789012345678901234567890");
      const next = await host.page(1, { id: "first", cursor: page.cursor }, async () => input.root);
      expect(next.rows).toHaveLength(7); expect(next.hasMore).toBe(false);
      await host.close(1, "first"); expect(host.sessionCount()).toBe(0);
      expect(await fs.readdir(input.root)).toEqual(["sample.db"]);
      expect(await fs.readFile(input.file)).toEqual(before);
    } finally { await host.closeAll(); await input.cleanup(); }
  }, 25000);

  it("rejects unknown, symlink and WAL sources without trying to repair them", async () => {
    const input = await fixture("sqlite");
    try {
      await fs.writeFile(path.join(input.root, "unknown.db"), "not a sqlite database");
      await expect(inspectDatabaseSource(input.root, "unknown.db")).rejects.toMatchObject({ code: "unrecognized-format" });
      await fs.symlink(input.file, path.join(input.root, "linked.db"));
      await expect(inspectDatabaseSource(input.root, "linked.db")).rejects.toMatchObject({ code: "permission-denied" });
      const db = new DatabaseSync(input.file); db.exec("PRAGMA journal_mode=WAL"); db.close();
      await expect(inspectDatabaseSource(input.root, "sample.db")).rejects.toMatchObject({ code: "recovery-required" });
    } finally { await input.cleanup(); }
  });

  for (const engine of ["sqlite", "duckdb"]) it(`${engine}: bounds values and refuses views or arbitrary SQL`, async () => {
    const input = await fixture(engine), host = service();
    try {
      if (engine === "sqlite") {
        const db = new DatabaseSync(input.file);
        db.exec('CREATE TABLE "quoted\"\"table" ("a\"\"field" TEXT, empty TEXT, missing TEXT, bytes BLOB, precise REAL);');
        db.prepare('INSERT INTO "quoted\"\"table" VALUES (?, ?, NULL, zeroblob(1048576), ?)').run("x".repeat(10000), "", 1.2345678901234567);
        db.exec("CREATE TABLE generated(a INT, b INT GENERATED ALWAYS AS (a+1));"); db.close();
      } else {
        const db = await DuckDBInstance.create(input.file), connection = await db.connect();
        await connection.run(`CREATE TABLE typed AS SELECT repeat('x',10000) AS long, '' AS empty, NULL::VARCHAR AS missing,
          '123'::BLOB AS bytes, 1234567890123456789.1234567890123456789::DECIMAL(38,19) AS precise, [1,2,3] AS nested`);
        await connection.run("CREATE VIEW unsafe AS SELECT * FROM read_csv_auto('/not-permitted.csv')", undefined).catch(() => {});
        await connection.run("CREATE VIEW safe_view AS SELECT * FROM typed");
        connection.closeSync(); db.closeSync();
      }
      const info = await host.open(1, { id: "typed", rootPath: input.root, path: "sample.db" }, async () => input.root);
      expect(info.objects.filter((o) => /view/i.test(o.kind)).every((o) => !o.readable)).toBe(true);
      expect(info.objects.find((o) => o.name === "generated")?.readable ?? false).toBe(false);
      const object = info.objects.find((o) => o.name.includes(engine === "sqlite" ? "quoted" : "typed"));
      const page = await host.page(1, { id: "typed", objectId: object.id }, async () => input.root);
      expect(page.rows[0][0]).toMatchObject({ text: "x".repeat(256), truncated: true });
      expect(page.rows[0][1]).toMatchObject({ text: "" }); expect(page.rows[0][2].kind).toBe("null");
      expect(page.rows[0][3]).toMatchObject({ kind: "blob", bytes: engine === "sqlite" ? 1048576 : 3 });
      expect(page.rows[0][4].text).toBe(engine === "sqlite" ? "1.2345678901234567" : "1234567890123456789.1234567890123456789");
      if (engine === "duckdb") expect(page.rows[0][5].kind).toBe("complex");
      await expect(host.page(1, { id: "typed", objectId: "items; DROP TABLE items" }, async () => input.root)).rejects.toMatchObject({ code: "unsupported-object" });
      expect(host.sessionCount()).toBe(0);
    } finally { await host.closeAll(); await input.cleanup(); }
  }, 25000);

  it("rejects traversal, directories, atomic replacement and oversized sources before delivery", async () => {
    const input = await fixture("sqlite");
    try {
      await expect(inspectDatabaseSource(input.root, "../sample.db")).rejects.toMatchObject({ code: "permission-denied" });
      await fs.mkdir(path.join(input.root, "folder.db"));
      await expect(inspectDatabaseSource(input.root, "folder.db")).rejects.toMatchObject({ code: "invalid-request" });
      const source = await inspectDatabaseSource(input.root, "sample.db");
      await fs.rename(input.file, path.join(input.root, "previous.db")); await fs.copyFile(path.join(input.root, "previous.db"), input.file);
      await expect(verifyDatabaseSource(source)).rejects.toMatchObject({ code: "stale-input" });
      await fs.truncate(input.file, DATABASE_BUDGET.maxSourceBytes + 1);
      await expect(inspectDatabaseSource(input.root, "sample.db")).rejects.toMatchObject({ code: "budget-exceeded" });
    } finally { await input.cleanup(); }
  });

  it("isolates owners, rejects consumed cursors, and closes a revoked owner", async () => {
    const input = await fixture("sqlite"), host = service();
    try {
      const info = await host.open(1, { id: "first", rootPath: input.root, path: "sample.db" }, async () => input.root);
      await host.open(2, { id: "first", rootPath: input.root, path: "sample.db" }, async () => input.root);
      await expect(host.page(3, { id: "first", objectId: "0" }, async () => input.root)).rejects.toMatchObject({ code: "stale-input" });
      const objectId = info.objects.find((o) => o.name === "items").id;
      const first = await host.page(1, { id: "first", objectId }, async () => input.root);
      await host.page(1, { id: "first", cursor: first.cursor }, async () => input.root);
      await expect(host.page(1, { id: "first", cursor: first.cursor }, async () => input.root)).rejects.toMatchObject({ code: "stale-input" });
      expect(host.sessionCount()).toBe(1);
      await expect(host.page(2, { id: "first", objectId }, async () => { throw Object.assign(new Error(), { code: "permission-denied" }); })).rejects.toMatchObject({ code: "permission-denied" });
      expect(host.sessionCount()).toBe(0);
      const writer = new DatabaseSync(input.file); writer.exec("BEGIN EXCLUSIVE; INSERT INTO items VALUES(999,'released',0); COMMIT"); writer.close();
    } finally { await host.closeAll(); await input.cleanup(); }
  }, 25000);

  it("keeps a pending allocation registered through close and never starts its engine", async () => {
    const input = await fixture("sqlite"); let authorize;
    const host = createDatabasePreviewService({ spawnHost() { throw new Error("must not spawn"); } });
    try {
      const opening = host.open(1, { id: "pending", rootPath: input.root, path: "sample.db" }, () => new Promise((resolve) => { authorize = resolve; }));
      const rejection = expect(opening).rejects.toMatchObject({ code: "cancelled" });
      const closing = host.close(1, "pending"); expect(host.sessionCount()).toBe(1);
      authorize(input.root); await closing; await rejection; expect(host.sessionCount()).toBe(0);
    } finally { await host.closeAll(); await input.cleanup(); }
  });

  it("does not release quota until the host exit is confirmed", async () => {
    const input = await fixture("sqlite"); let child;
    const host = createDatabasePreviewService({ spawnHost() {
      child = new EventEmitter(); child.kill = () => true;
      child.postMessage = (message) => { if (message.method === "open") queueMicrotask(() => child.emit("message", { id: message.id, result: { objects: [] } })); };
      return child;
    } });
    try {
      await host.open(1, { id: "exit", rootPath: input.root, path: "sample.db" }, async () => input.root);
      const closing = host.close(1, "exit"); await new Promise((resolve) => setTimeout(resolve, 150));
      expect(host.sessionCount()).toBe(1); child.emit("exit", 0); await closing; expect(host.sessionCount()).toBe(0);
    } finally { child?.emit("exit", 0); await host.closeAll(); await input.cleanup(); }
  });

  it("supervises probe/query timeouts and memory independently of an unresponsive host", async () => {
    vi.useFakeTimers();
    const children = [];
    const spawnHost = () => {
      const child = new EventEmitter(); child.postMessage = () => {};
      child.kill = () => { child.emit("exit", 0); return true; }; children.push(child); return child;
    };
    const timed = createDatabasePreviewService({ spawnHost });
    const memory = createDatabasePreviewService({ spawnHost, getMemoryBytes: () => DATABASE_BUDGET.maxHostRssBytes + 1 });
    try {
      const timeout = expect(timed.open(1, { id: "timeout", rootPath: "root", path: "sample.db" }, async () => "root")).rejects.toMatchObject({ code: "timeout" });
      await vi.advanceTimersByTimeAsync(DATABASE_BUDGET.openMs + 200); await timeout;
      expect(timed.sessionCount()).toBe(0);
      const exceeded = expect(memory.open(1, { id: "memory", rootPath: "root", path: "sample.db" }, async () => "root")).rejects.toMatchObject({ code: "budget-exceeded" });
      await vi.advanceTimersByTimeAsync(700); await exceeded;
      expect(memory.sessionCount()).toBe(0);
    } finally { children.forEach(child => child.emit("exit", 0)); await timed.closeAll(); await memory.closeAll(); vi.useRealTimers(); }
  });

  it("releases actual file locks after native host crash", async () => {
    const input = await fixture("sqlite"), children = [], host = service(children);
    try {
      const info = await host.open(1, { id: "crash", rootPath: input.root, path: "sample.db" }, async () => input.root);
      await host.page(1, { id: "crash", objectId: info.objects.find(o => o.name === "items").id }, async () => input.root);
      const exited = new Promise(resolve => children[0].once("exit", resolve)); children[0].kill("SIGKILL"); await exited;
      expect(host.sessionCount()).toBe(0);
      const writer = new DatabaseSync(input.file); writer.exec("BEGIN EXCLUSIVE; INSERT INTO items VALUES(99,'after crash',1); COMMIT"); writer.close();
    } finally { await host.closeAll(); await input.cleanup(); }
  }, 25000);

  it("rejects a real active WAL snapshot rather than displaying stale checkpointed rows", async () => {
    const input = await fixture("sqlite"), host = service(); const writer = new DatabaseSync(input.file);
    try {
      writer.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; INSERT INTO items VALUES(99,'only in WAL',1)");
      const before = await fs.readFile(`${input.file}-wal`);
      await expect(host.open(1, { id: "wal", rootPath: input.root, path: "sample.db" }, async () => input.root)).rejects.toMatchObject({ code: "recovery-required" });
      expect(await fs.readFile(`${input.file}-wal`)).toEqual(before); expect(host.sessionCount()).toBe(0);
    } finally { await host.closeAll(); writer.close(); await input.cleanup(); }
  });

  it("refuses DuckDB while another process owns a write connection", async () => {
    const input = await fixture("duckdb"), host = service(), writer = await DuckDBInstance.create(input.file), connection = await writer.connect();
    try {
      // This Vitest process holds the write lock; preview runs in a different process.
      await expect(host.open(1, { id: "writer", rootPath: input.root, path: "sample.db" }, async () => input.root)).rejects.toMatchObject({ code: "busy" });
      expect(host.sessionCount()).toBe(0);
    } finally { await host.closeAll(); connection.closeSync(); writer.closeSync(); await input.cleanup(); }
  }, 25000);

  for (const engine of ["sqlite", "duckdb"]) it(`${engine}: projects wide tables in bounded column windows`, async () => {
    const input = await fixture(engine), host = service();
    try {
      const fields = Array.from({ length: 30 }, (_, i) => `c${i} INTEGER`).join(",");
      if (engine === "sqlite") { const db = new DatabaseSync(input.file); db.exec(`CREATE TABLE wide(${fields});INSERT INTO wide(c0,c29) VALUES(1,29)`); db.close(); }
      else { const db = await DuckDBInstance.create(input.file), c = await db.connect(); await c.run(`CREATE TABLE wide(${fields});INSERT INTO wide(c0,c29) VALUES(1,29)`); c.closeSync(); db.closeSync(); }
      const info = await host.open(1, { id: "wide", rootPath: input.root, path: "sample.db" }, async () => input.root);
      const objectId = info.objects.find(o => o.name.endsWith("wide")).id;
      const first = await host.page(1, { id: "wide", objectId }, async () => input.root);
      expect(first.rows[0]).toHaveLength(24); expect(first.columns).toHaveLength(30);
      const last = await host.page(1, { id: "wide", objectId, columnOffset: 24 }, async () => input.root);
      expect(last.rows[0]).toHaveLength(6); expect(last.rows[0][5].text).toBe("29");
    } finally { await host.closeAll(); await input.cleanup(); }
  }, 25000);
});
