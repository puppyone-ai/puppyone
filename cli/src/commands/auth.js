/**
 * puppyone auth <subcommand>
 *
 * Subcommands:
 *   login   — Sign in with email + password (or direct token)
 *   logout  — Clear saved credentials
 *   whoami  — Show current identity + active project
 */

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { saveConfig, clearConfig, loadConfig } from "../config.js";
import { createOutput } from "../output.js";
import { version as cliVersion } from "../version.js";

async function prompt(question) {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

// ============================================================
// Action handlers (exported for reuse by legacy top-level aliases)
// ============================================================

export async function loginAction(opts, cmd) {
  const out = createOutput(cmd);

  const config = loadConfig();
  const parentOpts = cmd.parent?.opts?.() ?? {};
  const rootOpts = cmd.parent?.parent?.opts?.() ?? {};
  const apiUrl = (
    opts.apiUrl ?? parentOpts.apiUrl ?? rootOpts.apiUrl
    ?? config.api_url ?? "http://localhost:9090"
  ).replace(/\/+$/, "");

  if (opts.apiKey ?? parentOpts.apiKey ?? rootOpts.apiKey) {
    const key = opts.apiKey ?? parentOpts.apiKey ?? rootOpts.apiKey;
    saveConfig({ api_url: apiUrl, api_key: key });
    out.info(`Logged in (token mode).`);
    out.info(`  API: ${apiUrl}`);
    out.success({ api_url: apiUrl, mode: "token" });
    return;
  }

  let email = opts.email;
  let password = opts.password;

  if (!email) email = await prompt("Email: ");
  if (!password) password = await prompt("Password: ");

  if (!email || !password) {
    out.error("MISSING_CREDENTIALS", "Email and password are required.");
    return;
  }

  out.step("Logging in...");

  try {
    const res = await fetch(`${apiUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let detail = text;
      try {
        const parsed = JSON.parse(text);
        detail = parsed.detail ?? parsed.message ?? text;
      } catch {}
      out.done("");
      out.error("AUTH_FAILED", detail, "Check your email and password.");
      return;
    }

    const json = await res.json();
    if (json.code !== 0 || !json.data) {
      out.done("");
      out.error("AUTH_FAILED", json.message ?? "Login failed");
      return;
    }

    const { access_token, refresh_token, expires_in, user_email } = json.data;

    const tokenExpiresAt = Math.floor(Date.now() / 1000) + (expires_in || 3600);

    saveConfig({
      api_url: apiUrl,
      api_key: access_token,
      refresh_token,
      user_email,
      token_expires_at: tokenExpiresAt,
    });

    out.done("✓");
    out.info(`\n  Logged in as ${user_email}`);
    out.info(`  API: ${apiUrl}`);

    out.success({
      user_email,
      api_url: apiUrl,
    });

  } catch (e) {
    out.done("");
    if (e.cause?.code === "ECONNREFUSED" || e.message?.includes("fetch")) {
      out.error("API_UNREACHABLE", `Cannot reach ${apiUrl}`, "Check the API URL and make sure the server is running.");
    } else {
      out.error("AUTH_FAILED", e.message);
    }
  }
}

export function logoutAction(opts, cmd) {
  const out = createOutput(cmd);
  const config = loadConfig();
  saveConfig({
    api_key: null,
    refresh_token: null,
    user_email: null,
    token_expires_at: null,
  });
  out.info("Logged out. Credentials cleared.");
  out.success({ message: "logged_out" });
}

export async function whoamiAction(opts, cmd) {
  const out = createOutput(cmd);
  const config = loadConfig();

  if (!config.api_key) {
    out.error("NOT_AUTHENTICATED", "Not logged in.", "Run `puppyone auth login` first.");
    return;
  }

  const email = config.user_email ?? "unknown";
  const project = config.active_project;

  out.info(`  User:      ${email}`);
  out.info(`  API:       ${config.api_url}`);

  try {
    const res = await fetch(`${config.api_url}/health`);
    out.info(`  Server:    ${res.ok ? "reachable ✓" : `responded with ${res.status}`}`);
  } catch {
    out.info(`  Server:    unreachable ✗`);
  }

  if (project) {
    out.info(`  Project:   ${project.name} (${project.id})`);
  } else {
    out.info(`  Project:   (none — run \`puppyone project use <name>\`)`);
  }

  out.info(`  CLI:       ${cliVersion}`);

  out.success({
    user_email: email,
    api_url: config.api_url,
    active_project: project ?? null,
    cli_version: cliVersion,
  });
}

// ============================================================
// Register: puppyone auth <subcommand>
// ============================================================

export function registerAuth(program) {
  const auth = program
    .command("auth")
    .description("Authentication — login, logout, identity");

  auth
    .command("login")
    .description("Log in to PuppyOne with email and password")
    .option("-e, --email <email>", "email address")
    .option("-p, --password <password>", "password")
    .option("-u, --api-url <url>", "PuppyOne API URL")
    .option("-k, --api-key <key>", "directly provide access token (skip login)")
    .action(loginAction);

  auth
    .command("logout")
    .description("Clear saved credentials")
    .action(logoutAction);

  auth
    .command("whoami")
    .description("Show current login status and active project")
    .action(whoamiAction);
}

// ============================================================
// Register legacy top-level aliases (hidden from --help)
// ============================================================

export function registerLegacyAuthAliases(program) {
  program
    .command("login", { hidden: true })
    .description("(alias for `auth login`)")
    .option("-e, --email <email>", "email address")
    .option("-p, --password <password>", "password")
    .option("-u, --api-url <url>", "PuppyOne API URL")
    .option("-k, --api-key <key>", "directly provide access token")
    .action(loginAction);

  program
    .command("logout", { hidden: true })
    .description("(alias for `auth logout`)")
    .action(logoutAction);

  program
    .command("whoami", { hidden: true })
    .description("(alias for `auth whoami`)")
    .action(whoamiAction);
}
