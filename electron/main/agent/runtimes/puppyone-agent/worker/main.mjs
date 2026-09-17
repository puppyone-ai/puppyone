import { puppyOneWorkerProbe, runPuppyOneAgentWorker } from "./runtime.mjs";

if (process.argv.includes("--probe")) {
  process.stdout.write(`${JSON.stringify(puppyOneWorkerProbe())}\n`);
} else {
  await runPuppyOneAgentWorker();
}
