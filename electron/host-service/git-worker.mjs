/**
 * Runs one named Git operation for a shared folder, started by the host
 * service inside the folder sandbox. Hooks, filters and repository config run
 * with the sandbox's limits, not as the owner's whole account.
 *
 * Input: argv[2] = JSON { fn, root, args }. Output: one JSON line on stdout.
 */
import * as workspace from "../local-api/workspace.mjs";
import { GIT_OPERATIONS } from "./git-operations.mjs";

if (process.argv[2]) {
  try {
    const { fn, root, args } = JSON.parse(process.argv[2]);
    if (!GIT_OPERATIONS.includes(fn) || typeof root !== "string" || !Array.isArray(args)) throw new Error("Unknown Git operation.");
    const result = await workspace[fn](root, ...args);
    process.stdout.write(`${JSON.stringify({ ok: true, result: result ?? null })}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ ok: false, message: String(error?.message ?? error),
      code: typeof error?.code === "string" ? error.code : null })}\n`);
  }
}
