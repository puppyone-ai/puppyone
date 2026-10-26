// @vitest-environment node
import { afterAll, describe, expect, it } from "vitest";
import { ESLint } from "eslint";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { load } from "js-yaml";
import { compareBaseline } from "../../../../scripts/readability-baselines.mjs";

const root = process.cwd();
const temporary = mkdtempSync(path.join(tmpdir(), "desktop-readability-"));
afterAll(() => rmSync(temporary, { recursive: true, force: true }));
const eslint = new ESLint({ cwd: root });
const nested = "export const f = a ? b ? c : d : e;";
const baselineFile = ".dependency-cruiser-known-violations.json";

function fixture() {
  return mkdtempSync(path.join(temporary, "case-"));
}
function write(cwd, file, content) {
  const destination = path.join(cwd, file);
  mkdirSync(path.dirname(destination), { recursive: true });
  writeFileSync(destination, content);
}
function json(cwd, file, value) {
  write(cwd, file, `${JSON.stringify(value, null, 2)}\n`);
}
function run(cwd, script, args = [], options = {}) {
  return spawnSync(process.execPath, [path.join(root, script), ...args], { cwd, encoding: "utf8", ...options });
}
function lint(cwd, args = []) {
  return run(cwd, "node_modules/eslint/bin/eslint.js", [".", ...args]);
}
function lintFixture() {
  const cwd = fixture();
  write(cwd, "eslint.config.mjs", `export { default } from ${JSON.stringify(pathToFileURL(path.join(root, "eslint.config.js")).href)};`);
  write(cwd, "src/a.ts", nested);
  return cwd;
}

const lintCases = [
  ["complexity", `export function f(x) { ${Array.from({ length: 21 }, (_, i) => `if (x === ${i}) return ${i};`).join("\n")} }`],
  ["max-depth", "export function f(a) { if(a) { if(a) { if(a) { if(a) { if(a) { return 1; } } } } } }"],
  ["max-params", "export function f(a,b,c,d,e,f) { return a; }"],
  ["no-nested-ternary", nested],
  ["max-lines", Array.from({ length: 801 }, (_, i) => `export const x${i} = ${i};`).join("\n")],
  ["max-lines-per-function", `export function f() {\n${"console.log('x');\n".repeat(301)}}`],
];

describe("readability gates reject new code, without suppressing bug rules", () => {
  it.each(lintCases)("enforces %s", async (rule, text) => {
    const [result] = await eslint.lintText(text, { filePath: "src/readability-probe.ts" });
    expect(result.messages.some((message) => message.ruleId === rule && message.severity === 2)).toBe(true);
  });
  it.each([
    "src/a.ts", "packages/shared-ui/src/a.ts", "electron/a.ts", "local-api/a.ts", "shared/a.ts",
    "src/a.mts", "electron/a.cts", "local-api/a.tsx", "electron/a.mjs", "local-api/a.mjs", "shared/a.js",
    "src/a.js", "packages/shared-ui/src/a.mjs", "electron/a.cjs",
  ])("covers %s", async (filePath) => {
    const annotation = /\.(?:[cm]?ts|tsx)$/.test(filePath) ? "const typed: number = 1; " : "";
    const text = filePath.endsWith(".cjs") ? "const f = a ? b ? c : d : e; debugger;" : `${annotation}${nested} debugger;`;
    const [result] = await eslint.lintText(text, { filePath });
    expect(result.messages.map((message) => message.ruleId)).toEqual(expect.arrayContaining(["no-nested-ternary", "no-debugger"]));
    expect(result.fatalErrorCount).toBe(0);
  });
  it("ignores source-like evidence under artifacts", async () => {
    expect(await eslint.isPathIgnored("artifacts/tests/issue-098/source-copy.ts")).toBe(true);
  });
  it("keeps exact thresholds and skips comments and blank lines for length rules", async () => {
    const config = await eslint.calculateConfigForFile("local-api/probe.ts");
    expect(config.rules.complexity).toEqual([2, 20]);
    expect(config.rules["max-depth"]).toEqual([2, 4]);
    expect(config.rules["max-params"]).toEqual([2, 5]);
    expect(config.rules["max-lines"]).toEqual([2, { max: 800, skipBlankLines: true, skipComments: true }]);
    expect(config.rules["max-lines-per-function"]).toEqual([2, { max: 300, skipBlankLines: true, skipComments: true }]);
    const [result] = await eslint.lintText(`export function f() {\n${"// comment\n\n".repeat(801)} return 1;\n}`, { filePath: "local-api/probe.ts" });
    expect(result.messages).toEqual([]);
  });
});

it("native ESLint baseline rejects new files, increased counts and unsuppressed bugs", () => {
  const cwd = lintFixture();
  expect(lint(cwd, ["--suppress-rule", "no-nested-ternary"]).status).toBe(0);
  expect(lint(cwd).status).toBe(0);
  write(cwd, "src/new.ts", nested);
  expect(lint(cwd).status).toBe(1);
  rmSync(path.join(cwd, "src/new.ts"));
  write(cwd, "src/a.ts", `${nested}\nexport const g = a ? b ? c : d : e;`);
  expect(lint(cwd).status).toBe(1);
  write(cwd, "src/a.ts", `${nested}\ndebugger;`);
  const result = lint(cwd);
  expect(result.status).toBe(1);
  expect(result.stdout).toContain("no-debugger");
}, 15_000);

it("native ESLint pruning removes fixed counts and the Git ratchet disallows bug suppressions", () => {
  const cwd = lintFixture();
  expect(lint(cwd, ["--suppress-rule", "no-nested-ternary"]).status).toBe(0);
  write(cwd, "src/a.ts", "export const fixed = 1;");
  expect(lint(cwd).status).toBeGreaterThan(0);
  expect(lint(cwd, ["--prune-suppressions"]).status).toBe(0);
  expect(JSON.parse(readFileSync(path.join(cwd, "eslint-suppressions.json"), "utf8"))).toEqual({});
  expect(() => compareBaseline("eslint-suppressions.json", {}, { "src/a.ts": { "no-debugger": { count: 1 } } })).toThrow("Invalid readability suppression");
}, 15_000);

it("documents native suppression granularity: replacement at the same file/rule/count needs review", () => {
  const cwd = lintFixture();
  expect(lint(cwd, ["--suppress-rule", "no-nested-ternary"]).status).toBe(0);
  write(cwd, "src/a.ts", "export const differentFunction = x ? y : z ? w : v;");
  expect(lint(cwd).status).toBe(0);
}, 10_000);

function dependencyFixture() {
  const cwd = fixture();
  for (const dir of ["src", "packages", "electron", "local-api", "shared"]) mkdirSync(path.join(cwd, dir));
  json(cwd, "package.json", { type: "module" });
  json(cwd, "tsconfig.json", { compilerOptions: { baseUrl: ".", paths: { "@probe/*": ["src/*"] } } });
  cpSync(path.join(root, ".dependency-cruiser.cjs"), path.join(cwd, ".dependency-cruiser.cjs"));
  write(cwd, "src/features/cloud/index.ts", "export const publicValue = 1;");
  write(cwd, "src/features/cloud/internal.ts", "export const privateValue = 1;");
  write(cwd, "src/features/app-shell/index.ts", "export const shell = 1;");
  write(cwd, "src/features/agent/index.ts", "export { publicValue } from '@probe/features/cloud';");
  write(cwd, "src/future-domain/index.ts", "export const future = 1;");
  write(cwd, "src/future-domain/internal.ts", "export const secret = 1;");
  write(cwd, "src/app/index.ts", "export const app = 1;");
  write(cwd, "src/main.ts", "import './features/app-shell'; import './app';");
  write(cwd, "electron/main.mjs", "export const native = 1;");
  return cwd;
}
function cruise(cwd) {
  const result = run(cwd, "node_modules/dependency-cruiser/bin/dependency-cruise.mjs", [
    "src", "packages", "electron", "local-api", "shared", "--config", ".dependency-cruiser.cjs", "--output-type", "json",
  ]);
  // JSON/baseline reporters intentionally exit zero even with errors.
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout);
}
function dependencyGate(cwd, args = []) {
  return run(cwd, "scripts/check-dependency-baseline.mjs", args);
}

it("dependency-cruiser catches all directions, aliases, cycles and unresolved imports in both domain layouts", () => {
  const cwd = dependencyFixture();
  expect(cruise(cwd).summary.violations).toEqual([]);
  write(cwd, "src/features/agent/deep.ts", "export { privateValue } from '@probe/features/cloud/internal'; export { shell } from '../app-shell'; export { secret } from '../../future-domain/internal';");
  write(cwd, "src/future-domain/deep.ts", "import '../features/cloud/internal'; import '../app';");
  write(cwd, "src/features/helpers.ts", "export const helper = 1;");
  write(cwd, "src/lib/invalid.ts", "import '../features/cloud'; import '../features/helpers'; import '../future-domain'; import '../app';");
  write(cwd, "packages/probe/index.ts", "import '../../src/features/cloud'; import '../../electron/main.mjs';");
  write(cwd, "src/cycle-a.ts", "import './cycle-b';");
  write(cwd, "src/cycle-b.ts", "import './cycle-a';");
  write(cwd, "src/features/agent/missing.ts", "import '@misspelled/features/cloud/internal'; import './missing-relative';");
  const { summary, modules } = cruise(cwd);
  const names = summary.violations.map((item) => item.rule.name);
  expect(names).toEqual(expect.arrayContaining([
    "no-circular", "composition-root-only", "lib-does-not-import-domains", "packages-do-not-import-applications",
    "public-domain-entry-src-features-agent", "public-domain-entry-src-future-domain", "no-unresolved",
  ]));
  expect(summary.violations.filter((item) => item.rule.name === "lib-does-not-import-domains")).toHaveLength(4);
  expect(summary.violations.filter((item) => item.rule.name === "packages-do-not-import-applications")).toHaveLength(2);
  expect(summary.violations.filter((item) => item.rule.name === "no-unresolved")).toHaveLength(2);
  expect(summary.violations.filter((item) => item.from === "src/features/agent/index.ts" || item.from === "src/main.ts")).toEqual([]);
  expect(modules.find((item) => item.source === "src/features/agent/deep.ts").dependencies.every((item) => !item.couldNotResolve)).toBe(true);
  json(cwd, baselineFile, []);
  const result = dependencyGate(cwd);
  expect(result.status).toBe(1);
  for (const name of new Set(names)) expect(result.stderr).toContain(name);
}, 20_000);

it("discovers future root domains even after the entire features directory is removed", () => {
  const cwd = dependencyFixture();
  rmSync(path.join(cwd, "src/features"), { recursive: true });
  write(cwd, "src/main.ts", "import './app';");
  write(cwd, "src/other-domain/index.ts", "import '../future-domain/internal';");
  expect(cruise(cwd).summary.violations.map((item) => item.rule.name)).toEqual(["public-domain-entry-src-other-domain"]);
}, 10_000);

it("dependency checks reject stale debt; pruning only removes and never writes new debt", () => {
  const cwd = dependencyFixture();
  write(cwd, "src/features/agent/deep.ts", "import '../cloud/internal';");
  const old = cruise(cwd).summary.violations;
  json(cwd, baselineFile, old);
  expect(dependencyGate(cwd).status).toBe(0);
  write(cwd, "src/features/agent/deep.ts", "export const fixed = 1;");
  const stale = dependencyGate(cwd);
  expect(stale.status).toBe(1);
  expect(stale.stderr).toContain("Stale dependency baseline");
  const original = readFileSync(path.join(cwd, baselineFile), "utf8");
  write(cwd, "src/features/agent/new.ts", "import '../cloud/internal';");
  for (const args of [[], ["--prune"]]) {
    const result = dependencyGate(cwd, args);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("New dependency violations");
    expect(readFileSync(path.join(cwd, baselineFile), "utf8")).toBe(original);
  }
  rmSync(path.join(cwd, "src/features/agent/new.ts"));
  expect(dependencyGate(cwd, ["--prune"]).status).toBe(0);
  expect(JSON.parse(readFileSync(path.join(cwd, baselineFile), "utf8"))).toEqual([]);
  expect(dependencyGate(cwd).status).toBe(0);
  write(cwd, "src/features/agent/deep.ts", "import '../cloud/internal';");
  expect(dependencyGate(cwd).status).toBe(1);
}, 30_000);

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();
}
function gitFixture() {
  const cwd = fixture();
  git(cwd, ["init", "-q"]);
  git(cwd, ["config", "user.name", "Readability Fixture"]);
  git(cwd, ["config", "user.email", "readability@example.invalid"]);
  write(cwd, "src/old.ts", `${nested}\n${"// unchanged line\n".repeat(30)}`);
  json(cwd, "eslint-suppressions.json", { "src/old.ts": { "no-nested-ternary": { count: 1 } } });
  json(cwd, baselineFile, [{ type: "dependency", from: "src/old.ts", to: "src/target.ts", rule: { name: "no-unresolved", severity: "error" } }]);
  git(cwd, ["add", "src/old.ts", "eslint-suppressions.json", baselineFile]);
  git(cwd, ["commit", "-qm", "Initial fixture"]);
  return cwd;
}
function ratchet(cwd, base = "HEAD") {
  return run(cwd, "scripts/readability-baselines.mjs", [base]);
}

it.each([false, true])("Git ratchet supports only genuine exact renames (modified=%s)", (modified) => {
  const cwd = gitFixture();
  git(cwd, ["mv", "src/old.ts", "src/new.ts"]);
  if (modified) write(cwd, "src/new.ts", `${nested}\n${"// unchanged line\n".repeat(30)}export const changed = 1;`);
  json(cwd, "eslint-suppressions.json", { "src/new.ts": { "no-nested-ternary": { count: 1 } } });
  const dependency = JSON.parse(readFileSync(path.join(cwd, baselineFile), "utf8"));
  dependency[0].from = "src/new.ts";
  json(cwd, baselineFile, dependency);
  const result = ratchet(cwd);
  expect(result.status, result.stderr).toBe(modified ? 1 : 0);
  if (modified) {
    expect(result.stderr).toContain("eslint-suppressions.json");
    expect(result.stderr).toContain(baselineFile);
  }
});

it("Git ratchet rejects growth, same-total transfers, stale deleted files and invalid bases", () => {
  const cwd = gitFixture();
  expect(ratchet(cwd).status).toBe(0);
  expect(ratchet(cwd, "definitely-not-a-git-ref").status).toBe(1);
  json(cwd, "eslint-suppressions.json", { "src/old.ts": { "no-nested-ternary": { count: 2 } } });
  expect(ratchet(cwd).status).toBe(1);
  write(cwd, "src/new.ts", nested);
  json(cwd, "eslint-suppressions.json", { "src/new.ts": { "no-nested-ternary": { count: 1 } } });
  expect(ratchet(cwd).status).toBe(1);
  json(cwd, "eslint-suppressions.json", { "src/old.ts": { "no-nested-ternary": { count: 1 } } });
  rmSync(path.join(cwd, "src/old.ts"));
  expect(ratchet(cwd).stderr).toContain("stale deleted file");
  json(cwd, "eslint-suppressions.json", {});
  json(cwd, baselineFile, []);
  expect(ratchet(cwd).status).toBe(0);
  json(cwd, baselineFile, [{ type: "dependency", from: "src/new.ts", to: "src/target.ts", rule: { name: "no-unresolved", severity: "error" } }]);
  expect(ratchet(cwd).status).toBe(1);
});

it("CI selects the PR base/pre-push SHA and fails closed when it is missing or invalid", () => {
  const workflow = load(readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8"));
  const step = workflow.jobs["source-checks"].steps.find((item) => item.name === "Fetch readability comparison commit");
  expect(step.env.BASE_SHA).toBe("${{ github.event.pull_request.base.sha || github.event.before }}");
  for (const BASE_SHA of ["", "0".repeat(40), "HEAD", "invalid\nREADABILITY_BASE=HEAD"]) {
    const result = spawnSync("bash", ["-e", "-c", step.run], { cwd: temporary, encoding: "utf8", env: { ...process.env, BASE_SHA } });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("A valid PR base or pre-push commit is required.");
  }
  const gates = workflow.jobs["source-checks"].steps.find((item) => item.name === "Readability and dependency gates");
  for (const command of ["npm run lint", "npm run check:dependencies", "npm run check:readability-baselines", "npm run test:readability-gates"]) expect(gates.run).toContain(command);
});

it("CI fetches the supplied comparison commit and catches growth earlier in a multi-commit push", () => {
  const cwd = gitFixture();
  const remote = fixture();
  git(remote, ["init", "--bare", "-q"]);
  git(cwd, ["remote", "add", "origin", remote]);
  git(cwd, ["push", "-q", "origin", "HEAD:main"]);
  const base = git(cwd, ["rev-parse", "HEAD"]);
  json(cwd, "eslint-suppressions.json", { "src/old.ts": { "no-nested-ternary": { count: 2 } } });
  git(cwd, ["add", "eslint-suppressions.json"]);
  git(cwd, ["commit", "-qm", "Increase debt in first commit"]);
  write(cwd, "src/harmless.ts", "export const harmless = 1;");
  git(cwd, ["add", "src/harmless.ts"]);
  git(cwd, ["commit", "-qm", "Second commit with no baseline change"]);
  const workflow = load(readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8"));
  const step = workflow.jobs["source-checks"].steps.find((item) => item.name === "Fetch readability comparison commit");
  const envFile = path.join(cwd, "github-env");
  const fetched = spawnSync("bash", ["-e", "-c", step.run], {
    cwd, encoding: "utf8", env: { ...process.env, BASE_SHA: base, GITHUB_ENV: envFile },
  });
  expect(fetched.status, fetched.stderr).toBe(0);
  expect(readFileSync(envFile, "utf8")).toBe(`READABILITY_BASE=${base}\n`);
  const result = run(cwd, "scripts/readability-baselines.mjs", [], { env: { ...process.env, READABILITY_BASE: base } });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("1 -> 2");
});
