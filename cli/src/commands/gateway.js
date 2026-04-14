/**
 * puppyone gateway <subcommand>
 *
 * Manage third-party account bindings (OAuth, database credentials).
 * Gateways live at the org level and can be reused across projects.
 *
 * Subcommands:
 *   connect <provider>     Connect a third-party account (OAuth or credentials)
 *   ls                     List all gateways
 *   info <id>              Show gateway details
 *   rm <id>                Delete a gateway
 *   refresh <id>           Refresh OAuth token
 *   providers              List available providers
 */

import { createClient } from "../api.js";
import { createOutput } from "../output.js";
import { withErrors, formatDate } from "../helpers.js";

const STATUS_ICONS = { active: "●", expired: "○", revoked: "✗" };
function statusLabel(s) { return `${STATUS_ICONS[s] || "●"} ${s}`; }

export function registerGateway(program) {
  const gateway = program
    .command("gateway")
    .description("Manage third-party account connections (OAuth, databases)");

  // ── providers ──

  gateway
    .command("providers")
    .description("List available gateway providers")
    .action(withErrors(async (opts, cmd) => {
      const out = createOutput(cmd);
      const api = createClient(cmd);
      const data = await api.get("/gateways/providers");

      if (out.json) { out.success(data); return; }

      out.table(
        ["Provider", "Name", "Auth"],
        (data || []).map(p => [p.provider, p.display_name, p.auth]),
      );
    }));

  // ── connect ──

  gateway
    .command("connect")
    .description("Connect a third-party account")
    .argument("<provider>", "Provider: gmail, github, notion, database, ...")
    .option("--name <name>", "Display name for this connection")
    .option("--set <kv...>", "Key=value pairs for credentials (database)")
    .action(withErrors(async (provider, opts, cmd) => {
      const out = createOutput(cmd);
      const api = createClient(cmd);

      // For OAuth providers: get authorize URL and open browser
      const oauthProviders = new Set([
        "gmail", "github", "notion", "google_drive", "google_docs",
        "google_sheets", "google_calendar", "google_search_console",
        "linear", "airtable",
      ]);

      if (oauthProviders.has(provider)) {
        const data = await api.get(`/gateways/${provider}/authorize`);
        const url = data?.authorize_url;
        if (url) {
          out.info(`Opening browser for ${provider} authorization...`);
          out.info(`URL: ${url}`);
          // Try to open browser
          const { exec } = await import("child_process");
          const cmd = process.platform === "darwin" ? "open" :
                      process.platform === "win32" ? "start" : "xdg-open";
          exec(`${cmd} "${url}"`);
          out.info("Complete the authorization in your browser.");
          out.info("The gateway will be created automatically after authorization.");
        } else {
          out.error(`Could not get authorization URL for ${provider}`);
        }
        return;
      }

      // For manual providers (database): create directly with credentials
      const credentials = {};
      if (opts.set) {
        for (const kv of opts.set) {
          const [k, ...rest] = kv.split("=");
          credentials[k] = rest.join("=");
        }
      }

      const data = await api.post("/gateways", {
        provider,
        name: opts.name || provider,
        credentials,
        metadata: {},
      });

      if (out.json) { out.success(data); return; }
      out.success(`Gateway created: ${data.id}`);
      out.info(`  Provider: ${data.provider}`);
      out.info(`  Name: ${data.name}`);
    }));

  // ── ls ──

  gateway
    .command("ls")
    .description("List all gateways in the current organization")
    .option("--provider <provider>", "Filter by provider")
    .action(withErrors(async (opts, cmd) => {
      const out = createOutput(cmd);
      const api = createClient(cmd);
      const params = {};
      if (opts.provider) params.provider = opts.provider;
      const data = await api.get("/gateways", params);

      if (out.json) { out.success(data); return; }

      if (!data || data.length === 0) {
        out.info("No gateways found. Use 'puppyone gateway connect <provider>' to add one.");
        return;
      }

      out.table(
        ["ID", "Provider", "Name", "Status", "Created"],
        data.map(g => [
          g.id.slice(0, 12) + "...",
          g.provider,
          g.name || "—",
          statusLabel(g.status),
          formatDate(g.created_at),
        ]),
      );
    }));

  // ── info ──

  gateway
    .command("info")
    .description("Show gateway details")
    .argument("<id>", "Gateway ID")
    .action(withErrors(async (id, opts, cmd) => {
      const out = createOutput(cmd);
      const api = createClient(cmd);
      const data = await api.get(`/gateways/${id}`);

      if (out.json) { out.success(data); return; }

      out.info(`Gateway: ${data.id}`);
      out.info(`Provider:     ${data.provider}`);
      out.info(`Name:         ${data.name || "—"}`);
      out.info(`Status:       ${statusLabel(data.status)}`);
      out.info(`Credentials:  ${data.has_credentials ? "✓ configured" : "✗ missing"}`);
      if (data.credential_keys?.length) {
        out.info(`  Keys: ${data.credential_keys.join(", ")}`);
      }
      out.info(`Access Points: ${data.access_point_count}`);
      out.info(`Created:      ${formatDate(data.created_at)}`);
    }));

  // ── rm ──

  gateway
    .command("rm")
    .description("Delete a gateway (must have no linked access points)")
    .argument("<id>", "Gateway ID")
    .action(withErrors(async (id, opts, cmd) => {
      const out = createOutput(cmd);
      const api = createClient(cmd);
      await api.del(`/gateways/${id}`);
      out.success("Gateway deleted");
    }));

  // ── refresh ──

  gateway
    .command("refresh")
    .description("Refresh OAuth token for a gateway")
    .argument("<id>", "Gateway ID")
    .action(withErrors(async (id, opts, cmd) => {
      const out = createOutput(cmd);
      const api = createClient(cmd);
      const data = await api.post(`/gateways/${id}/refresh-token`);
      if (out.json) { out.success(data); return; }
      out.success("Token refreshed");
    }));
}
