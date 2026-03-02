import { createClient } from "../api.js";
import { createOutput } from "../output.js";
import { withErrors, requireProject, formatDate } from "../helpers.js";

export function registerMcp(program) {
  const mcp = program
    .command("mcp")
    .description("MCP server management — endpoints, keys, and tool bindings");

  // ── ls ────────────────────────────────────────────────────
  mcp
    .command("ls")
    .description("List MCP endpoints")
    .action(withErrors(async (opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const projectId = requireProject(cmd);

      const data = await client.get("/mcp-config", { project_id: projectId });
      const endpoints = Array.isArray(data) ? data : data?.items ?? [];

      out.table(
        endpoints.map((e) => ({
          id: (e.id ?? "").slice(0, 8),
          name: e.name ?? "-",
          url: e.url ?? e.endpoint_url ?? "-",
          updated: formatDate(e.updated_at),
        })),
        [
          { key: "id", label: "ID" },
          { key: "name", label: "NAME" },
          { key: "url", label: "URL" },
          { key: "updated", label: "UPDATED" },
        ]
      );
      out.success({ endpoints });
    }));

  // ── create ────────────────────────────────────────────────
  mcp
    .command("create")
    .description("Create an MCP endpoint")
    .argument("<name>", "endpoint name")
    .option("--url <url>", "MCP server URL")
    .action(withErrors(async (name, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const projectId = requireProject(cmd);

      const body = { name, project_id: projectId };
      if (opts.url) body.url = opts.url;

      const created = await client.post("/mcp-config", body);
      out.info(`MCP endpoint created: ${created.name ?? name} (${created.id})`);

      if (created.api_key) {
        out.info(`  API Key: ${created.api_key}`);
        out.info("  (save this key — it won't be shown again)");
      }

      out.success({ endpoint: created });
    }));

  // ── info ──────────────────────────────────────────────────
  mcp
    .command("info")
    .description("Show MCP endpoint details")
    .argument("<id>", "endpoint ID")
    .action(withErrors(async (id, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const info = await client.get(`/mcp-config/${id}`);

      out.kv([
        ["Name:", info.name],
        ["ID:", info.id],
        ["URL:", info.url ?? info.endpoint_url ?? "-"],
        ["Created:", formatDate(info.created_at)],
        ["Updated:", formatDate(info.updated_at)],
      ]);

      if (info.accesses?.length) {
        out.info("\n  Access bindings:");
        for (const a of info.accesses) {
          out.info(`    - ${a.name ?? a.agent_id ?? a.id}`);
        }
      }

      out.success({ endpoint: info });
    }));

  // ── update ────────────────────────────────────────────────
  mcp
    .command("update")
    .description("Update MCP endpoint")
    .argument("<id>", "endpoint ID")
    .option("--name <name>", "new name")
    .option("--url <url>", "new URL")
    .action(withErrors(async (id, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);

      const body = {};
      if (opts.name) body.name = opts.name;
      if (opts.url) body.url = opts.url;

      const updated = await client.put(`/mcp-config/${id}`, body);
      out.info(`MCP endpoint updated: ${id}`);
      out.success({ endpoint: updated });
    }));

  // ── rm ────────────────────────────────────────────────────
  mcp
    .command("rm")
    .description("Delete an MCP endpoint")
    .argument("<id>", "endpoint ID")
    .action(withErrors(async (id, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      await client.del(`/mcp-config/${id}`);
      out.info(`MCP endpoint deleted: ${id}`);
      out.success({ deleted: id });
    }));

  // ── key ───────────────────────────────────────────────────
  mcp
    .command("key")
    .description("Regenerate API key for an MCP endpoint")
    .argument("<id>", "endpoint ID")
    .action(withErrors(async (id, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const data = await client.post(`/mcp-config/${id}/regenerate-key`);

      out.info("New API key generated:");
      out.info(`  ${data.api_key ?? data.key ?? JSON.stringify(data)}`);
      out.info("  (save this key — it won't be shown again)");
      out.success({ endpoint_id: id, api_key: data.api_key ?? data.key });
    }));

  // ── tools ─────────────────────────────────────────────────
  mcp
    .command("tools")
    .description("List tools bound to an agent via MCP")
    .argument("<agent-id>", "agent ID")
    .action(withErrors(async (agentId, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const data = await client.get(`/mcp/agents/${agentId}/tools`);
      const tools = Array.isArray(data) ? data : data?.items ?? [];

      out.table(
        tools.map((t) => ({
          id: (t.tool_id ?? t.id ?? "").slice(0, 8),
          name: t.name ?? "-",
          type: t.type ?? "-",
        })),
        [
          { key: "id", label: "ID" },
          { key: "name", label: "NAME" },
          { key: "type", label: "TYPE" },
        ]
      );
      out.success({ tools });
    }));

  // ── bind ──────────────────────────────────────────────────
  mcp
    .command("bind")
    .description("Bind a tool to an agent via MCP")
    .argument("<agent-id>", "agent ID")
    .argument("<tool-id>", "tool ID to bind")
    .action(withErrors(async (agentId, toolId, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const result = await client.post(`/mcp/agents/${agentId}/tools`, {
        tool_ids: [toolId],
      });
      out.info(`Tool ${toolId} bound to agent ${agentId}`);
      out.success({ result });
    }));

  // ── unbind ────────────────────────────────────────────────
  mcp
    .command("unbind")
    .description("Unbind a tool from an agent")
    .argument("<agent-id>", "agent ID")
    .argument("<tool-id>", "tool ID to unbind")
    .action(withErrors(async (agentId, toolId, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      await client.del(`/mcp/agents/${agentId}/tools/${toolId}`);
      out.info(`Tool ${toolId} unbound from agent ${agentId}`);
      out.success({ unbound: toolId });
    }));
}
