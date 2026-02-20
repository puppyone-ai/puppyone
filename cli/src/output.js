/**
 * Unified output helper — human-readable vs --json.
 *
 * Usage:
 *   const out = createOutput(cmd);
 *   out.success({ source, mappings }); // pretty or JSON
 *   out.error("NOT_FOUND", "Folder not found", "Check the path");
 *   out.info("Scanning folder...");
 */

export function createOutput(cmd) {
  const root = cmd?.parent ?? cmd;
  const jsonMode = root.opts?.().json ?? false;

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

    step(msg) {
      if (!jsonMode) process.stdout.write(`  ${msg}`);
    },

    done(msg = "") {
      if (!jsonMode) console.log(msg ? ` ${msg}` : "");
    },

    table(rows, cols) {
      if (jsonMode) return;
      const widths = cols.map((c) => Math.max(c.label.length, ...rows.map((r) => String(r[c.key] ?? "").length)));
      const header = cols.map((c, i) => c.label.padEnd(widths[i])).join("  ");
      console.log(`  ${header}`);
      for (const row of rows) {
        const line = cols.map((c, i) => String(row[c.key] ?? "").padEnd(widths[i])).join("  ");
        console.log(`  ${line}`);
      }
    },
  };
}
