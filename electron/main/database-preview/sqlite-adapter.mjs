import { DATABASE_BUDGET as budget, databaseError, quoteIdentifier as quote } from "../../../shared/database-preview/contract.mjs";

export async function openSqlite(source) {
  const { DatabaseSync, constants } = await import("node:sqlite");
  if (!DatabaseSync.prototype.setAuthorizer || !DatabaseSync.prototype.enableDefensive) throw databaseError("capability-unavailable");
  const db = new DatabaseSync(source.filename, { readOnly: true, allowExtension: false,
    enableDoubleQuotedStringLiterals: false, timeout: 500 });
  try {
    db.enableDefensive(true);
    db.exec("PRAGMA trusted_schema=OFF; PRAGMA query_only=ON; PRAGMA mmap_size=0; PRAGMA cache_size=-8192; PRAGMA temp_store=MEMORY; PRAGMA hard_heap_limit=134217728; BEGIN");
    const query = (sql, ...args) => { const stmt = db.prepare(sql); stmt.setReadBigInts(true); return stmt.all(...args); };
    const entries = query("SELECT name, type, ncol FROM pragma_table_list WHERE schema='main' AND name NOT LIKE 'sqlite_%' LIMIT ?", budget.maxObjects + 1);
    if (entries.length > budget.maxObjects) throw databaseError("budget-exceeded");
    const objects = entries.map((entry, index) => {
      const tooWide = Number(entry.ncol) > budget.maxColumns;
      const hasHiddenColumns = entry.type === "table"
        && query("SELECT hidden FROM pragma_table_xinfo(?) WHERE hidden<>0 LIMIT 1", entry.name).length > 0;
      const readable = entry.type === "table" && !tooWide && !hasHiddenColumns;
      return { id: String(index), name: entry.name, kind: entry.type, readable,
        ...(readable ? {} : { unavailableReason: entry.type !== "table" ? "unsupported-object-kind"
          : tooWide ? "too-many-columns" : "generated-or-hidden-columns" }) };
    });
    const version = String(query("SELECT sqlite_version() AS version")[0].version);
    let iterator = null;
    // A strict authorizer restricts even malicious schema execution to the
    // selected base table and our small set of scalar projection functions.
    const functions = new Set(["typeof", "substr", "length"]);
    let selectedTable = null;
    const authorize = (action, first, second, database, trigger) => {
      if (trigger || (database && database !== "main")) return constants.SQLITE_DENY;
      if (action === constants.SQLITE_SELECT) return constants.SQLITE_OK;
      if (action === constants.SQLITE_READ && first === selectedTable) return constants.SQLITE_OK;
      if (action === constants.SQLITE_FUNCTION && functions.has(second)) return constants.SQLITE_OK;
      return constants.SQLITE_DENY;
    };
    return {
      engine: "sqlite", version, objects,
      async select(objectId, columnOffset = 0) {
        iterator?.return(); iterator = null;
        db.setAuthorizer(null);
        const object = objects.find((entry) => entry.id === objectId);
        if (!object?.readable) throw databaseError("unsupported-object");
        const fields = query("SELECT cid, name, type, pk, hidden FROM pragma_table_xinfo(?) LIMIT ?", object.name, budget.maxColumns + 1);
        if (fields.length > budget.maxColumns || fields.some((field) => Number(field.hidden) !== 0)) throw databaseError("unsupported-object");
        const columns = fields.map((field) => ({ id: String(field.cid), name: field.name, type: field.type || "ANY", primaryKey: Number(field.pk) > 0 }));
        const visible = columns.slice(columnOffset, columnOffset + budget.pageColumns);
        if (!visible.length && columns.length) throw databaseError("invalid-request");
        const projections = visible.flatMap(({ name }, index) => {
          const col = quote(name);
          return [`typeof(${col}) AS ${quote(`t${index}`)}`,
            // Even substr(blob) can materialize the entire SQLite value. The
            // initial page needs its size only; length(blob) reads record metadata.
            `CASE WHEN typeof(${col})='blob' THEN NULL WHEN typeof(${col}) IN ('integer','real') THEN ${col} ELSE substr(CAST(${col} AS TEXT),1,${budget.cellCharacters}) END AS ${quote(`v${index}`)}`,
            `CASE WHEN typeof(${col}) IN ('text','blob') THEN length(${col}) ELSE 0 END AS ${quote(`n${index}`)}`];
        });
        selectedTable = object.name; db.setAuthorizer(authorize);
        const statement = db.prepare(`SELECT ${projections.join(",")} FROM ${quote(object.name)}`);
        statement.setReadBigInts(true);
        iterator = statement.iterate();
        return { columns, visibleColumns: visible };
      },
      async next() {
        if (!iterator) throw databaseError("invalid-request");
        const rows = [];
        for (let n = 0; n < budget.pageRows; n++) {
          const next = iterator.next();
          if (next.done) return { rows, hasMore: false };
          const values = next.value;
          const cells = [];
          for (let col = 0; `t${col}` in values; col++) {
            const kind = values[`t${col}`];
            const length = Number(values[`n${col}`]);
            cells.push({ kind, text: kind === "null" || kind === "blob" ? "" : String(values[`v${col}`]),
              truncated: kind === "blob" ? false : length > budget.cellCharacters,
              ...(kind === "blob" ? { bytes: length } : {}) });
          }
          rows.push(cells);
        }
        return { rows, hasMore: true };
      },
      close() { iterator?.return(); db.setAuthorizer(null); db.close(); },
    };
  } catch (error) { db.close(); throw error; }
}
