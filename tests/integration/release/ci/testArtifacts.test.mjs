import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createTestArtifacts, finishTestArtifacts } from "../../../support/runners/test-artifacts.mjs";

const roots = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function options(environment = {}) {
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "puppyone-test-artifacts-"));
  roots.push(repositoryRoot);
  return { repositoryRoot, environment, sourceReader: async () => ({ commit: "verified-commit", dirty: false, fingerprint: "source-fingerprint" }) };
}

describe("test invocation evidence", () => {
  it("isolates concurrent and focused runs and retains their source and selection", async () => {
    const fixture = await options();
    const [full, focused] = await Promise.all([
      createTestArtifacts({ ...fixture, arguments: ["run"] }),
      createTestArtifacts({ ...fixture, arguments: ["run", "tests/unit/editor"] }),
    ]);
    expect(full.directory).not.toBe(focused.directory);
    await writeFile(full.results, "full suite");
    await writeFile(focused.results, "focused suite");
    expect(await readFile(full.results, "utf8")).toBe("full suite");
    expect(JSON.parse(await readFile(path.join(focused.directory, "invocation.json"), "utf8"))).toMatchObject({
      source: { commit: "verified-commit", fingerprint: "source-fingerprint" },
      arguments: ["run", "tests/unit/editor"],
    });
  });
  it("writes into the release check's owned directory and rejects reuse", async () => {
    const fixture = await options({ PUPPYONE_TEST_ARTIFACT_DIR: "artifacts/release-checks/run/tests/vitest" });
    const first = await createTestArtifacts(fixture);
    await writeFile(first.results, "original report");
    await expect(createTestArtifacts(fixture)).rejects.toMatchObject({ code: "EEXIST" });
    expect(await readFile(first.results, "utf8")).toBe("original report");
  });
  it.each([false, true])("records whether source changed during the run: %s", async (changed) => {
    const fixture = await options();
    const artifacts = await createTestArtifacts(fixture);
    const completed = await finishTestArtifacts(artifacts.directory, {
      ...fixture, outcome: "passed",
      sourceReader: async () => ({ commit: "verified-commit", dirty: changed, fingerprint: changed ? "edited-source" : "source-fingerprint" }),
    });
    expect(completed.sourceChanged).toBe(changed);
    expect(completed.source.fingerprint).toBe("source-fingerprint");
    expect(completed.completedAt).toEqual(expect.any(String));
    expect(JSON.parse(await readFile(path.join(artifacts.directory, "invocation.json"), "utf8"))).toEqual(completed);
  });

});
