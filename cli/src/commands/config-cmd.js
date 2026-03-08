import {
  loadConfig,
  saveConfig,
  clearConfig,
  listTargets,
  switchTarget,
  CONFIG_DIR,
  CONFIG_FILE,
  CLOUD_API_URL,
  LOCAL_API_URL,
} from "../config.js";
import { createOutput } from "../output.js";
import { withErrors } from "../helpers.js";

function _targetLabel(url) {
  if (url === CLOUD_API_URL) return `PuppyOne Cloud (${url})`;
  if (url === LOCAL_API_URL) return `Local (${url})`;
  return url;
}

export function registerConfig(program) {
  const cfg = program
    .command("config")
    .description("CLI configuration — view and modify settings");

  // ── show ──────────────────────────────────────────────────
  cfg
    .command("show")
    .description("Show current configuration")
    .action(withErrors(async (opts, cmd) => {
      const out = createOutput(cmd);
      const config = loadConfig();
      const targets = listTargets();

      const safe = { ...config };
      if (safe.api_key) safe.api_key = safe.api_key.slice(0, 20) + "...";
      if (safe.refresh_token) safe.refresh_token = "(set)";

      out.kv([
        ["Target:", safe.api_url ? _targetLabel(safe.api_url) : "(not set — run `auth login`)"],
        ["User:", safe.user_email ?? "(not logged in)"],
        ["Org:", safe.active_org ? `${safe.active_org.name} (${safe.active_org.id})` : "(not set)"],
        ["Project:", safe.active_project ? `${safe.active_project.name} (${safe.active_project.id})` : "(not set)"],
        ["Config:", CONFIG_FILE],
      ]);

      if (targets.length > 1) {
        out.info("");
        out.info("  Saved targets:");
        for (const t of targets) {
          const marker = t.active ? "→ " : "  ";
          out.info(`    ${marker}${_targetLabel(t.url)} — ${t.user_email ?? "no session"}`);
        }
      }

      out.success({ config: safe, targets });
    }));

  // ── set ───────────────────────────────────────────────────
  cfg
    .command("set")
    .description("Set a configuration value")
    .argument("<key>", "config key (api_url, active_project, ...)")
    .argument("<value>", "config value")
    .action(withErrors(async (key, value, opts, cmd) => {
      const out = createOutput(cmd);

      const ALLOWED = ["api_url"];
      if (!ALLOWED.includes(key)) {
        out.error(
          "INVALID_KEY",
          `Cannot set "${key}" directly.`,
          `Allowed keys: ${ALLOWED.join(", ")}. Use specific commands like \`project use\` or \`org use\`.`
        );
        return;
      }

      if (key === "api_url") {
        const cached = switchTarget(value);
        out.info(`Switched target to: ${value}`);
        if (cached?.api_key) {
          out.info(`  Session: ${cached.user_email ?? "unknown"} (cached)`);
        } else {
          out.info(`  No cached session — run \`puppyone auth login\` to authenticate.`);
        }
      } else {
        saveConfig({ [key]: value });
        out.info(`Config updated: ${key} = ${value}`);
      }

      out.success({ key, value });
    }));

  // ── path ──────────────────────────────────────────────────
  cfg
    .command("path")
    .description("Show config file and directory paths")
    .action(withErrors(async (opts, cmd) => {
      const out = createOutput(cmd);
      out.kv([
        ["Config dir:", CONFIG_DIR],
        ["Config file:", CONFIG_FILE],
      ]);
      out.success({ config_dir: CONFIG_DIR, config_file: CONFIG_FILE });
    }));

  // ── reset ─────────────────────────────────────────────────
  cfg
    .command("reset")
    .description("Reset configuration to defaults (clears all targets)")
    .action(withErrors(async (opts, cmd) => {
      const out = createOutput(cmd);
      clearConfig();
      out.info("Configuration reset to defaults. All saved targets cleared.");
      out.success({ reset: true });
    }));
}
