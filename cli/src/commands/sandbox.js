import { createClient } from "../api.js";
import { createOutput } from "../output.js";
import { withErrors, requireProject, formatDate } from "../helpers.js";

export function registerSandbox(program) {
  const sbx = program
    .command("sandbox")
    .alias("sbx")
    .description("Code sandbox — manage sandbox endpoints and execute commands");

  // ── ls ────────────────────────────────────────────────────
  sbx
    .command("ls")
    .description("List sandbox endpoints")
    .action(withErrors(async (opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const projectId = requireProject(cmd);

      const data = await client.get("/sandbox-config", { project_id: projectId });
      const endpoints = Array.isArray(data) ? data : data?.items ?? [];

      out.table(
        endpoints.map((e) => ({
          id: (e.id ?? "").slice(0, 8),
          name: e.name ?? "-",
          type: e.type ?? "-",
          updated: formatDate(e.updated_at),
        })),
        [
          { key: "id", label: "ID" },
          { key: "name", label: "NAME" },
          { key: "type", label: "TYPE" },
          { key: "updated", label: "UPDATED" },
        ]
      );
      out.success({ endpoints });
    }));

  // ── create ────────────────────────────────────────────────
  sbx
    .command("create")
    .description("Create a sandbox endpoint")
    .argument("<name>", "endpoint name")
    .option("--type <type>", "sandbox type")
    .action(withErrors(async (name, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const projectId = requireProject(cmd);

      const body = { name, project_id: projectId };
      if (opts.type) body.type = opts.type;

      const created = await client.post("/sandbox-config", body);
      out.info(`Sandbox endpoint created: ${created.name ?? name} (${created.id})`);

      if (created.api_key || created.access_key) {
        const key = created.api_key ?? created.access_key;
        out.info("");
        out.info(`  Access Key: ${key}`);
        out.info("  (save this key — it won't be shown again)");
        out.info("");
        out.info("  Execute commands:");
        out.info(`    puppyone sandbox exec ${created.id} "echo hello"`);
      }
      out.success({ endpoint: created });
    }));

  // ── info ──────────────────────────────────────────────────
  sbx
    .command("info")
    .description("Show sandbox endpoint details")
    .argument("<id>", "endpoint ID")
    .action(withErrors(async (id, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const info = await client.get(`/sandbox-config/${id}`);

      out.kv([
        ["Name:", info.name],
        ["ID:", info.id],
        ["Type:", info.type ?? "-"],
        ["Created:", formatDate(info.created_at)],
        ["Updated:", formatDate(info.updated_at)],
      ]);
      out.success({ endpoint: info });
    }));

  // ── rm ────────────────────────────────────────────────────
  sbx
    .command("rm")
    .description("Delete a sandbox endpoint")
    .argument("<id>", "endpoint ID")
    .action(withErrors(async (id, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      await client.del(`/sandbox-config/${id}`);
      out.info(`Sandbox endpoint deleted: ${id}`);
      out.success({ deleted: id });
    }));

  // ── key ───────────────────────────────────────────────────
  sbx
    .command("key")
    .description("Regenerate API key for a sandbox endpoint")
    .argument("<id>", "endpoint ID")
    .action(withErrors(async (id, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const data = await client.post(`/sandbox-config/${id}/regenerate-key`);

      out.info("New API key generated:");
      out.info(`  ${data.api_key ?? data.access_key ?? data.key ?? JSON.stringify(data)}`);
      out.success({ endpoint_id: id, api_key: data.api_key ?? data.access_key ?? data.key });
    }));

  // ── exec ─────────────────────────────────────────────────
  sbx
    .command("exec")
    .description("Execute a command in a sandbox endpoint")
    .argument("<id>", "sandbox endpoint ID")
    .argument("<command>", "shell command to execute")
    .option("--key <key>", "access key (or auto-detect from endpoint info)")
    .action(withErrors(async (id, command, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);

      let accessKey = opts.key;
      if (!accessKey) {
        const info = await client.get(`/sandbox-config/${id}`);
        accessKey = info.access_key;
        if (!accessKey) {
          out.error("NO_KEY", "No access key found.", "Provide --key <access-key> or regenerate with `puppyone sandbox key " + id + "`.");
          return;
        }
      }

      const url = `${client.baseUrl}/api/v1/sandbox-endpoints/${id}/exec`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Access-Key": accessKey,
        },
        body: JSON.stringify({ command }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        out.error("EXEC_FAILED", `Execution failed (${res.status}): ${text}`);
        return;
      }

      const json = await res.json();
      const result = json.data ?? json;

      out.success?.({ result });

      if (result.stdout) out.raw(result.stdout);
      if (result.stderr) {
        out.warn("stderr:");
        out.raw(result.stderr);
      }
      if (result.exit_code != null && result.exit_code !== 0) {
        out.info(`  Exit code: ${result.exit_code}`);
      }
    }));
}
