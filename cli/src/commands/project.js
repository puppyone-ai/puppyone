import { createClient } from "../api.js";
import { createOutput } from "../output.js";
import { loadConfig, saveConfig } from "../config.js";
import { withErrors, requireOrg, formatDate } from "../helpers.js";

export function registerProject(program) {
  const proj = program
    .command("project")
    .alias("p")
    .description("Project management");

  proj
    .command("ls")
    .description("List projects in the active organization")
    .action(withErrors(async (opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const orgId = requireOrg(cmd);
      const data = await client.get("/projects", { org_id: orgId });
      const projects = Array.isArray(data) ? data : data?.items ?? [];

      const config = loadConfig();
      const activeId = config.active_project?.id;

      out.table(
        projects.map((p) => ({
          active: p.id === activeId ? "*" : "",
          name: p.name,
          id: p.id,
          updated: formatDate(p.updated_at),
        })),
        [
          { key: "active", label: " " },
          { key: "name", label: "NAME" },
          { key: "id", label: "ID" },
          { key: "updated", label: "UPDATED" },
        ]
      );
      out.success({ projects });
    }));

  proj
    .command("create")
    .description("Create a new project")
    .argument("<name>", "project name")
    .option("-d, --description <desc>", "project description")
    .action(withErrors(async (name, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const orgId = requireOrg(cmd);
      const created = await client.post("/projects", {
        name,
        description: opts.description,
        org_id: orgId,
      });
      out.info(`Project created: ${created.name} (${created.id})`);
      out.success({ project: created });
    }));

  proj
    .command("use")
    .description("Set the active project")
    .argument("<id-or-name>", "project ID or name")
    .action(withErrors(async (idOrName, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const orgId = requireOrg(cmd);
      const data = await client.get("/projects", { org_id: orgId });
      const projects = Array.isArray(data) ? data : data?.items ?? [];

      const match = projects.find((p) => p.id === idOrName || p.name === idOrName);
      if (!match) {
        out.error("NOT_FOUND", `Project not found: ${idOrName}`, "Run `puppyone project ls` to see available projects.");
        return;
      }

      saveConfig({ active_project: { id: match.id, name: match.name } });
      out.info(`Active project: ${match.name} (${match.id})`);
      out.success({ active_project: { id: match.id, name: match.name } });
    }));

  proj
    .command("current")
    .description("Show the active project")
    .action(withErrors(async (opts, cmd) => {
      const out = createOutput(cmd);
      const config = loadConfig();
      if (!config.active_project) {
        out.info("No active project. Run `puppyone project use <name>` to set one.");
      } else {
        out.kv([
          ["Name:", config.active_project.name],
          ["ID:", config.active_project.id],
        ]);
      }
      out.success({ active_project: config.active_project ?? null });
    }));

  proj
    .command("info")
    .description("Show project details")
    .argument("[id]", "project ID (defaults to active)")
    .action(withErrors(async (id, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const config = loadConfig();
      const projectId = id || config.active_project?.id;
      if (!projectId) {
        out.error("NO_PROJECT", "No project specified.", "Run `puppyone project use <name>` first.");
        return;
      }

      const info = await client.get(`/projects/${projectId}`);

      out.kv([
        ["Name:", info.name],
        ["ID:", info.id],
        ["Description:", info.description ?? "(none)"],
        ["Created:", formatDate(info.created_at)],
        ["Updated:", formatDate(info.updated_at)],
      ]);

      if (info.root_nodes?.length) {
        out.info("\n  Root nodes:");
        for (const n of info.root_nodes) {
          out.info(`    ${n.type === "folder" ? "📁" : "📄"} ${n.name}`);
        }
      }

      out.success({ project: info });
    }));

  proj
    .command("update")
    .description("Update project name or description")
    .argument("[id]", "project ID (defaults to active)")
    .option("--name <name>", "new project name")
    .option("-d, --description <desc>", "new description")
    .action(withErrors(async (id, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const config = loadConfig();
      const projectId = id || config.active_project?.id;
      if (!projectId) {
        out.error("NO_PROJECT", "No project specified.", "Run `puppyone project use <name>` first.");
        return;
      }

      const body = {};
      if (opts.name) body.name = opts.name;
      if (opts.description) body.description = opts.description;

      const updated = await client.put(`/projects/${projectId}`, body);
      out.info(`Project updated: ${updated.name ?? projectId}`);

      if (opts.name && config.active_project?.id === projectId) {
        saveConfig({ active_project: { id: projectId, name: opts.name } });
      }

      out.success({ project: updated });
    }));

  proj
    .command("rm")
    .description("Delete a project")
    .argument("<id>", "project ID")
    .action(withErrors(async (id, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      await client.del(`/projects/${id}`);

      const config = loadConfig();
      if (config.active_project?.id === id) {
        saveConfig({ active_project: null });
      }

      out.info(`Project deleted: ${id}`);
      out.success({ deleted: id });
    }));
}
