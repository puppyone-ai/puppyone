import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import * as tar from "tar";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createManagedArtifactInstaller, downloadVerifiedArtifact, extractActivationArchive } from "../../../../electron/main/local-agent-activation/managed-artifact-installer.mjs";
import { createActivationJournal } from "../../../../electron/main/local-agent-activation/activation-journal.mjs";
import { runActivationProcess, activationEnvironment } from "../../../../electron/main/local-agent-activation/activation-process.mjs";
import { resolveExecutableObservation } from "../../../../electron/main/local-agent-installation/executable-resolver.mjs";
import { managedInstallationCandidate } from "../../../../electron/main/local-agent-installation/managed-installation-layout.mjs";

const directories = [];
async function temporary() { const result = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-activation-test-"))); directories.push(result); return result; }
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true }))); });
async function archive(root, { link = false } = {}) {
  await fs.mkdir(path.join(root, "package")); await fs.writeFile(path.join(root, "package", "codex"), "fixture binary");
  if (link) await fs.symlink("../../outside", path.join(root, "package", "escape"));
  const file = path.join(root, "fixture.tgz"); await tar.c({ gzip: true, file, cwd: root }, ["package"]); return file;
}
describe("managed installation safety", () => {
  it.each(["package/../../escape", "/absolute", "package\\escape", "package/../escape", "package/file:stream"])("rejects unsafe archive path %s", async member => {
    const root = await temporary(); const output = path.join(root, "out"); await fs.mkdir(output);
    const header = new tar.Header({ path: member, type: "File", size: 0, mode: 0o644 }); header.encode();
    const file = path.join(root, "bad.tar"); await fs.writeFile(file, Buffer.concat([header.block, Buffer.alloc(1024)]));
    await expect(extractActivationArchive(file, output)).rejects.toMatchObject({ code: "archive" }); expect(await fs.readdir(output)).toEqual([]);
  });
  it("carries the managed-only auto-update policy to every resolver consumer", async () => {
    const root = await temporary(); const [{ argsPrefix }] = managedInstallationCandidate({ homedir: root, platform: "darwin" }, "cursor");
    const file = path.join(root, "cursor-agent"); await fs.writeFile(file, "fixture", { mode: 0o755 });
    const result = await resolveExecutableObservation({ names: ["cursor-agent"], configuredCandidates: [{ path: file, source: "product-fallback", argsPrefix }],
      searchContext: { directories: [], executableExtensions: [] } });
    expect(result.candidate.argsPrefix).toEqual(["--disable-auto-update"]);
    const external = await resolveExecutableObservation({ names: ["cursor-agent"], configuredCandidates: [{ path: file, source: "configured" }],
      searchContext: { directories: [], executableExtensions: [] } });
    expect(external.candidate.argsPrefix).toEqual([]);
  });
  it("validates an entire archive before writing and rejects vendor symlinks", async () => {
    const root = await temporary(); const output = path.join(root, "out"); await fs.mkdir(output);
    await expect(extractActivationArchive(await archive(root, { link: true }), output)).rejects.toMatchObject({ code: "archive" });
    expect(await fs.readdir(output)).toEqual([]);
  });
  it("extracts a regular tarball with one root removed", async () => {
    const root = await temporary(); const output = path.join(root, "out"); await fs.mkdir(output);
    await extractActivationArchive(await archive(root), output);
    expect(await fs.readFile(path.join(output, "codex"), "utf8")).toBe("fixture binary");
  });
  it("rejects corrupt archives without extracting any member", async () => {
    const root = await temporary(); const file = path.join(root, "bad.tgz"); const output = path.join(root, "out");
    await fs.mkdir(output); await fs.writeFile(file, "not a tar file");
    await expect(extractActivationArchive(file, output)).rejects.toMatchObject({ code: "archive" }); expect(await fs.readdir(output)).toEqual([]);
  });
  it("verifies pinned bytes and rejects untrusted URLs before fetching", async () => {
    const root = await temporary(); const body = "official-test-fixture";
    const artifact = { url: "https://registry.npmjs.org/fixture.tgz", algorithm: "sha512", digest: createHash("sha512").update(body).digest("base64") };
    const fetcher = vi.fn(async () => new Response(body));
    await downloadVerifiedArtifact(artifact, path.join(root, "good"), { fetch: fetcher });
    expect(fetcher).toHaveBeenCalledWith(artifact.url, expect.objectContaining({ redirect: "error", credentials: "omit" }));
    await expect(downloadVerifiedArtifact({ ...artifact, digest: "wrong" }, path.join(root, "bad"), { fetch: fetcher })).rejects.toMatchObject({ code: "integrity" });
    fetcher.mockClear();
    for (const url of ["http://registry.npmjs.org/x", "https://evil.example/x", "https://user@registry.npmjs.org/x"]) {
      await expect(downloadVerifiedArtifact({ ...artifact, url }, path.join(root, "never"), { fetch: fetcher })).rejects.toMatchObject({ code: "integrity" });
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("commits a verified version atomically, reuses it and does not touch PATH", async () => {
    const homedir = await temporary(); const fixture = await temporary(); const file = await archive(fixture);
    const download = vi.fn(async (_artifact, destination) => fs.copyFile(file, destination));
    const recipe = { setupId: "codex", version: "test-1", binary: "codex", entry: "codex", artifact: { digest: "fixture", url: "https://registry.npmjs.org/fixture" } };
    const installer = createManagedArtifactInstaller({ homedir, download }); const verify = vi.fn(async file => { expect(await fs.readFile(file, "utf8")).toBe("fixture binary"); });
    const options = { signal: new AbortController().signal, verify, committed: vi.fn() };
    const entry = await installer.install(recipe, options); await installer.install(recipe, options);
    expect(download).toHaveBeenCalledOnce(); expect(options.committed).toHaveBeenCalledTimes(2);
    expect(await fs.readFile(entry, "utf8")).toBe("fixture binary");
    expect(await fs.readdir(homedir)).toEqual([".puppyone"]);
    expect(await fs.readdir(path.dirname(path.dirname(entry)))).toEqual(["current", "test-1"]);
  });
  it("cancels before commit, cleans staging, and excludes concurrent installers", async () => {
    const homedir = await temporary(); const controller = new AbortController(); let entered;
    const ready = new Promise(resolve => { entered = resolve; });
    const download = vi.fn(async (_artifact, _destination, { signal }) => {
      entered(); await new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    });
    const installer = createManagedArtifactInstaller({ homedir, download });
    const recipe = { setupId: "codex", version: "test-1", binary: "codex", entry: "codex", artifact: {} };
    const options = { signal: controller.signal, verify: vi.fn(), committed: vi.fn() };
    const installing = installer.install(recipe, options); const rejected = expect(installing).rejects.toThrow(); await ready;
    await expect(installer.install(recipe, { ...options, signal: new AbortController().signal })).rejects.toMatchObject({ code: "installation-busy" });
    controller.abort(new Error("cancel test")); await rejected;
    expect(options.committed).not.toHaveBeenCalled(); expect(await fs.readdir(path.join(homedir, ".puppyone", "agent-runtimes", "codex"))).toEqual([]);
  });
  it("fails closed for a corrupt journal, and serializes atomic snapshot writes", async () => {
    const root = await temporary(); const file = path.join(root, "journal.json"); const journal = createActivationJournal(file);
    expect(await journal.read()).toEqual([]); await fs.writeFile(file, "{}"); await expect(journal.read()).rejects.toThrow();
    await Promise.all([1, 2, 3].map(revision => journal.write({ epoch: "test", revision, operations: [] })));
    expect(JSON.parse(await fs.readFile(file, "utf8")).revision).toBe(3); expect(await journal.read()).toEqual([]);
    expect(await fs.readdir(root)).toEqual(["journal.json"]);
  });
  it("bounds subprocess output and time, scrubs injection environment, and cancels a real owned child", async () => {
    expect(activationEnvironment({ PATH: "/bin", NODE_OPTIONS: "--require bad", DYLD_INSERT_LIBRARIES: "bad", LD_PRELOAD: "bad" })).toEqual({ PATH: "/bin" });
    const result = await runActivationProcess(process.execPath, ["-e", "process.stdout.write('fixture')"]); expect(result.stdout).toBe("fixture");
    await expect(runActivationProcess(process.execPath, ["-e", "setInterval(()=>{},1000)"], { timeoutMs: 50 })).rejects.toMatchObject({ code: "timeout" });
    await expect(runActivationProcess(process.execPath, ["-e", "process.stdout.write('x'.repeat(600000))"])).rejects.toMatchObject({ code: "process" });
    const controller = new AbortController(); const pending = runActivationProcess(process.execPath, ["-e", "setInterval(()=>{},1000)"], { signal: controller.signal });
    const rejected = expect(pending).rejects.toThrow("cancel child"); controller.abort(new Error("cancel child")); await rejected;
  });
});
