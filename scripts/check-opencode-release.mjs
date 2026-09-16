import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { probeOpenCodeVersion } from "./lib/opencode-runtime-version.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await fs.promises.readFile(path.join(root, "vendor", "opencode", "runtime-manifest.json"), "utf8"));
const binRoot = path.join(root, "vendor", "opencode", "bin");
const executable = path.join(binRoot, process.platform === "win32" ? "opencode.exe" : "opencode");
const verifiedPath = path.join(binRoot, "verified-runtime.json");
const verified = JSON.parse(await fs.promises.readFile(verifiedPath, "utf8").catch(() => "null"));
const artifact = manifest.artifacts?.[`${process.platform}-${process.arch}`];
if (
  !artifact
  || verified?.schemaVersion !== 1
  || verified.version !== manifest.runtimeRelease.version
  || verified.platform !== process.platform
  || verified.arch !== process.arch
  || verified.archive !== artifact.archive
  || verified.archiveSha256 !== artifact.sha256
  || verified.releaseCommit !== manifest.runtimeRelease.releaseCommit
  || !/^[a-f0-9]{64}$/.test(verified.executableSha256)
) {
  throw new Error("Release requires a verified platform OpenCode runtime. Run npm run stage:opencode-runtime first.");
}
const hash = crypto.createHash("sha256");
for await (const chunk of fs.createReadStream(executable)) hash.update(chunk);
if (hash.digest("hex") !== verified.executableSha256) throw new Error("Staged OpenCode executable failed SHA-256 verification.");
await probeOpenCodeVersion(executable, manifest.runtimeRelease.version).catch((error) => {
  throw new Error(`Staged OpenCode runtime ${error.message}`);
});
process.stdout.write(`Verified staged OpenCode ${verified.version} for release.\n`);
