import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { probeOpenCodeVersion } from "./lib/opencode-runtime-version.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(projectRoot, "vendor", "opencode", "runtime-manifest.json");
const manifest = JSON.parse(await fs.promises.readFile(manifestPath, "utf8"));
const platformKey = `${process.platform}-${process.arch}`;
const artifact = manifest.artifacts[platformKey];
const archivePath = path.resolve(process.argv[2] || process.env.PUPPYONE_OPENCODE_ARCHIVE || "");

if (!artifact) fail(`No pinned OpenCode artifact exists for ${platformKey}.`);
if (!archivePath || archivePath === path.parse(archivePath).root) fail("Pass the absolute path to the pinned OpenCode archive.");
const metadata = await fs.promises.stat(archivePath).catch(() => null);
if (!metadata?.isFile()) fail(`OpenCode archive was not found: ${archivePath}`);
if (path.basename(archivePath) !== artifact.archive) fail(`Expected ${artifact.archive}, received ${path.basename(archivePath)}.`);
if (metadata.size !== artifact.bytes) fail(`OpenCode archive size mismatch: expected ${artifact.bytes}, received ${metadata.size}.`);
const archiveSha256 = await hashFile(archivePath);
if (archiveSha256 !== artifact.sha256) fail("OpenCode archive SHA-256 does not match the pinned release manifest.");

const temporaryRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "puppyone-opencode-stage-"));
try {
  const extraction = spawnSync("tar", ["-xf", archivePath, "-C", temporaryRoot], { encoding: "utf8", shell: false });
  if (extraction.status !== 0) fail(`Unable to extract OpenCode archive: ${extraction.stderr || extraction.stdout}`);
  const executableName = process.platform === "win32" ? "opencode.exe" : "opencode";
  const extracted = await findFile(temporaryRoot, executableName);
  if (!extracted) fail(`The pinned archive does not contain ${executableName}.`);
  if (process.platform !== "win32") await fs.promises.chmod(extracted, 0o755);
  const version = await probeOpenCodeVersion(extracted, manifest.runtimeRelease.version).catch((error) => {
    fail(`OpenCode executable ${error.message}`);
  });

  const binRoot = path.join(projectRoot, "vendor", "opencode", "bin");
  const target = path.join(binRoot, executableName);
  const verifiedPath = path.join(binRoot, "verified-runtime.json");
  const previousRoot = path.join(binRoot, "previous");
  if (await exists(target) && await exists(verifiedPath)) {
    const existingVerification = JSON.parse(await fs.promises.readFile(verifiedPath, "utf8").catch(() => "null"));
    const existingDigest = await hashFile(target).catch(() => null);
    if (
      existingVerification?.schemaVersion === 1
      && existingVerification.platform === process.platform
      && existingVerification.arch === process.arch
      && /^[a-f0-9]{64}$/.test(existingVerification.executableSha256)
      && existingDigest === existingVerification.executableSha256
    ) {
      await fs.promises.mkdir(previousRoot, { recursive: true });
      await fs.promises.copyFile(target, path.join(previousRoot, executableName));
      await fs.promises.copyFile(verifiedPath, path.join(previousRoot, "verified-runtime.json"));
    }
  }
  await fs.promises.mkdir(binRoot, { recursive: true });
  const stagedTemporary = `${target}.${process.pid}.tmp`;
  await fs.promises.copyFile(extracted, stagedTemporary);
  if (process.platform !== "win32") await fs.promises.chmod(stagedTemporary, 0o755);
  const executableSha256 = await hashFile(stagedTemporary);
  await fs.promises.rename(stagedTemporary, target);
  await fs.promises.writeFile(verifiedPath, `${JSON.stringify({
    schemaVersion: 1,
    version,
    platform: process.platform,
    arch: process.arch,
    archive: artifact.archive,
    archiveSha256,
    executableSha256,
    releaseCommit: manifest.runtimeRelease.releaseCommit,
  }, null, 2)}\n`, { encoding: "utf8", mode: 0o644 });
  process.stdout.write(`Staged verified OpenCode ${version} for ${platformKey}.\n`);
} finally {
  await fs.promises.rm(temporaryRoot, { recursive: true, force: true });
}

async function hashFile(filename) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(filename)) hash.update(chunk);
  return hash.digest("hex");
}

async function findFile(root, filename) {
  const queue = [root];
  while (queue.length) {
    const directory = queue.shift();
    for (const entry of await fs.promises.readdir(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name);
      if (entry.isFile() && entry.name === filename) return candidate;
      if (entry.isDirectory()) queue.push(candidate);
    }
  }
  return null;
}

async function exists(filename) {
  return fs.promises.access(filename).then(() => true, () => false);
}

function fail(message) {
  throw new Error(message);
}
