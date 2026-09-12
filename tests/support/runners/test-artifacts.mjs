import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readSourceIdentity } from "../../../scripts/release-checks/execution.mjs";

/** Each CLI invocation owns its reports; a focused run cannot replace a full run. */
export async function createTestArtifacts({
  repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url)),
  environment = process.env,
  arguments: args = process.argv.slice(2),
  sourceReader = readSourceIdentity,
} = {}) {
  const source = await sourceReader(repositoryRoot);
  const startedAt = new Date().toISOString();
  const scope = environment.npm_lifecycle_event || "vitest";
  let directory;
  if (environment.PUPPYONE_TEST_ARTIFACT_DIR) {
    directory = path.resolve(repositoryRoot, environment.PUPPYONE_TEST_ARTIFACT_DIR);
    await mkdir(path.dirname(directory), { recursive: true });
    // Refuse a reused destination, including one containing stale success evidence.
    await mkdir(directory);
  } else {
    const root = path.join(repositoryRoot, "artifacts/tests/vitest");
    await mkdir(root, { recursive: true });
    directory = await mkdtemp(path.join(root, `${startedAt.replaceAll(/[:.]/g, "-")}-${scope.replaceAll(/[^a-zA-Z0-9_-]/g, "-")}-`));
  }
  const artifacts = {
    directory,
    results: path.join(directory, "results.json"),
    coverage: path.join(directory, "coverage"),
    benchmarks: path.join(directory, "benchmarks.json"),
  };
  await writeFile(path.join(directory, "invocation.json"), `${JSON.stringify({
    schemaVersion: 1, source, startedAt, scope, arguments: args,
    reports: { results: "results.json", coverage: "coverage", benchmarks: "benchmarks.json" },
  }, null, 2)}\n`);
  return artifacts;
}

/** A completed receipt identifies source edits made while tests were running. */
export async function finishTestArtifacts(directory, {
  repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url)),
  sourceReader = readSourceIdentity,
  outcome,
} = {}) {
  const metadataPath = path.join(directory, "invocation.json");
  const invocation = JSON.parse(await readFile(metadataPath, "utf8"));
  const sourceAfter = await sourceReader(repositoryRoot);
  const sourceChanged = invocation.source.fingerprint !== sourceAfter.fingerprint;
  const completed = { ...invocation, sourceAfter, sourceChanged, outcome, completedAt: new Date().toISOString() };
  await writeFile(metadataPath, `${JSON.stringify(completed, null, 2)}\n`);
  return completed;
}
