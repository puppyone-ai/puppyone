import { DATABASE_BUDGET as budget, databaseError, quoteIdentifier as quote } from "../../../shared/database-preview/contract.mjs";

export async function openDuckdb(source) {
  const { DuckDBInstance } = await import("@duckdb/node-api");
  const instance = await DuckDBInstance.create(source.filename, {
    // Disable spill BEFORE disabling external access: DuckDB treats changing
    // temp_directory as a filesystem permission change and rejects it later.
    temp_directory: "", max_temp_directory_size: "0B",
    access_mode: "READ_ONLY", enable_external_access: "false", autoinstall_known_extensions: "false",
    autoload_known_extensions: "false", allow_community_extensions: "false", allow_unsigned_extensions: "false",
    memory_limit: "128MB", threads: "1",
  });
  let connection;
  try {
    connection = await instance.connect();
    await connection.run("SET lock_configuration=true");
    await connection.run("BEGIN TRANSACTION");
    const rows = await (await connection.run(`SELECT table_schema, table_name, table_type FROM information_schema.tables
      WHERE table_catalog=current_database() ORDER BY table_schema, table_name LIMIT ${budget.maxObjects + 1}`)).getRows();
    if (rows.length > budget.maxObjects) throw databaseError("budget-exceeded");
    const entries = rows.map(([schema, name, kind], index) => ({ id: String(index), name, schema, kind, readable: kind === "BASE TABLE" }));
    const [[version]] = await (await connection.run("SELECT version()")).getRows();
    let stream = null, chunkRows = [], chunkIndex = 0, types = [];
    return {
      engine: "duckdb", version, objects: entries.map(({ schema, ...entry }) => ({ ...entry, name: `${schema}.${entry.name}` })),
      async select(objectId, columnOffset = 0) {
        connection.interrupt(); stream = null; chunkRows = []; chunkIndex = 0;
        const object = entries.find((entry) => entry.id === objectId);
        if (!object?.readable) throw databaseError("unsupported-object");
        const fields = await (await connection.run(`SELECT column_name, data_type FROM information_schema.columns
          WHERE table_catalog=current_database() AND table_schema=$1 AND table_name=$2
          ORDER BY ordinal_position LIMIT ${budget.maxColumns + 1}`, [object.schema, object.name])).getRows();
        if (!fields.length || fields.length > budget.maxColumns) throw databaseError("budget-exceeded");
        const columns = fields.map(([name, type], index) => ({ id: String(index), name, type, primaryKey: false }));
        const visible = columns.slice(columnOffset, columnOffset + budget.pageColumns);
        if (!visible.length) throw databaseError("invalid-request");
        types = visible.map(({ type }) => type === "BLOB" ? "blob"
          : /^(BOOLEAN|[U]?TINYINT|[U]?SMALLINT|[U]?INTEGER|[U]?BIGINT|[U]?HUGEINT|FLOAT|DOUBLE|DECIMAL|VARCHAR|DATE|TIME|TIMESTAMP|INTERVAL|UUID)/.test(type)
            && !/[\[\]]/.test(type) ? "scalar" : "complex");
        const projections = visible.flatMap(({ name }, index) => {
          const column = quote(name), kind = types[index];
          return [`${column} IS NULL`, kind === "scalar" ? `substring(CAST(${column} AS VARCHAR),1,${budget.cellCharacters + 1})` : "NULL",
            kind === "blob" ? `octet_length(${column})` : "0"];
        });
        stream = await connection.stream(`SELECT ${projections.join(",")} FROM ${quote(object.schema)}.${quote(object.name)}`);
        return { columns, visibleColumns: visible };
      },
      async next() {
        if (!stream) throw databaseError("invalid-request");
        const rows = [];
        while (rows.length < budget.pageRows) {
          if (chunkIndex >= chunkRows.length) {
            const chunk = await stream.fetchChunk();
            if (!chunk || chunk.rowCount === 0) return { rows, hasMore: false };
            chunkRows = chunk.getRows(); chunkIndex = 0;
          }
          const row = chunkRows[chunkIndex++];
          rows.push(types.map((type, i) => {
            if (row[i * 3]) return { kind: "null", text: "", truncated: false };
            const text = type === "scalar" ? String(row[i * 3 + 1]) : "";
            return { kind: type, text: text.slice(0, budget.cellCharacters), truncated: text.length > budget.cellCharacters || type === "complex",
              ...(type === "blob" ? { bytes: Number(row[i * 3 + 2]) } : {}) };
          }));
        }
        return { rows, hasMore: true };
      },
      close() { connection.interrupt(); connection.closeSync(); instance.closeSync(); },
    };
  } catch (error) { connection?.closeSync(); instance.closeSync(); throw error; }
}
