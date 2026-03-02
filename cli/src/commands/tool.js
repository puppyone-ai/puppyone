import { createClient } from "../api.js";
import { createOutput } from "../output.js";
import { withErrors, requireOrg, requireProject, formatDate } from "../helpers.js";

export function registerTool(program) {
  const tool = program
    .command("tool")
    .description("Tool management — register and search tools for agents");

  // ── ls ────────────────────────────────────────────────────
  tool
    .command("ls")
    .description("List tools")
    .option("--project <id>", "filter by project ID")
    .action(withErrors(async (opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const orgId = requireOrg(cmd);

      const query = { org_id: orgId };
      if (opts.project) query.project_id = opts.project;

      const data = await client.get("/tools", query);
      const tools = Array.isArray(data) ? data : data?.items ?? [];

      out.table(
        tools.map((t) => ({
          id: (t.id ?? "").slice(0, 8),
          name: t.name ?? "-",
          type: t.type ?? "-",
          project: t.project_name ?? t.project_id?.slice(0, 8) ?? "-",
          updated: formatDate(t.updated_at),
        })),
        [
          { key: "id", label: "ID" },
          { key: "name", label: "NAME" },
          { key: "type", label: "TYPE" },
          { key: "project", label: "PROJECT" },
          { key: "updated", label: "UPDATED" },
        ]
      );
      out.success({ tools });
    }));

  // ── create ────────────────────────────────────────────────
  tool
    .command("create")
    .description("Create a tool")
    .argument("<name>", "tool name")
    .option("--type <type>", "tool type", "search")
    .option("--node <node-id>", "content node to index")
    .option("--description <desc>", "tool description")
    .action(withErrors(async (name, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const projectId = requireProject(cmd);

      const body = {
        name,
        project_id: projectId,
        type: opts.type,
        description: opts.description,
      };

      if (opts.node) body.node_id = opts.node;

      let created;
      if (opts.type === "search") {
        created = await client.post("/tools/search", body);
      } else {
        created = await client.post("/tools", body);
      }

      out.info(`Tool created: ${created.name ?? name} (${created.id})`);
      out.success({ tool: created });
    }));

  // ── info ──────────────────────────────────────────────────
  tool
    .command("info")
    .description("Show tool details")
    .argument("<id>", "tool ID")
    .action(withErrors(async (id, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const info = await client.get(`/tools/${id}`);

      out.kv([
        ["Name:", info.name],
        ["ID:", info.id],
        ["Type:", info.type ?? "-"],
        ["Description:", info.description ?? "(none)"],
        ["Node:", info.node_id ?? "-"],
        ["Created:", formatDate(info.created_at)],
        ["Updated:", formatDate(info.updated_at)],
      ]);

      if (info.type === "search") {
        try {
          const idx = await client.get(`/tools/${id}/search-index`);
          out.info(`\n  Search index: ${idx.status ?? "unknown"}`);
          if (idx.document_count != null) out.info(`  Documents: ${idx.document_count}`);
        } catch { /* index endpoint might not exist */ }
      }

      out.success({ tool: info });
    }));

  // ── update ─────────────────────────────────────────────────
  tool
    .command("update")
    .description("Update a tool")
    .argument("<id>", "tool ID")
    .option("--name <name>", "new name")
    .option("--description <desc>", "new description")
    .action(withErrors(async (id, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);

      const body = {};
      if (opts.name) body.name = opts.name;
      if (opts.description) body.description = opts.description;

      const updated = await client.put(`/tools/${id}`, body);
      out.info(`Tool updated: ${id}`);
      out.success({ tool: updated });
    }));

  // ── rm ────────────────────────────────────────────────────
  tool
    .command("rm")
    .description("Delete a tool")
    .argument("<id>", "tool ID")
    .action(withErrors(async (id, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      await client.del(`/tools/${id}`);
      out.info(`Tool deleted: ${id}`);
      out.success({ deleted: id });
    }));
}
