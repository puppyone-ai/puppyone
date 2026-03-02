import { createClient } from "../api.js";
import { createOutput } from "../output.js";
import { withErrors, requireOrg, requireProject, formatDate } from "../helpers.js";

export function registerTable(program) {
  const tbl = program
    .command("table")
    .alias("t")
    .description("Structured data tables — JSON Pointer-based CRUD");

  // ── ls ────────────────────────────────────────────────────
  tbl
    .command("ls")
    .description("List tables")
    .action(withErrors(async (opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const orgId = requireOrg(cmd);

      const data = await client.get("/tables", { org_id: orgId });
      const tables = Array.isArray(data) ? data : data?.items ?? [];

      const flat = [];
      for (const item of tables) {
        if (item.tables) {
          for (const t of item.tables) flat.push({ ...t, project: item.project_name ?? item.name });
        } else {
          flat.push(item);
        }
      }

      out.table(
        flat.map((t) => ({
          id: (t.id ?? "").slice(0, 8),
          name: t.name ?? "-",
          project: t.project ?? t.project_name ?? "-",
          updated: formatDate(t.updated_at),
        })),
        [
          { key: "id", label: "ID" },
          { key: "name", label: "NAME" },
          { key: "project", label: "PROJECT" },
          { key: "updated", label: "UPDATED" },
        ]
      );
      out.success({ tables: flat });
    }));

  // ── create ────────────────────────────────────────────────
  tbl
    .command("create")
    .description("Create a table")
    .argument("<name>", "table name")
    .option("-d, --data <json>", "initial data (JSON string)")
    .option("--node <node-id>", "attach to content node")
    .action(withErrors(async (name, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const projectId = requireProject(cmd);

      const body = { name, project_id: projectId };
      if (opts.data) body.data = JSON.parse(opts.data);
      if (opts.node) body.node_id = opts.node;

      const created = await client.post("/tables", body);
      out.info(`Table created: ${created.name} (${created.id})`);
      out.success({ table: created });
    }));

  // ── get ───────────────────────────────────────────────────
  tbl
    .command("get")
    .description("Get table content")
    .argument("<id>", "table ID")
    .option("--pointer <path>", "JSON Pointer path (e.g. /key/0/field)")
    .action(withErrors(async (id, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);

      if (opts.pointer) {
        const data = await client.get(`/tables/${id}/data`, { json_pointer_path: opts.pointer });
        const payload = data?.data ?? data;
        out.raw(JSON.stringify(payload, null, 2));
        out.success({ data: payload });
      } else {
        const table = await client.get(`/tables/${id}`);
        out.kv([
          ["Name:", table.name],
          ["ID:", table.id],
          ["Updated:", formatDate(table.updated_at)],
        ]);
        if (table.data != null) {
          out.info("\nData:");
          out.raw(JSON.stringify(table.data, null, 2));
        }
        out.success({ table });
      }
    }));

  // ── update ────────────────────────────────────────────────
  tbl
    .command("update")
    .description("Update table metadata")
    .argument("<id>", "table ID")
    .option("--name <name>", "new name")
    .option("--description <desc>", "new description")
    .option("-d, --data <json>", "replace entire data (JSON string)")
    .action(withErrors(async (id, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);

      const body = {};
      if (opts.name) body.name = opts.name;
      if (opts.description) body.description = opts.description;
      if (opts.data) body.data = JSON.parse(opts.data);

      const updated = await client.put(`/tables/${id}`, body);
      out.info(`Table updated: ${id}`);
      out.success({ table: updated });
    }));

  // ── set ───────────────────────────────────────────────────
  tbl
    .command("set")
    .description("Set data at a JSON Pointer path")
    .argument("<id>", "table ID")
    .argument("<pointer>", "JSON Pointer path (e.g. /users)")
    .argument("<key>", "key name")
    .argument("<value>", "value (JSON string)")
    .action(withErrors(async (id, pointer, key, value, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);

      let parsed;
      try { parsed = JSON.parse(value); } catch { parsed = value; }

      await client.put(`/tables/${id}/data`, {
        json_pointer_path: pointer,
        elements: [{ key, content: parsed }],
      });
      out.info(`Updated ${pointer}/${key} in table ${id}`);
      out.success({ table_id: id, pointer, key, value: parsed });
    }));

  // ── add ───────────────────────────────────────────────────
  tbl
    .command("add")
    .description("Add data at a JSON Pointer path")
    .argument("<id>", "table ID")
    .argument("<pointer>", "JSON Pointer mount path (e.g. /users)")
    .argument("<key>", "key name")
    .argument("<value>", "value (JSON string)")
    .action(withErrors(async (id, pointer, key, value, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);

      let parsed;
      try { parsed = JSON.parse(value); } catch { parsed = value; }

      await client.post(`/tables/${id}/data`, {
        mounted_json_pointer_path: pointer,
        elements: [{ key, content: parsed }],
      });
      out.info(`Added ${key} at ${pointer} in table ${id}`);
      out.success({ table_id: id, pointer, key, value: parsed });
    }));

  // ── del ───────────────────────────────────────────────────
  tbl
    .command("del")
    .description("Delete data at a JSON Pointer path")
    .argument("<id>", "table ID")
    .argument("<pointer>", "JSON Pointer path (e.g. /users)")
    .argument("<keys...>", "keys to delete")
    .action(withErrors(async (id, pointer, keys, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);

      await client.del(`/tables/${id}/data`, {
        json_pointer_path: pointer,
        keys,
      });
      out.info(`Deleted keys [${keys.join(", ")}] at ${pointer} from table ${id}`);
      out.success({ table_id: id, pointer, keys });
    }));

  // ── rm ────────────────────────────────────────────────────
  tbl
    .command("rm")
    .description("Delete a table")
    .argument("<id>", "table ID")
    .action(withErrors(async (id, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      await client.del(`/tables/${id}`);
      out.info(`Table deleted: ${id}`);
      out.success({ deleted: id });
    }));
}
