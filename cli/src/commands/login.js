import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { saveConfig, clearConfig, loadConfig } from "../config.js";
import { createOutput } from "../output.js";

async function prompt(question) {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

async function promptPassword(question) {
  const rl = createInterface({ input: stdin, output: stdout });
  // Node doesn't have built-in hidden input; use simple prompt
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

export function registerLogin(program) {
  program
    .command("login")
    .description("Log in to PuppyOne with email and password")
    .option("-e, --email <email>", "email address")
    .option("-p, --password <password>", "password")
    .option("-u, --api-url <url>", "PuppyOne API URL")
    .option("-k, --api-key <key>", "directly provide access token (skip login)")
    .action(async (opts, cmd) => {
      const out = createOutput(cmd);

      const config = loadConfig();
      const apiUrl = (opts.apiUrl ?? cmd.parent.opts().apiUrl ?? config.api_url ?? "http://localhost:9090").replace(/\/+$/, "");

      // Direct token mode (for scripts/CI)
      if (opts.apiKey ?? cmd.parent.opts().apiKey) {
        const key = opts.apiKey ?? cmd.parent.opts().apiKey;
        saveConfig({ api_url: apiUrl, api_key: key });
        out.info(`Logged in (token mode).`);
        out.info(`  API: ${apiUrl}`);
        out.success({ api_url: apiUrl, mode: "token" });
        return;
      }

      // Email + password mode
      let email = opts.email;
      let password = opts.password;

      if (!email) email = await prompt("Email: ");
      if (!password) password = await promptPassword("Password: ");

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

        const { access_token, refresh_token, user_email } = json.data;

        saveConfig({
          api_url: apiUrl,
          api_key: access_token,
          refresh_token,
          user_email,
        });

        out.done("✓");
        out.info(`\n✅ Logged in as ${user_email}`);
        out.info(`   API: ${apiUrl}`);

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
    });
}

export function registerLogout(program) {
  program
    .command("logout")
    .description("Clear saved credentials")
    .action((opts, cmd) => {
      const out = createOutput(cmd);
      clearConfig();
      out.info("Logged out. Credentials cleared.");
      out.success({ message: "logged_out" });
    });
}

export function registerWhoami(program) {
  program
    .command("whoami")
    .description("Show current login status")
    .action(async (opts, cmd) => {
      const out = createOutput(cmd);
      const config = loadConfig();

      if (!config.api_key) {
        out.error("NOT_AUTHENTICATED", "Not logged in.", "Run `puppyone login` first.");
        return;
      }

      const email = config.user_email ?? "unknown";
      out.info(`User:   ${email}`);
      out.info(`API:    ${config.api_url}`);
      out.info(`CLI:    0.2.0`);

      try {
        const res = await fetch(`${config.api_url}/health`);
        out.info(`Server: ${res.ok ? "reachable ✓" : `responded with ${res.status}`}`);
      } catch {
        out.info(`Server: unreachable ✗`);
      }

      out.success({
        user_email: email,
        api_url: config.api_url,
        cli_version: "0.2.0",
      });
    });
}
