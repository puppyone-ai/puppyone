import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createPlan, loadManifest, validateManifest } from "../../../../scripts/release-checks/manifest.mjs";
import { executeCheck, resolveInvocation, runChecks } from "../../../../scripts/release-checks/execution.mjs";

const roots = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "puppyone-release-checks-test-"));
  roots.push(root);
  return root;
}
const check = (id, dependsOn = []) => ({
  id, name: id, group: "app", command: ["node", "-e", "process.exit(0)"],
  platforms: ["linux", "darwin", "win32"], dependsOn, timeoutSeconds: 3, runtime: "node", artifacts: [],
});
const manifest = (...checks) => ({ schemaVersion: 1, environment: {}, checks });
const identity = async () => ({ commit: "test-commit", dirty: false, fingerprint: "unchanged" });

describe("pre-release check definitions", () => {
  it("retains every existing CI gate and builds UI dependencies once", async () => {
    const actual = await loadManifest();
    expect(actual.checks.map((entry) => entry.id)).toEqual(expect.arrayContaining([
      "lint", "test-types", "updater-p0", "tests", "markdown-focus", "native-resize-cursor", "build", "agent-viewport",
      "agent-tools", "project-sessions", "sidebar-visibility", "appearance", "auxiliary-appearance",
      "item-utilities", "editor-runtime", "editor-panes", "pdf-app", "database-app", "platform-contracts",
      "agent-attachment-ui", "markdown-selection", "markdown-layout", "table-interaction", "text-selection", "item-lifecycle",
    ]));
    expect(actual.checks.find((entry) => entry.id === "updater-p0").command).toEqual(["npm", "run", "test:updater-p0:coverage"]);
    expect(createPlan(actual, { checkId: "agent-viewport" }).map((entry) => entry.id)).toEqual(["build", "agent-viewport"]);
    const visibility = actual.checks.find((entry) => entry.id === "sidebar-visibility");
    expect(visibility.command).toEqual(["npm", "run", "smoke:sidebar-visibility"]);
    expect(visibility.artifacts).toContain("{checkDir}/evidence/result.json");
    const pdf = actual.checks.find((entry) => entry.id === "pdf-app");
    expect(pdf.command).toEqual(["npm", "run", "smoke:pdf-app"]);
    expect(pdf.artifacts).toContain("{checkDir}/evidence/result.json");
    expect(createPlan(actual, { checkId: "pdf-app" }).map(entry => entry.id)).toEqual(["build", "pdf-app"]);
    const database = actual.checks.find((entry) => entry.id === "database-app");
    expect(database.command).toEqual(["npm", "run", "smoke:database-app"]);
    expect(database.platforms).toEqual(["darwin"]);
    expect(database.artifacts).toContain("{checkDir}/evidence/result.json");
    expect(createPlan(actual, { checkId: "database-app" }).map(entry => entry.id)).toEqual(["build", "database-app"]);
    expect(createPlan(actual, { group: "app" }).filter((entry) => entry.id === "build")).toHaveLength(1);
  });

  it("rejects malformed configuration instead of silently omitting checks", () => {
    expect(() => validateManifest(manifest({ ...check("a"), timeoutSeconds: 0 }))).toThrow("Invalid");
    expect(() => validateManifest(manifest({ ...check("a"), typo: true }))).toThrow("Invalid");
    expect(() => validateManifest(manifest(check("a"), check("a")))).toThrow("Duplicate");
    expect(() => validateManifest(manifest(check("a", ["missing"])))).toThrow("unknown dependency");
    expect(() => validateManifest(manifest(check("a", ["b"]), check("b", ["a"])))).toThrow("Cyclic");
    expect(() => validateManifest(manifest(check("a"), { ...check("b", ["a"]), group: "source" }))).toThrow("cross-group");
    expect(() => validateManifest(manifest({ ...check("a"), platforms: ["darwin"] }, check("b", ["a"])))).toThrow("incompatible");
    expect(() => createPlan(manifest(check("a")), { checkId: "missing" })).toThrow("Unknown");
    expect(() => createPlan(manifest(check("a")), { group: "app", checkId: "a" })).toThrow("either");
  });

  it("uses the active npm CLI without a shell on Windows", () => {
    const result = resolveInvocation({ ...check("a"), command: ["npm", "test"] }, {
      platform: "win32", environment: {}, npmPath: "C:\\Program Files\\nodejs\\npm-cli.js",
    });
    expect(result.command).toBe(process.execPath);
    expect(result.args).toEqual(["C:\\Program Files\\nodejs\\npm-cli.js", "test"]);
  });
});

describe("pre-release execution and evidence", () => {
  it("blocks failed dependencies, continues independent checks, and persists failure results", async () => {
    const root = await fixture();
    const calls = [];
    const result = await runChecks(manifest(check("build"), check("ui", ["build"]), check("independent")), {
      repositoryRoot: root, sourceReader: identity, output: null,
      execute: async (entry) => { calls.push(entry.id); return { status: entry.id === "build" ? "failed" : "passed", durationMs: 1 }; },
    });
    expect(calls).toEqual(["build", "independent"]);
    expect(result.exitCode).toBe(1);
    expect(result.report.checks.map((entry) => entry.status)).toEqual(["failed", "blocked", "passed"]);
    expect(JSON.parse(await readFile(result.reportPath, "utf8")).source.commit).toBe("test-commit");
    expect(result.report.checks[0].logPath).toBe("build/output.log");
    expect(await access(path.join(root, "artifacts/release-checks/.lock")).then(() => true, () => false)).toBe(false);
  });

  it("marks unsupported platforms explicitly and rejects a selected unsupported group", async () => {
    const root = await fixture();
    const data = manifest({ ...check("mac-only"), platforms: ["darwin"] });
    const result = await runChecks(data, { repositoryRoot: root, platform: "win32", group: "app", sourceReader: identity, output: null });
    expect(result.report.status).toBe("partial");
    expect(result.report.checks[0].status).toBe("unsupported");
    expect(result.exitCode).toBe(1);
    const all = await runChecks(data, { repositoryRoot: root, platform: "win32", sourceReader: identity, output: null });
    expect(all.exitCode).toBe(1);
    expect(all.report.status).toBe("partial");
  });

  it("rejects results if the source changes during verification", async () => {
    const root = await fixture();
    let reads = 0;
    const result = await runChecks(manifest(check("a")), {
      repositoryRoot: root, output: null,
      sourceReader: async () => ({ commit: "same", dirty: true, fingerprint: String(reads++) }),
      execute: async () => ({ status: "passed", durationMs: 0 }),
    });
    expect(result.exitCode).toBe(1);
    expect(result.report.message).toContain("Source changed");
  });

  it("requires declared evidence even when a command exits successfully", async () => {
    const root = await fixture();
    const result = await runChecks(manifest({ ...check("a"), artifacts: ["{checkDir}/missing.json"] }), {
      repositoryRoot: root, sourceReader: identity, output: null,
      execute: async () => ({ status: "passed", durationMs: 0 }),
    });
    expect(result.exitCode).toBe(1);
    expect(result.report.checks[0].message).toContain("artifact");
    expect(result.report.checks[0].artifacts).toEqual([{ base: "run", path: "a/missing.json", exists: false }]);
  });

  it("archives repository reports and directories before a later command overwrites them", async () => {
    const root = await fixture();
    const data = manifest({ ...check("full"), artifacts: ["report.json", "screenshots"] }, check("focused"));
    const result = await runChecks(data, {
      repositoryRoot: root, sourceReader: identity, output: null,
      execute: async (entry) => {
        if (entry.id === "full") {
          await mkdir(path.join(root, "screenshots"));
          await writeFile(path.join(root, "screenshots", "frame.png"), "frame-original");
        }
        await writeFile(path.join(root, "report.json"), entry.id);
        return { status: "passed", durationMs: 0 };
      },
    });
    expect(result.exitCode).toBe(0);
    const [report, screenshot] = result.report.checks[0].artifacts;
    const directory = path.dirname(result.reportPath);
    expect(await readFile(path.join(directory, report.path), "utf8")).toBe("full");
    expect(await readFile(path.join(root, "report.json"), "utf8")).toBe("focused");
    expect(await readFile(path.join(directory, screenshot.path, "frame.png"), "utf8")).toBe("frame-original");
    expect(report).toMatchObject({ base: "run", sourceBase: "repository", sourcePath: "report.json", fresh: true, fileCount: 1, sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(result.report.source.commit).toBe("test-commit");
  });

  it("fails a successful command that only leaves a previous run's report in place", async () => {
    const root = await fixture();
    await writeFile(path.join(root, "stale.json"), "old run");
    const result = await runChecks(manifest({ ...check("full"), artifacts: ["stale.json"] }), {
      repositoryRoot: root, sourceReader: identity, output: null,
      execute: async () => ({ status: "passed", durationMs: 0 }),
    });
    expect(result.exitCode).toBe(1);
    expect(result.report.checks[0].message).toContain("freshly produced");
    expect(result.report.checks[0].artifacts[0]).toMatchObject({ exists: true, fresh: false });
  });

  it("does not overwrite or adopt another invocation's lock", async () => {
    const root = await fixture();
    const lock = path.join(root, "artifacts/release-checks/.lock");
    await mkdir(path.dirname(lock), { recursive: true });
    await writeFile(lock, "existing owner");
    await expect(runChecks(manifest(check("a")), { repositoryRoot: root })).rejects.toThrow("Another release-checks run");
    expect(await readFile(lock, "utf8")).toBe("existing owner");
  });

  it("captures real child output and nonzero exit status", async () => {
    const root = await fixture();
    const result = await executeCheck({ ...check("a"), command: ["node", "-e", "console.log('release-check-output'); process.exit(7)"] }, {
      repositoryRoot: root, checkDir: root, platform: process.platform, environment: process.env, output: null,
    });
    expect(result).toMatchObject({ status: "failed", exitCode: 7 });
    expect(await readFile(path.join(root, "output.log"), "utf8")).toContain("release-check-output");
  });

  it("terminates a timed-out real child", async () => {
    const root = await fixture();
    const result = await executeCheck({ ...check("a"), timeoutSeconds: 1, command: ["node", "-e", "setInterval(() => {}, 1000)"] }, {
      repositoryRoot: root, checkDir: root, platform: process.platform, environment: process.env, output: null,
    });
    expect(result.status).toBe("timed-out");
    expect(result.durationMs).toBeLessThan(6000);
  }, 10000);

  it("records cancellation and prevents remaining checks from starting", async () => {
    const root = await fixture();
    const controller = new AbortController();
    const result = await runChecks(manifest(check("a"), check("b")), {
      repositoryRoot: root, sourceReader: identity, output: null, signal: controller.signal,
      execute: async () => { controller.abort(); return { status: "cancelled", durationMs: 1 }; },
    });
    expect(result.report.checks.map((entry) => entry.status)).toEqual(["cancelled", "cancelled"]);
    expect(result.exitCode).toBe(1);
  });
});
