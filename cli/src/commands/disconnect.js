import { createOpenClawClient, createClient, ApiError } from "../api.js";
import { createOutput } from "../output.js";
import { loadConfig, saveConfig } from "../config.js";

export function registerDisconnect(program) {
  program
    .command("disconnect")
    .description("Remove a PuppyOne connection")
    .option("--key <access-key>", "OpenClaw access key")
    .option("-s, --source <id>", "source ID (sync mode)")
    .action(async (opts, cmd) => {
      const out = createOutput(cmd);

      if (opts.key) {
        await disconnectOpenClaw(opts, cmd, out);
      } else if (opts.source) {
        await disconnectSync(opts, cmd, out);
      } else {
        out.error("MISSING_ARGS", "Provide --key <access-key> or --source <id>.");
      }
    });
}

async function disconnectOpenClaw(opts, cmd, out) {
  const config = loadConfig();
  const conn = (config.openclaw_connections ?? []).find((c) => c.access_key === opts.key);

  let api;
  try {
    api = createOpenClawClient(opts.key, cmd, conn?.api_url);
  } catch (e) {
    if (e instanceof ApiError) out.error(e.code, e.message, e.hint);
    else out.error("UNKNOWN", e.message);
    return;
  }

  try {
    const data = await api.del("/access/openclaw/disconnect");
    out.info(`✅ ${data.message ?? "Disconnected"}`);

    // Remove from local config
    const freshConfig = loadConfig();
    const ocConns = (freshConfig.openclaw_connections ?? []).filter(
      (c) => c.access_key !== opts.key,
    );
    saveConfig({ openclaw_connections: ocConns });

    if (conn?.folder) {
      out.info(`  Local files in ${conn.folder} are preserved.`);
      out.info(`  Remove .puppyone/ manually if no longer needed.`);
    }

    out.success(data);
  } catch (e) {
    if (e instanceof ApiError) out.error(e.code, e.message, e.hint);
    else out.error("DISCONNECT_FAILED", e.message);
  }
}

async function disconnectSync(opts, cmd, out) {
  let api;
  try {
    api = createClient(cmd);
  } catch (e) {
    if (e instanceof ApiError) out.error(e.code, e.message, e.hint);
    else out.error("UNKNOWN", e.message);
    return;
  }

  try {
    await api.del(`/sync/sources/${opts.source}`);
    out.info(`✅ Disconnected source #${opts.source}`);

    const config = loadConfig();
    const connections = (config.connections ?? []).filter(
      (c) => String(c.source_id) !== String(opts.source),
    );
    saveConfig({ connections });

    out.success({ source_id: opts.source });
  } catch (e) {
    if (e instanceof ApiError) out.error(e.code, e.message, e.hint);
    else out.error("DISCONNECT_FAILED", e.message);
  }
}
