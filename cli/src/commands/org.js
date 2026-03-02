import { createClient } from "../api.js";
import { createOutput } from "../output.js";
import { loadConfig, saveConfig } from "../config.js";
import { withErrors, requireOrg, formatDate } from "../helpers.js";

export function registerOrg(program) {
  const org = program
    .command("org")
    .description("Organization management");

  org
    .command("ls")
    .description("List your organizations")
    .action(withErrors(async (opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const data = await client.get("/organizations");
      const orgs = Array.isArray(data) ? data : data?.items ?? [];

      const config = loadConfig();
      const activeId = config.active_org?.id;

      out.table(
        orgs.map((o) => ({
          active: o.id === activeId ? "*" : "",
          name: o.name,
          id: o.id,
          role: o.role ?? "-",
          members: o.member_count ?? "-",
        })),
        [
          { key: "active", label: " " },
          { key: "name", label: "NAME" },
          { key: "id", label: "ID" },
          { key: "role", label: "ROLE" },
          { key: "members", label: "MEMBERS" },
        ]
      );
      out.success({ organizations: orgs });
    }));

  org
    .command("create")
    .description("Create a new organization")
    .argument("<name>", "organization name")
    .action(withErrors(async (name, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const created = await client.post("/organizations", { name });
      out.info(`Organization created: ${created.name} (${created.id})`);
      out.success({ organization: created });
    }));

  org
    .command("use")
    .description("Set the active organization")
    .argument("<id-or-name>", "organization ID or name")
    .action(withErrors(async (idOrName, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const data = await client.get("/organizations");
      const orgs = Array.isArray(data) ? data : data?.items ?? [];

      const match = orgs.find((o) => o.id === idOrName || o.name === idOrName);
      if (!match) {
        out.error("NOT_FOUND", `Organization not found: ${idOrName}`, "Run `puppyone org ls` to see available orgs.");
        return;
      }

      saveConfig({ active_org: { id: match.id, name: match.name } });
      out.info(`Active organization: ${match.name} (${match.id})`);
      out.success({ active_org: { id: match.id, name: match.name } });
    }));

  org
    .command("current")
    .description("Show the active organization")
    .action(withErrors(async (opts, cmd) => {
      const out = createOutput(cmd);
      const config = loadConfig();
      if (!config.active_org) {
        out.info("No active organization. Run `puppyone org use <name>` to set one.");
      } else {
        out.kv([
          ["Name:", config.active_org.name],
          ["ID:", config.active_org.id],
        ]);
      }
      out.success({ active_org: config.active_org ?? null });
    }));

  org
    .command("info")
    .description("Show organization details")
    .argument("[id]", "organization ID (defaults to active)")
    .action(withErrors(async (id, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const orgId = id || requireOrg(cmd);
      const info = await client.get(`/organizations/${orgId}`);

      out.kv([
        ["Name:", info.name],
        ["ID:", info.id],
        ["Created:", formatDate(info.created_at)],
      ]);
      out.success({ organization: info });
    }));

  org
    .command("members")
    .description("List organization members")
    .argument("[id]", "organization ID (defaults to active)")
    .action(withErrors(async (id, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const orgId = id || requireOrg(cmd);
      const data = await client.get(`/organizations/${orgId}/members`);
      const members = Array.isArray(data) ? data : data?.items ?? [];

      out.table(
        members.map((m) => ({
          email: m.email ?? m.user_email ?? "-",
          role: m.role ?? "-",
          joined: formatDate(m.created_at),
        })),
        [
          { key: "email", label: "EMAIL" },
          { key: "role", label: "ROLE" },
          { key: "joined", label: "JOINED" },
        ]
      );
      out.success({ members });
    }));

  org
    .command("invite")
    .description("Invite a member to the organization")
    .argument("<email>", "email to invite")
    .option("-r, --role <role>", "member role (member|admin)", "member")
    .argument("[id]", "organization ID (defaults to active)")
    .action(withErrors(async (email, id, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const orgId = id || requireOrg(cmd);
      const result = await client.post(`/organizations/${orgId}/invite`, {
        email,
        role: opts.role,
      });
      out.info(`Invitation sent to ${email}`);
      out.success({ invitation: result });
    }));

  org
    .command("rm")
    .description("Delete an organization (owner only)")
    .argument("<id>", "organization ID")
    .action(withErrors(async (id, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      await client.del(`/organizations/${id}`);

      const config = loadConfig();
      if (config.active_org?.id === id) {
        saveConfig({ active_org: null });
      }

      out.info(`Organization deleted: ${id}`);
      out.success({ deleted: id });
    }));

  org
    .command("update")
    .description("Update organization name")
    .argument("[id]", "organization ID (defaults to active)")
    .option("--name <name>", "new name")
    .action(withErrors(async (id, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const orgId = id || requireOrg(cmd);

      const body = {};
      if (opts.name) body.name = opts.name;

      const updated = await client.put(`/organizations/${orgId}`, body);
      out.info(`Organization updated: ${updated.name ?? orgId}`);

      const config = loadConfig();
      if (opts.name && config.active_org?.id === orgId) {
        saveConfig({ active_org: { id: orgId, name: opts.name } });
      }

      out.success({ organization: updated });
    }));

  org
    .command("remove-member")
    .description("Remove a member from the organization")
    .argument("<user-id>", "user ID to remove")
    .argument("[org-id]", "organization ID (defaults to active)")
    .action(withErrors(async (userId, orgId, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const resolvedOrgId = orgId || requireOrg(cmd);

      await client.del(`/organizations/${resolvedOrgId}/members/${userId}`);
      out.info(`Member removed: ${userId}`);
      out.success({ removed: userId });
    }));

  org
    .command("set-role")
    .description("Change a member's role")
    .argument("<user-id>", "user ID")
    .argument("<role>", "new role (member, admin, owner)")
    .argument("[org-id]", "organization ID (defaults to active)")
    .action(withErrors(async (userId, role, orgId, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const resolvedOrgId = orgId || requireOrg(cmd);

      await client.put(`/organizations/${resolvedOrgId}/members/${userId}/role`, { role });
      out.info(`Role updated: ${userId} → ${role}`);
      out.success({ user_id: userId, role });
    }));

  org
    .command("leave")
    .description("Leave an organization")
    .argument("[org-id]", "organization ID (defaults to active)")
    .action(withErrors(async (orgId, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const resolvedOrgId = orgId || requireOrg(cmd);

      await client.post(`/organizations/${resolvedOrgId}/leave`);

      const config = loadConfig();
      if (config.active_org?.id === resolvedOrgId) {
        saveConfig({ active_org: null });
      }

      out.info("Left the organization.");
      out.success({ left: resolvedOrgId });
    }));
}
