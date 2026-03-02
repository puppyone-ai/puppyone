import { createClient } from "../api.js";
import { createOutput } from "../output.js";
import { withErrors, requireProject, formatDate } from "../helpers.js";

export function registerDb(program) {
  const db = program
    .command("db")
    .description("Database connector — connect external databases, browse and import tables");

  // ── connect ───────────────────────────────────────────────
  db
    .command("connect")
    .description("Create a database connection")
    .argument("<connection-string>", "database connection string")
    .option("--name <name>", "connection display name")
    .option("--type <type>", "database type (postgres, mysql, etc.)")
    .action(withErrors(async (connStr, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const projectId = requireProject(cmd);

      const body = {
        project_id: projectId,
        connection_string: connStr,
      };
      if (opts.name) body.name = opts.name;
      if (opts.type) body.type = opts.type;

      const created = await client.post("/db-connector/connections", body);
      out.info(`Database connected: ${created.name ?? created.id}`);
      out.success({ connection: created });
    }));

  // ── ls ────────────────────────────────────────────────────
  db
    .command("ls")
    .description("List database connections")
    .action(withErrors(async (opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const projectId = requireProject(cmd);

      const data = await client.get("/db-connector/connections", { project_id: projectId });
      const connections = Array.isArray(data) ? data : data?.items ?? [];

      out.table(
        connections.map((c) => ({
          id: (c.id ?? "").slice(0, 8),
          name: c.name ?? "-",
          type: c.type ?? c.db_type ?? "-",
          created: formatDate(c.created_at),
        })),
        [
          { key: "id", label: "ID" },
          { key: "name", label: "NAME" },
          { key: "type", label: "TYPE" },
          { key: "created", label: "CREATED" },
        ]
      );
      out.success({ connections });
    }));

  // ── rm ────────────────────────────────────────────────────
  db
    .command("rm")
    .description("Remove a database connection")
    .argument("<id>", "connection ID")
    .action(withErrors(async (id, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      await client.del(`/db-connector/connections/${id}`);
      out.info(`Database connection removed: ${id}`);
      out.success({ deleted: id });
    }));

  // ── tables ────────────────────────────────────────────────
  db
    .command("tables")
    .description("List tables in a database connection")
    .argument("<id>", "connection ID")
    .action(withErrors(async (id, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const data = await client.get(`/db-connector/connections/${id}/tables`);
      const tables = Array.isArray(data) ? data : data?.items ?? [];

      out.table(
        tables.map((t) => ({
          name: t.name ?? t.table_name ?? "-",
          rows: t.row_count ?? "-",
          schema: t.schema ?? "-",
        })),
        [
          { key: "name", label: "TABLE" },
          { key: "schema", label: "SCHEMA" },
          { key: "rows", label: "ROWS" },
        ]
      );
      out.success({ tables });
    }));

  // ── preview ───────────────────────────────────────────────
  db
    .command("preview")
    .description("Preview table data")
    .argument("<id>", "connection ID")
    .argument("<table-name>", "table name")
    .action(withErrors(async (id, tableName, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const data = await client.get(`/db-connector/connections/${id}/tables/${tableName}/preview`);

      if (data?.columns && data?.rows) {
        out.table(
          data.rows.slice(0, 20).map((row) => {
            const obj = {};
            data.columns.forEach((col, i) => { obj[col] = row[i] ?? row[col]; });
            return obj;
          }),
          data.columns.map((col) => ({ key: col, label: col.toUpperCase() }))
        );
      } else {
        out.raw(JSON.stringify(data, null, 2));
      }
      out.success({ preview: data });
    }));

  // ── save ──────────────────────────────────────────────────
  db
    .command("save")
    .description("Save a database table as a content node in the project")
    .argument("<id>", "connection ID")
    .option("--table <name>", "table name to save")
    .option("--folder <path>", "target folder in project")
    .action(withErrors(async (id, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);

      const body = {};
      if (opts.table) body.table_name = opts.table;

      const result = await client.post(`/db-connector/connections/${id}/save`, body);
      out.info(`Table saved as content node`);
      out.success({ result });
    }));
}
