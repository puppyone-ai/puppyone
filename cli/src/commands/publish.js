import { createClient } from "../api.js";
import { createOutput } from "../output.js";
import { withErrors, requireProject, formatDate } from "../helpers.js";

export function registerPublish(program) {
  const pub = program
    .command("publish")
    .description("Context publishing — create public JSON endpoints");

  // ── ls ────────────────────────────────────────────────────
  pub
    .command("ls")
    .description("List published endpoints")
    .action(withErrors(async (opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const projectId = requireProject(cmd);

      const data = await client.get("/publishes", { project_id: projectId });
      const publishes = Array.isArray(data) ? data : data?.items ?? [];

      out.table(
        publishes.map((p) => ({
          id: (p.id ?? "").slice(0, 8),
          key: p.publish_key ?? p.key ?? "-",
          node: p.node_name ?? p.node_id?.slice(0, 8) ?? "-",
          updated: formatDate(p.updated_at),
        })),
        [
          { key: "id", label: "ID" },
          { key: "key", label: "KEY" },
          { key: "node", label: "NODE" },
          { key: "updated", label: "UPDATED" },
        ]
      );
      out.success({ publishes });
    }));

  // ── create ────────────────────────────────────────────────
  pub
    .command("create")
    .description("Create a published endpoint")
    .argument("<node-id>", "content node ID to publish")
    .option("--key <key>", "custom publish key (slug)")
    .action(withErrors(async (nodeId, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const projectId = requireProject(cmd);

      const body = { node_id: nodeId, project_id: projectId };
      if (opts.key) body.publish_key = opts.key;

      const created = await client.post("/publishes", body);
      const key = created.publish_key ?? created.key;
      out.info(`Published: ${key}`);
      out.info(`  Public URL: /p/${key}`);
      out.success({ publish: created });
    }));

  // ── rm ────────────────────────────────────────────────────
  pub
    .command("rm")
    .description("Delete a published endpoint")
    .argument("<id>", "publish ID")
    .action(withErrors(async (id, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      await client.del(`/publishes/${id}`);
      out.info(`Publish deleted: ${id}`);
      out.success({ deleted: id });
    }));

  // ── url ───────────────────────────────────────────────────
  pub
    .command("url")
    .description("Get the public URL for a publish")
    .argument("<key>", "publish key")
    .action(withErrors(async (key, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const data = await client.get(`/publishes/p/${key}`);
      out.raw(JSON.stringify(data, null, 2));
      out.success({ data });
    }));
}
