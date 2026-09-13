#!/usr/bin/env node
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import electron from "electron";

const flags = process.argv.slice(2);
for (const flag of flags) {
  if (!["--agent-draft", "--native"].includes(flag)) throw new Error(`Unknown e2e option: ${flag}`);
}
const scenarios = [
  ["../../e2e/workspace/projects/project-sessions.smoke.mjs", "--agent-draft"],
  ["../../e2e/workbench/layout/sidebar-visibility.smoke.mjs", "--native"],
];
for (const [relative, flag] of scenarios) {
  const child = spawn(electron, [fileURLToPath(new URL(relative, import.meta.url)), ...flags.filter(value => value === flag)], { stdio: "inherit" });
  const stop = signal => child.kill(signal);
  const interrupt = () => stop("SIGINT"), terminate = () => stop("SIGTERM");
  process.once("SIGINT", interrupt); process.once("SIGTERM", terminate);
  try {
    const result = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
    if (result.code !== 0 || result.signal) {
      process.exitCode = result.code || 1;
      break;
    }
  } finally {
    process.removeListener("SIGINT", interrupt); process.removeListener("SIGTERM", terminate);
  }
}
