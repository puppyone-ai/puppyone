#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { testDomains, testLayers, isRuntimeTest, isBenchmark } from "../tests/config/discovery.mjs";

const layers = new Set(["unit", "component", "integration", "e2e", "architecture", "performance", "fixtures", "support", "config"]);
const caseLayers = new Set(testLayers);
export function testLayoutErrors(files, packageJson) {
  const errors = [];
  for (const file of files) {
    if (/^(archive|vendor|node_modules|dist|release|generated|artifacts)\//.test(file)) continue;
    const parts = file.split("/");
    const isCase = /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file);
    if (isCase && (parts[0] !== "tests" || !caseLayers.has(parts[1]) || parts.length < 5)) {
      errors.push(`${file}: test cases belong in tests/<layer>/<domain>/<capability>/`);
    }
    if (isCase && !isRuntimeTest(file)) {
      errors.push(`${file}: unsupported test name or extension; it would not be discovered by Vitest`);
    }
    if (/\.bench\.[cm]?[jt]sx?$/.test(file) && !/^tests\/performance\/benchmarks\/[^/]+\/[^/]+\//.test(file)) {
      errors.push(`${file}: benchmarks belong in tests/performance/benchmarks/<domain>/<capability>/`);
    }
    if (/\.bench\.[cm]?[jt]sx?$/.test(file) && !isBenchmark(file)) {
      errors.push(`${file}: unsupported benchmark name or extension; it would not be discovered by Vitest`);
    }
    const domain = parts[1] === "performance" ? parts[3] : parts[2];
    if (parts[0] === "tests" && (caseLayers.has(parts[1]) || parts[1] === "e2e"
      || ["benchmarks", "scenarios"].includes(parts[2])) && !testDomains.includes(domain)) {
      errors.push(`${file}: unknown test domain ${domain}`);
    }
    if (parts[0] === "tests" && file !== "tests/README.md" && !layers.has(parts[1])) {
      errors.push(`${file}: unknown test layer`);
    }
    if (/^scripts\/(?:smoke-|run-.*-smoke\.|native-agent-.*smoke|fixtures\/)/.test(file)) {
      errors.push(`${file}: test scenarios and fixtures belong under tests/`);
    }
  }
  for (const pattern of ["!tests/**", "!**/*.test.*", "!**/*.spec.*", "!**/*.bench.*"]) {
    if (!packageJson.build?.files?.includes(pattern)) errors.push(`package.json: missing package exclusion ${pattern}`);
  }
  return errors;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root, encoding: "utf8" })
    .split("\0").filter((file) => file && fs.existsSync(path.join(root, file)));
  const errors = testLayoutErrors(files, JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")));
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
  } else console.log("Test layout and package exclusions verified.");
}
