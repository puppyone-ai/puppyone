import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { finished } from "node:stream/promises";
import { readFile, mkdir, mkdtemp, open, unlink, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { createPlan, validateManifest } from "./manifest.mjs";

export async function readSourceIdentity(repositoryRoot) {
  const git = (args) => execFileSync("git", args, { cwd: repositoryRoot, maxBuffer: 32 * 1024 * 1024 });
  const commit = git(["rev-parse", "HEAD"]).toString().trim();
  const status = git(["status", "--porcelain=v1", "-z"]).toString();
  const hash = createHash("sha256").update(commit).update(status).update(git(["diff", "--binary", "HEAD", "--"]));
  for (const file of git(["ls-files", "--others", "--exclude-standard", "-z"]).toString().split("\0").filter(Boolean)) {
    hash.update(file).update(await readFile(path.join(repositoryRoot, file)));
  }
  return { commit, dirty: status.length > 0, fingerprint: hash.digest("hex") };
}

export function resolveInvocation(check, { environment, platform, npmPath }) {
  const [command, ...args] = check.command;
  let argv;
  if (command === "npm") {
    if (!npmPath) throw new Error("Run release checks through npm run check:release so the active npm executable is known.");
    argv = [process.execPath, npmPath, ...args];
  } else {
    argv = [process.execPath, ...args];
  }
  const env = { ...environment };
  // Scope the hosted Linux SUID fallback to actual Electron fixtures only.
  // Local machines keep Electron's normal sandbox configuration.
  if (check.runtime === "electron" && platform === "linux") {
    if (env.GITHUB_ACTIONS === "true") env.ELECTRON_DISABLE_SANDBOX = "1";
    if (!env.DISPLAY) argv = ["xvfb-run", "--auto-servernum", ...argv];
  }
  return { command: argv[0], args: argv.slice(1), env };
}

export async function executeCheck(check, { repositoryRoot, checkDir, environment, platform, signal, output = process.stdout }) {
  const log = createWriteStream(path.join(checkDir, "output.log"));
  const logCompletion = finished(log);
  // Observe early I/O failures while the child is still running.
  logCompletion.catch(() => {});
  const started = Date.now();
  let status = "failed";
  let message = null;
  let exitCode = null;
  let terminationSignal = null;
  try {
    if (check.runtime === "electron" && platform === "linux") {
      const fonts = execFileSync("fc-list", [":lang=zh", "family"], { env: environment, encoding: "utf8", timeout: 5000 });
      if (!fonts.trim()) throw new Error("Electron checks require CJK fonts. Install fonts-noto-cjk before running release checks.");
    }
    const invocation = resolveInvocation(check, { environment, platform, npmPath: environment.npm_execpath });
    const result = await new Promise((resolve) => {
      const child = spawn(invocation.command, invocation.args, {
        cwd: repositoryRoot, env: invocation.env, shell: false,
        detached: platform !== "win32", stdio: ["ignore", "pipe", "pipe"],
      });
      let stopped = null;
      let escalation = null;
      let settled = false;
      function killTree(force) {
        if (!child.pid) return;
        try {
          if (platform === "win32") {
            execFileSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", timeout: 5000 });
          } else process.kill(-child.pid, force ? "SIGKILL" : "SIGTERM");
        } catch (error) {
          if (error.code !== "ESRCH") log.write(`Process cleanup: ${error.message}\n`);
        }
      }
      function stop(reason) {
        if (settled || stopped) return;
        stopped = reason;
        killTree(false);
        escalation = setTimeout(() => killTree(true), 1000);
      }
      const aborted = () => stop("cancelled");
      const timer = setTimeout(() => stop("timed-out"), check.timeoutSeconds * 1000);
      signal?.addEventListener("abort", aborted, { once: true });
      if (signal?.aborted) aborted();
      const finish = (code, childSignal, error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearTimeout(escalation);
        signal?.removeEventListener("abort", aborted);
        // A stopped npm parent can exit before its remaining descendants.
        if (stopped) killTree(true);
        resolve({
          status: stopped ?? (error || code !== 0 ? "failed" : "passed"),
          exitCode: code, terminationSignal: childSignal,
          message: error?.message ?? (stopped ? `Check ${stopped}` : null),
        });
      };
      child.stdout.on("data", (chunk) => { log.write(chunk); output?.write(chunk); });
      child.stderr.on("data", (chunk) => { log.write(chunk); output?.write(chunk); });
      child.once("error", (error) => finish(null, null, error));
      child.once("close", (code, childSignal) => finish(code, childSignal));
    });
    ({ status, message, exitCode, terminationSignal } = result);
  } catch (error) {
    message = error.message;
    log.write(`${message}\n`);
  } finally {
    log.end();
    try { await logCompletion; }
    catch (error) { status = "failed"; message = `Unable to save check output: ${error.message}`; }
  }
  return { status, message, exitCode, signal: terminationSignal, durationMs: Date.now() - started };
}

export async function runChecks(manifest, {
  repositoryRoot, checkId, group, platform = process.platform,
  signal, environment = process.env, output = process.stdout,
  execute = executeCheck, sourceReader = readSourceIdentity,
} = {}) {
  validateManifest(manifest);
  const plan = createPlan(manifest, { checkId, group });
  const artifactRoot = path.join(repositoryRoot, "artifacts", "release-checks");
  await mkdir(artifactRoot, { recursive: true });
  // One invocation owns a worktree's build outputs and fixtures. CI groups
  // run on separate runners; local overlapping invocations must not race.
  const lockPath = path.join(artifactRoot, ".lock");
  let lock;
  try { lock = await open(lockPath, "wx"); }
  catch (error) {
    if (error.code === "EEXIST") throw new Error(`Another release-checks run owns this worktree. Inspect ${lockPath} before removing a stale lock.`);
    throw error;
  }
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    const runDirectory = await mkdtemp(path.join(artifactRoot, `${new Date().toISOString().replaceAll(/[:.]/g, "-")}-`));
    const source = await sourceReader(repositoryRoot);
    const report = {
      schemaVersion: 1, purpose: "pre-release-source-checks", platform,
      scope: checkId ? { check: checkId } : group ? { group } : { all: true },
      source, manifestSha256: createHash("sha256").update(JSON.stringify(manifest)).digest("hex"),
      startedAt: new Date().toISOString(), status: "running",
      checks: plan.map((check) => ({ id: check.id, name: check.name, status: "pending" })),
    };
    const reportPath = path.join(runDirectory, "results.json");
    const save = () => writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    await save();
    for (const check of plan) {
      const checkDir = path.join(runDirectory, check.id);
      await mkdir(checkDir);
      const expand = (value) => value.replaceAll("{checkDir}", checkDir);
      const checkEnvironment = Object.fromEntries(Object.entries({ ...manifest.environment, ...check.environment }).map(([key, value]) => [key, expand(value)]));
      const dependencyFailed = check.dependsOn.some((id) => report.checks.find((result) => result.id === id)?.status !== "passed");
      const resultIndex = report.checks.findIndex((entry) => entry.id === check.id);
      report.checks[resultIndex].status = "running";
      await save();
      output?.write(`\n[release-checks] ${check.id}: ${check.name}\n`);
      let result;
      if (!check.platforms.includes(platform)) result = { status: "unsupported", message: `Not declared for ${platform}`, durationMs: 0 };
      else if (signal?.aborted) result = { status: "cancelled", durationMs: 0 };
      else if (dependencyFailed) result = { status: "blocked", message: "A required check did not pass", durationMs: 0 };
      else {
        try {
          result = await execute(check, { repositoryRoot, checkDir, environment: { ...environment, ...checkEnvironment }, platform, signal, output });
        } catch (error) { result = { status: "failed", message: error.message, durationMs: 0 }; }
      }
      const artifacts = [];
      for (const artifact of check.artifacts) {
        const artifactPath = path.resolve(repositoryRoot, expand(artifact));
        artifacts.push({ path: artifactPath, exists: await access(artifactPath).then(() => true, () => false) });
      }
      if (result.status === "passed" && artifacts.some((artifact) => !artifact.exists)) {
        result = { ...result, status: "failed", message: "A declared check artifact was not produced." };
      }
      const entry = { id: check.id, name: check.name, command: check.command, ...result, artifacts,
        logPath: path.join(checkDir, "output.log"), resultPath: path.join(checkDir, "result.json") };
      report.checks[resultIndex] = entry;
      await writeFile(path.join(checkDir, "result.json"), `${JSON.stringify(entry, null, 2)}\n`);
      await save();
      output?.write(`[release-checks] ${check.id}: ${entry.status} (${(entry.durationMs / 1000).toFixed(1)}s)\n`);
    }
    report.completedAt = new Date().toISOString();
    report.sourceAfter = await sourceReader(repositoryRoot);
    const sourceChanged = source.fingerprint !== report.sourceAfter.fingerprint;
    const hasFailures = report.checks.some((check) => !["passed", "unsupported"].includes(check.status));
    const hasUnsupported = report.checks.some((check) => check.status === "unsupported");
    report.status = sourceChanged || hasFailures ? "failed" : hasUnsupported ? "partial" : "passed";
    if (sourceChanged) report.message = "Source changed during verification; rerun against the intended source.";
    await save();
    output?.write(`\n[release-checks] ${report.status}; report: ${reportPath}\n`);
    // Partial coverage is not a successful release gate, even for the default
    // selection. Callers can explicitly select supported groups on Windows.
    const exitCode = report.status === "passed" ? 0 : 1;
    return { report, reportPath, exitCode };
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}
