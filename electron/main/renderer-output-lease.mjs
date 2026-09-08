import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * A file-loaded window can import any chunk until it closes. Keep Vite's
 * destructive output replacement and those readers mutually exclusive.
 * Claims are atomic directories; the owner PID is in the name, so a crash
 * cannot leave a partly written owner record. Multiple previews may coexist.
 */
export function acquireRendererOutputLease({ outputDirectory, mode }) {
  if (mode !== "preview" && mode !== "build") throw new Error("Invalid renderer output lease mode.");
  let output = path.resolve(outputDirectory);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  // Canonicalize both existing outputs and new outputs under a symlinked root.
  try { output = fs.realpathSync(output); } catch (error) {
    if (error.code !== "ENOENT") throw error;
    output = path.join(fs.realpathSync(path.dirname(output)), path.basename(output));
  }
  const parent = path.dirname(output);
  const leaseRoot = path.join(parent, `.${path.basename(output)}.puppyone-leases`);
  fs.mkdirSync(leaseRoot, { recursive: true });
  const claim = path.join(leaseRoot, `${mode}-${process.pid}-${randomUUID()}`);
  fs.mkdirSync(claim);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    process.removeListener("exit", release);
    try { fs.rmdirSync(claim); } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  };
  try {
    for (const entry of fs.readdirSync(leaseRoot)) {
      if (path.join(leaseRoot, entry) === claim) continue;
      const owner = /^(preview|build)-(\d+)-[0-9a-f-]+$/.exec(entry);
      if (!owner) throw new Error(`Unrecognized renderer output lease: ${entry}`);
      if (!isProcessAlive(Number(owner[2]))) {
        try { fs.rmdirSync(path.join(leaseRoot, entry)); } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
        continue;
      }
      if (mode === "preview" && owner[1] === "preview") continue;
      const error = new Error(mode === "build"
        ? `Cannot replace renderer output at ${output}: PuppyOne preview or another build is using it (PID ${owner[2]}). Close the preview normally, or build in a separate worktree/output directory, then try again.`
        : `Cannot open PuppyOne while its renderer output is being built (PID ${owner[2]}). Wait for the build to finish, then start PuppyOne again.`);
      error.code = "RENDERER_OUTPUT_IN_USE";
      throw error;
    }
    process.once("exit", release);
    return release;
  } catch (error) {
    release();
    throw error;
  }
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM is an existing process owned by somebody else; fail closed.
    return error.code !== "ESRCH";
  }
}
