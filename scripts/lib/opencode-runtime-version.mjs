import { spawnSync } from "node:child_process";

const VERSION_PATTERN = /(\d+\.\d+\.\d+)/;

export async function probeOpenCodeVersion(executable, expectedVersion, options = {}) {
  const platform = options.platform || process.platform;
  const attempts = options.attempts ?? (platform === "win32" ? 3 : 1);
  const timeoutMs = options.timeoutMs ?? (platform === "win32" ? 30_000 : 10_000);
  const retryDelayMs = options.retryDelayMs ?? 1_000;
  const run = options.run || spawnSync;
  const wait = options.wait || delay;
  let lastResult = null;
  let version = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    lastResult = run(executable, ["--version"], {
      encoding: "utf8",
      shell: false,
      timeout: timeoutMs,
    });
    version = `${lastResult.stdout || ""}\n${lastResult.stderr || ""}`.match(VERSION_PATTERN)?.[1] || null;

    if (lastResult.status === 0 && version === expectedVersion) return version;
    if (version && version !== expectedVersion) break;
    if (attempt < attempts) await wait(retryDelayMs * attempt);
  }

  const detail = describeFailure(lastResult, timeoutMs);
  throw new Error(`version mismatch: expected ${expectedVersion}, received ${version || "unknown"} (${detail}).`);
}

function describeFailure(result, timeoutMs) {
  if (result?.error?.code === "ETIMEDOUT") return `probe timed out after ${timeoutMs}ms`;
  if (result?.error) return `probe failed: ${result.error.message}`;
  if (result?.signal) return `probe terminated by ${result.signal}`;
  if (result?.status !== 0) return `probe exited with status ${result?.status ?? "unknown"}`;
  return "probe returned no semantic version";
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
