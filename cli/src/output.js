/**
 * Unified output helper — human-readable vs --json.
 *
 * Usage:
 *   const out = createOutput(cmd);
 *   out.success({ source, mappings }); // pretty or JSON
 *   out.error("NOT_FOUND", "Folder not found", "Check the path");
 *   out.info("Scanning folder...");
 */

import { collectOpts } from "./api.js";

export function createOutput(cmd) {
  let jsonMode = false;
  try {
    jsonMode = collectOpts(cmd)?.json ?? false;
  } catch { /* ignore */ }

  return {
    json: jsonMode,

    success(data) {
      if (jsonMode) {
        console.log(JSON.stringify({ success: true, ...data }, null, 2));
      }
    },

    error(code, message, hint) {
      if (jsonMode) {
        console.error(JSON.stringify({ success: false, error: { code, message }, hint }, null, 2));
      } else {
        console.error(`Error: ${message}`);
        if (hint) console.error(`Hint: ${hint}`);
      }
      process.exit(1);
    },

    info(msg) {
      if (!jsonMode) console.log(msg);
    },

    warn(msg) {
      if (!jsonMode) console.error(`Warning: ${msg}`);
    },

    step(msg) {
      if (!jsonMode) process.stdout.write(`  ${msg}`);
    },

    done(msg = "") {
      if (!jsonMode) console.log(msg ? ` ${msg}` : "");
    },

    kv(pairs) {
      if (jsonMode || !pairs.length) return;
      const maxKey = Math.max(...pairs.map(([k]) => k.length));
      for (const [key, val] of pairs) {
        console.log(`  ${key.padEnd(maxKey + 1)} ${val ?? "-"}`);
      }
    },

    table(rows, cols) {
      if (jsonMode) return;
      if (!rows.length) {
        console.log("  (empty)");
        return;
      }
      const widths = cols.map((c) => Math.max(c.label.length, ...rows.map((r) => String(r[c.key] ?? "").length)));
      const header = cols.map((c, i) => c.label.padEnd(widths[i])).join("  ");
      const sep = cols.map((_, i) => "─".repeat(widths[i])).join("──");
      console.log(`  ${header}`);
      console.log(`  ${sep}`);
      for (const row of rows) {
        const line = cols.map((c, i) => String(row[c.key] ?? "").padEnd(widths[i])).join("  ");
        console.log(`  ${line}`);
      }
    },

    list(items) {
      if (jsonMode) return;
      for (const item of items) console.log(`  ${item}`);
    },

    raw(text) {
      console.log(text);
    },
  };
}
