import { loadConfig, saveConfig, clearConfig, CONFIG_DIR, CONFIG_FILE } from "../config.js";
import { createOutput } from "../output.js";
import { withErrors } from "../helpers.js";

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

      const safe = { ...config };
      if (safe.api_key) safe.api_key = safe.api_key.slice(0, 20) + "...";
      if (safe.refresh_token) safe.refresh_token = "(set)";

      out.kv([
        ["API URL:", safe.api_url],
        ["API Key:", safe.api_key ?? "(not set)"],
        ["User:", safe.user_email ?? "(not logged in)"],
        ["Org:", safe.active_org ? `${safe.active_org.name} (${safe.active_org.id})` : "(not set)"],
        ["Project:", safe.active_project ? `${safe.active_project.name} (${safe.active_project.id})` : "(not set)"],
        ["Config:", CONFIG_FILE],
      ]);
      out.success({ config: safe });
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

      saveConfig({ [key]: value });
      out.info(`Config updated: ${key} = ${value}`);
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
    .description("Reset configuration to defaults")
    .action(withErrors(async (opts, cmd) => {
      const out = createOutput(cmd);
      clearConfig();
      out.info("Configuration reset to defaults.");
      out.success({ reset: true });
    }));
}
