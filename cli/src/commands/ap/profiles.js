import { ApiError, createAccessKeyClient } from "../../api.js";
import {
  deleteAccessPointCredential,
  getAccessPointCredential,
  loadConfig,
  saveAccessPointCredential,
  saveConfig,
  LOCAL_API_URL,
} from "../../config.js";
import { withErrors } from "../../helpers.js";
import { createOutput } from "../../output.js";
import { get } from "../fs/lib/http.js";

function validateProfileName(profile) {
  if (!/^[A-Za-z0-9._-]+$/.test(profile)) {
    throw new ApiError(
      0,
      "INVALID_PROFILE",
      `Invalid access point profile: ${profile}`,
      "Use letters, numbers, dots, underscores, or dashes.",
    );
  }
}

function maskKey(key) {
  if (!key || key.length < 8) return key || "-";
  const idx = key.indexOf("_");
  const pre = idx > 0 ? idx + 1 : 4;
  return key.slice(0, pre) + "..." + key.slice(-4);
}

async function readAccessKey(opts) {
  if (opts.accessKey) return opts.accessKey;
  if (opts.accessKeyStdin) {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const key = Buffer.concat(chunks).toString("utf-8").trim();
    if (!key) throw new ApiError(0, "MISSING_ACCESS_KEY", "No access key received on stdin.");
    return key;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new ApiError(
      0,
      "MISSING_ACCESS_KEY",
      "Access key is required in non-interactive mode.",
      "Pipe it with --access-key-stdin or set PUPPYONE_ACCESS_KEY for one command.",
    );
  }
  return readHiddenLine("Access Key: ");
}

function readHiddenLine(prompt) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    let value = "";
    stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    const cleanup = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write("\n");
    };

    const onData = (char) => {
      if (char === "\r" || char === "\n") {
        stdin.off("data", onData);
        cleanup();
        resolve(value.trim());
        return;
      }
      if (char === "\u0003") {
        stdin.off("data", onData);
        cleanup();
        process.exit(130);
      }
      if (char === "\u007f" || char === "\b") {
        value = value.slice(0, -1);
        return;
      }
      value += char;
    };

    stdin.on("data", onData);
  });
}

export function registerAccessPointManagement(ap) {
  ap
    .command("login")
    .description("Save an Access Point profile for future `puppyone fs` commands")
    .argument("<profile>", "local profile name")
    .option("-u, --api-url <url>", "PuppyOne API URL", LOCAL_API_URL)
    .option("--access-key <key>", "Access key (discouraged; prefer prompt or --access-key-stdin)")
    .option("--access-key-stdin", "read the access key from stdin")
    .option("--name <name>", "local label for this access point")
    .action(withErrors(async (profile, opts, cmd) => {
      validateProfileName(profile);
      const out = createOutput(cmd);
      const accessKey = await readAccessKey(opts);
      const client = createAccessKeyClient(accessKey, cmd, opts.apiUrl);
      const result = await get(client, "/ap-fs/stat", { path: "" });
      const config = loadConfig();
      const profiles = config.access_points || {};
      const metadata = {
        api_url: client.baseUrl,
        name: opts.name || result.scope?.path || "Access Point",
        scope: result.scope || null,
        bound_at: new Date().toISOString(),
      };
      saveAccessPointCredential(profile, accessKey);
      saveConfig({
        access_points: { ...profiles, [profile]: metadata },
        current_access_point: profile,
        active_access_point: null,
      });

      if (out.json) {
        out.success({ profile, access_point: metadata, stat: result });
        return;
      }
      out.info(`Saved Access Point profile: ${profile}`);
      out.info(`Scope: ${metadata.scope?.path || "."} (${metadata.scope?.mode || "r"})`);
      out.info("");
      out.info("Now use:");
      out.info("  puppyone fs ls");
      out.info("  puppyone fs cat <path>");
      out.info("  echo \"hello\" | puppyone fs write <path>");
    }));

  ap
    .command("use")
    .description("Switch the active Access Point profile")
    .argument("<profile>", "local profile name")
    .action(withErrors(async (profile, opts, cmd) => {
      validateProfileName(profile);
      const out = createOutput(cmd);
      const config = loadConfig();
      const metadata = config.access_points?.[profile];
      if (!metadata) {
        out.error("PROFILE_NOT_FOUND", `Access Point profile not found: ${profile}`, "Run `puppyone ap list` or `puppyone ap login <profile>`.");
        return;
      }
      if (!getAccessPointCredential(profile)) {
        out.error("MISSING_CREDENTIAL", `No local credential stored for profile: ${profile}`, `Run \`puppyone ap login ${profile}\` again.`);
        return;
      }
      saveConfig({ current_access_point: profile, active_access_point: null });
      if (out.json) {
        out.success({ current_access_point: profile, access_point: metadata });
        return;
      }
      out.info(`Active Access Point: ${profile}`);
      out.info(`Scope: ${metadata.scope?.path || "."} (${metadata.scope?.mode || "r"})`);
    }));

  ap
    .command("list")
    .description("List saved Access Point profiles")
    .action(withErrors(async (opts, cmd) => {
      const out = createOutput(cmd);
      const config = loadConfig();
      const current = config.current_access_point || null;
      const rows = Object.entries(config.access_points || {}).map(([profile, metadata]) => ({
        profile,
        active: profile === current ? "*" : "",
        name: metadata.name || "-",
        scope: metadata.scope?.path || ".",
        mode: metadata.scope?.mode || "-",
        api_url: metadata.api_url || "-",
        has_key: getAccessPointCredential(profile) ? "yes" : "no",
      }));
      if (out.json) {
        out.success({ current_access_point: current, access_points: rows });
        return;
      }
      if (!rows.length) {
        out.info("No Access Point profiles saved. Run `puppyone ap login <profile>`.");
        return;
      }
      out.table(rows, [
        { key: "active", label: "" },
        { key: "profile", label: "PROFILE" },
        { key: "scope", label: "SCOPE" },
        { key: "mode", label: "MODE" },
        { key: "api_url", label: "API URL" },
        { key: "has_key", label: "KEY" },
      ]);
    }));

  ap
    .command("current")
    .description("Show the active Access Point")
    .action(withErrors(async (opts, cmd) => {
      const out = createOutput(cmd);
      const config = loadConfig();
      const current = config.current_access_point || null;
      const active = current ? config.access_points?.[current] : null;
      const legacy = config.active_access_point || null;
      if (out.json) {
        out.success({
          current_access_point: current,
          access_point: active,
          legacy_access_point: legacy,
        });
        return;
      }
      if (!active && !legacy) {
        out.info("No active Access Point. Run `puppyone ap login <profile>`.");
        return;
      }
      const display = active || legacy;
      out.kv([
        ["Profile:", current || "(legacy)"],
        ["Name:", display.name || "-"],
        ["API URL:", display.api_url || "-"],
        ["Scope:", display.scope?.path || "."],
        ["Mode:", display.scope?.mode || "-"],
        ["Key:", current ? (getAccessPointCredential(current) ? "stored" : "missing") : maskKey(legacy?.access_key)],
      ]);
    }));

  ap
    .command("logout")
    .description("Delete a saved Access Point profile and local credential")
    .argument("<profile>", "local profile name")
    .action(withErrors(async (profile, opts, cmd) => {
      validateProfileName(profile);
      const out = createOutput(cmd);
      const config = loadConfig();
      const profiles = { ...(config.access_points || {}) };
      delete profiles[profile];
      deleteAccessPointCredential(profile);
      saveConfig({
        access_points: profiles,
        current_access_point: config.current_access_point === profile ? null : config.current_access_point,
      });
      out.success?.({ deleted: profile });
      out.info(`Access Point profile deleted: ${profile}`);
    }));

  ap
    .command("clear")
    .description("Clear the active Access Point selection")
    .action(withErrors(async (opts, cmd) => {
      const out = createOutput(cmd);
      saveConfig({ current_access_point: null, active_access_point: null });
      out.success?.({ current_access_point: null });
      out.info("Active Access Point selection cleared.");
    }));
}
