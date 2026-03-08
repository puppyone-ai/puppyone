/**
 * puppyone auth <subcommand>
 *
 * Subcommands:
 *   login   — Sign in (interactive target selection on first run)
 *   logout  — Clear credentials for the current target
 *   whoami  — Show current identity, target, and saved sessions
 *   targets — List / switch / remove saved targets
 */

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import {
  saveConfig,
  loadConfig,
  getTargetAuth,
  switchTarget,
  listTargets,
  removeTarget,
  CLOUD_API_URL,
  LOCAL_API_URL,
} from "../config.js";
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

function _targetLabel(url) {
  if (url === CLOUD_API_URL) return `PuppyOne Cloud (${url})`;
  if (url === LOCAL_API_URL) return `Local (${url})`;
  return url;
}

// ── Interactive target selection (first-run) ─────────────────

async function _promptTargetSelection() {
  console.log("");
  console.log("  Where do you want to connect?");
  console.log("");
  console.log("    1) PuppyOne Cloud");
  console.log(`    2) Local self-hosted (${LOCAL_API_URL})`);
  console.log("    3) Custom URL");
  console.log("");

  const choice = await prompt("  Enter choice [1-3]: ");
  switch (choice.trim()) {
    case "1":
      return CLOUD_API_URL;
    case "2":
      return LOCAL_API_URL;
    case "3": {
      const url = await prompt("  API URL: ");
      return url?.trim().replace(/\/+$/, "") || null;
    }
    default:
      return null;
  }
}

// ============================================================
// Action handlers
// ============================================================

export async function loginAction(opts, cmd) {
  const out = createOutput(cmd);
  const config = loadConfig();
  const parentOpts = cmd.parent?.opts?.() ?? {};
  const rootOpts = cmd.parent?.parent?.opts?.() ?? {};

  // 1. Resolve API URL from explicit flags
  let apiUrl = opts.apiUrl ?? parentOpts.apiUrl ?? rootOpts.apiUrl ?? null;
  if (apiUrl) {
    apiUrl = apiUrl.replace(/\/+$/, "");
  }

  // 2. No explicit URL and no saved target → interactive selection
  if (!apiUrl && !config.api_url) {
    apiUrl = await _promptTargetSelection();
    if (!apiUrl) {
      out.error("CANCELLED", "No target selected.");
      return;
    }
  }

  apiUrl = apiUrl ?? config.api_url;

  // 3. Token mode (CI / scripts)
  if (opts.apiKey ?? parentOpts.apiKey ?? rootOpts.apiKey) {
    const key = opts.apiKey ?? parentOpts.apiKey ?? rootOpts.apiKey;
    saveConfig({ api_url: apiUrl, api_key: key });
    out.info(`Logged in (token mode).`);
    out.info(`  API: ${apiUrl}`);
    out.success({ api_url: apiUrl, mode: "token" });
    return;
  }

  // 4. Switching to a different target that has a cached session
  if (apiUrl !== config.api_url) {
    const cached = getTargetAuth(apiUrl);
    if (cached?.api_key) {
      const isExpired =
        cached.token_expires_at &&
        Date.now() / 1000 > cached.token_expires_at;

      if (!isExpired) {
        switchTarget(apiUrl);
        out.info(`\n  Switched to ${_targetLabel(apiUrl)}`);
        out.info(`  Logged in as ${cached.user_email ?? "unknown"} (cached session)`);
        out.success({
          api_url: apiUrl,
          user_email: cached.user_email,
          mode: "cached",
        });
        return;
      }
    }
  }

  // 5. Normal email/password login
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
    out.info(`  API: ${_targetLabel(apiUrl)}`);

    out.success({
      user_email,
      api_url: apiUrl,
    });
  } catch (e) {
    out.done("");
    if (e.cause?.code === "ECONNREFUSED" || e.message?.includes("fetch")) {
      out.error(
        "API_UNREACHABLE",
        `Cannot reach ${apiUrl}`,
        "Check the API URL and make sure the server is running."
      );
    } else {
      out.error("AUTH_FAILED", e.message);
    }
  }
}

export function logoutAction(opts, cmd) {
  const out = createOutput(cmd);
  const config = loadConfig();
  const apiUrl = config.api_url;

  saveConfig({
    api_key: null,
    refresh_token: null,
    user_email: null,
    token_expires_at: null,
  });

  if (apiUrl) {
    out.info(`Logged out from ${_targetLabel(apiUrl)}.`);
  } else {
    out.info("Logged out.");
  }
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
  const targets = listTargets();

  out.info(`  User:      ${email}`);
  out.info(`  Target:    ${_targetLabel(config.api_url)}`);

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

  if (targets.length > 1) {
    out.info("");
    out.info("  Saved targets:");
    for (const t of targets) {
      const marker = t.active ? "→ " : "  ";
      out.info(`    ${marker}${_targetLabel(t.url)} — ${t.user_email ?? "not logged in"}`);
    }
  }

  out.success({
    user_email: email,
    api_url: config.api_url,
    active_project: project ?? null,
    cli_version: cliVersion,
    targets,
  });
}

async function targetsAction(opts, cmd) {
  const out = createOutput(cmd);
  const targets = listTargets();

  if (targets.length === 0) {
    out.info("  No saved targets. Run `puppyone auth login` to get started.");
    out.success({ targets: [] });
    return;
  }

  out.info("");
  for (const t of targets) {
    const marker = t.active ? "→ " : "  ";
    out.info(`  ${marker}${_targetLabel(t.url)}`);
    out.info(`     User: ${t.user_email ?? "(not logged in)"}`);
  }
  out.info("");
  out.success({ targets });
}

async function targetsSwitchAction(url, opts, cmd) {
  const out = createOutput(cmd);
  url = url.replace(/\/+$/, "");

  const cached = switchTarget(url);
  if (cached?.api_key) {
    out.info(`  Switched to ${_targetLabel(url)}`);
    out.info(`  Logged in as ${cached.user_email ?? "unknown"}`);
  } else {
    out.info(`  Switched to ${_targetLabel(url)}`);
    out.info(`  No cached session — run \`puppyone auth login\` to authenticate.`);
  }
  out.success({ api_url: url, has_session: !!cached?.api_key });
}

async function targetsRemoveAction(url, opts, cmd) {
  const out = createOutput(cmd);
  url = url.replace(/\/+$/, "");
  removeTarget(url);
  out.info(`  Removed target: ${url}`);
  out.success({ removed: url });
}

// ============================================================
// Register: puppyone auth <subcommand>
// ============================================================

export function registerAuth(program) {
  const auth = program
    .command("auth")
    .description("Authentication — login, logout, identity, targets");

  auth
    .command("login")
    .description("Log in to PuppyOne (interactive target selection on first run)")
    .option("-e, --email <email>", "email address")
    .option("-p, --password <password>", "password")
    .option("-u, --api-url <url>", "PuppyOne API URL")
    .option("-k, --api-key <key>", "directly provide access token (skip login)")
    .action(loginAction);

  auth
    .command("logout")
    .description("Clear credentials for the current target")
    .action(logoutAction);

  auth
    .command("whoami")
    .description("Show current login status, active project, and saved targets")
    .action(whoamiAction);

  const targets = auth
    .command("targets")
    .description("List all saved targets")
    .action(targetsAction);

  targets
    .command("switch <url>")
    .description("Switch to a saved target (reuses cached session)")
    .action(targetsSwitchAction);

  targets
    .command("remove <url>")
    .description("Remove a saved target and its credentials")
    .action(targetsRemoveAction);
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
