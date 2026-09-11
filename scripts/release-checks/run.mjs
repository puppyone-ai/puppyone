#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { createPlan, loadManifest } from "./manifest.mjs";
import { runChecks } from "./execution.mjs";

const help = `Pre-release Checks — 发版前检查
Usage: npm run check:release -- [--check ID | --group source|app|platform] [--list]
       npm run check:release -- --validate

Dependencies run once in the same invocation. Reports describe this platform
and selection only; they do not authorize signing or publication.
Linux Electron checks require Xvfb when no DISPLAY is set, and CJK fonts.
`;

const controller = new AbortController();
const abort = () => controller.abort();
try {
  const options = {};
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--help") { process.stdout.write(help); process.exit(0); }
    if (arg === "--check" || arg === "--group") {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
      const key = arg === "--check" ? "checkId" : "group";
      if (options[key]) throw new Error(`Duplicate argument: ${arg}`);
      options[key] = value;
    } else if (arg === "--list" || arg === "--validate") options[arg.slice(2)] = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  const manifest = await loadManifest();
  const plan = createPlan(manifest, options);
  if (options.list) {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  } else if (options.validate) {
    process.stdout.write(`Pre-release Checks: ${manifest.checks.length} definitions validated.\n`);
  } else {
    process.on("SIGINT", abort);
    process.on("SIGTERM", abort);
    const result = await runChecks(manifest, {
      ...options, repositoryRoot: fileURLToPath(new URL("../../", import.meta.url)), signal: controller.signal,
    });
    process.exitCode = controller.signal.aborted ? 130 : result.exitCode;
  }
} catch (error) {
  console.error(`[release-checks] ${error.message}`);
  process.exitCode = 1;
} finally {
  process.off("SIGINT", abort);
  process.off("SIGTERM", abort);
}
