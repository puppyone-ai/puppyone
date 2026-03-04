/**
 * puppyone init
 *
 * One-command setup for new users:
 *   1. Authenticate (email/password or open browser)
 *   2. Resolve or create an organization
 *   3. Create a project with seed content
 *   4. Set as active project
 *   5. Print next steps
 */

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { loadConfig, saveConfig } from "../config.js";
import { createOutput } from "../output.js";
import { createClient } from "../api.js";

async function prompt(question) {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

async function ensureAuth(out, cmd) {
  const config = loadConfig();
  if (config.api_key) {
    const apiUrl = config.api_url || "http://localhost:9090";
    try {
      const res = await fetch(`${apiUrl}/health`);
      if (res.ok) return true;
    } catch {}
  }

  out.info("");
  out.info("  You need to log in first.");
  out.info("");

  const email = await prompt("  Email: ");
  const password = await prompt("  Password: ");

  if (!email || !password) {
    out.error("MISSING_CREDENTIALS", "Email and password are required.");
    return false;
  }

  const apiUrl = config.api_url || "http://localhost:9090";

  try {
    const res = await fetch(`${apiUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let detail = text;
      try { detail = JSON.parse(text).detail ?? text; } catch {}
      out.error("AUTH_FAILED", detail, "Check your email and password.");
      return false;
    }

    const json = await res.json();
    if (json.code !== 0 || !json.data) {
      out.error("AUTH_FAILED", json.message ?? "Login failed");
      return false;
    }

    const { access_token, refresh_token, expires_in, user_email } = json.data;
    saveConfig({
      api_url: apiUrl,
      api_key: access_token,
      refresh_token,
      user_email,
      token_expires_at: Math.floor(Date.now() / 1000) + (expires_in || 3600),
    });

    out.info(`  Logged in as ${user_email}`);
    return true;
  } catch (e) {
    if (e.cause?.code === "ECONNREFUSED" || e.message?.includes("fetch")) {
      out.error("API_UNREACHABLE", `Cannot reach ${apiUrl}`, "Check the API URL and make sure the server is running.");
    } else {
      out.error("AUTH_FAILED", e.message);
    }
    return false;
  }
}

async function ensureOrg(client, out) {
  const config = loadConfig();
  if (config.active_org?.id) return config.active_org.id;

  const data = await client.get("/organizations");
  const orgs = Array.isArray(data) ? data : data?.items ?? [];

  if (orgs.length === 0) {
    out.error("NO_ORG", "No organization found.", "Create one at app.puppyone.com or run `puppyone org create <name>`.");
    return null;
  }

  const org = orgs[0];
  saveConfig({ active_org: { id: org.id, name: org.name } });
  return org.id;
}

export function registerInit(program) {
  program
    .command("init")
    .description("Set up PuppyOne — log in, create a project, and get started")
    .argument("[name]", "project name", "My Context Space")
    .option("-d, --description <desc>", "project description")
    .option("--no-seed", "skip creating default Getting Started content")
    .action(async (name, opts, cmd) => {
      const out = createOutput(cmd);

      out.info("");
      out.info("  PuppyOne — cloud file system for AI Agents");
      out.info("  ─────────────────────────────────────────");
      out.info("");

      // 1. Auth
      const authed = await ensureAuth(out, cmd);
      if (!authed) return;

      let client;
      try {
        client = createClient(cmd);
      } catch (e) {
        out.error("AUTH_FAILED", e.message, e.hint);
        return;
      }

      // 2. Org
      const orgId = await ensureOrg(client, out);
      if (!orgId) return;

      // 3. Create project with seed content
      out.info("");
      out.step("Creating project...");

      try {
        const project = await client.post("/projects", {
          name,
          description: opts.description ?? null,
          org_id: orgId,
          seed: opts.seed !== false,
        });

        saveConfig({ active_project: { id: project.id, name: project.name } });
        out.done("done");

        // 4. Print summary
        out.info("");
        out.info(`  Project:  ${project.name}`);
        out.info(`  ID:       ${project.id}`);
        if (project.nodes?.length) {
          out.info(`  Content:  ${project.nodes.length} nodes created`);
        }

        // 5. Next steps
        out.info("");
        out.info("  Next step — sync a local folder:");
        out.info("");
        out.info("    puppyone access up <folder>");
        out.info("");

        out.success({
          project: { id: project.id, name: project.name },
          seeded: opts.seed !== false,
        });
      } catch (e) {
        out.done("");
        const { ApiError } = await import("../api.js");
        if (e instanceof ApiError) {
          out.error(e.code, e.message, e.hint);
        } else {
          out.error("UNEXPECTED", e.message);
        }
      }
    });
}
