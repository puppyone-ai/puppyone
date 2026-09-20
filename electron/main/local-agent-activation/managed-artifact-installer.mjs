import fs from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import * as tar from "tar";
import lockfile from "proper-lockfile";
import { managedInstallationRoot } from "../local-agent-installation/managed-installation-layout.mjs";
import { ActivationError } from "./activation-error.mjs";

const MAX_DOWNLOAD = 512 * 1024 * 1024;
const MAX_EXPANDED = 1536 * 1024 * 1024;
const HOSTS = new Set(["registry.npmjs.org", "downloads.cursor.com"]);

export async function downloadVerifiedArtifact(artifact, destination, { signal, fetch: fetcher = globalThis.fetch } = {}) {
  const url = new URL(artifact.url);
  if (url.protocol !== "https:" || url.username || url.password || !HOSTS.has(url.hostname)
    || url.port || !/^(sha256|sha512)$/u.test(artifact.algorithm)) throw new ActivationError("integrity");
  const timeout = AbortSignal.timeout(10 * 60_000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response;
  try { response = await fetcher(url.href, { signal: combined, redirect: "error", credentials: "omit" }); }
  catch { signal?.throwIfAborted(); throw new ActivationError("download"); }
  if (!response.ok || !response.body || Number(response.headers.get("content-length")) > MAX_DOWNLOAD) {
    await response.body?.cancel(); throw new ActivationError("download");
  }
  const hash = createHash(artifact.algorithm);
  let bytes = 0;
  try {
    await pipeline(Readable.fromWeb(response.body), new Transform({ transform(chunk, _encoding, next) {
      bytes += chunk.length;
      if (bytes > MAX_DOWNLOAD) { next(new ActivationError("download")); return; }
      hash.update(chunk); next(null, chunk);
    } }), createWriteStream(destination, { flags: "wx", mode: 0o600 }), { signal: combined });
  } catch (error) { signal?.throwIfAborted(); throw error instanceof ActivationError ? error : new ActivationError("download"); }
  if (hash.digest("base64") !== artifact.digest) throw new ActivationError("integrity");
}

/** Validate the complete archive before writing any member. No link traversal,
 * special files, duplicate paths, extraction hooks or package lifecycle scripts. */
export async function extractActivationArchive(file, directory, { signal } = {}) {
  let bytes = 0; let count = 0; let invalid = false; let archiveRoot;
  const names = new Set();
  const validate = (entry) => {
    const name = entry.path.replace(/\/$/u, "");
    const parts = name.split("/");
    archiveRoot ??= parts[0];
    count++; bytes += entry.size;
    if (count > 20_000 || bytes > MAX_EXPANDED
      || name.length > 4096 || /[\\\0\r\n:]/u.test(name) || parts.some(part => !part || part === "." || part === "..")
      || !["File", "Directory", "OldFile"].includes(entry.type) || names.has(name)
      || parts[0] !== archiveRoot || (parts.length === 1 && entry.type !== "Directory")) invalid = true;
    names.add(name);
  };
  try {
    const parser = new tar.Parser({ strict: true, onReadEntry: (entry) => {
      validate(entry);
      if (invalid) parser.abort(new ActivationError("archive"));
      else entry.resume();
    } });
    await pipeline(createReadStream(file), parser, { signal });
    if (invalid || !count) throw new ActivationError("archive");
    signal?.throwIfAborted();
    const unpack = new tar.Unpack({ cwd: directory, strip: 1, strict: true, preservePaths: false,
      noChmod: false, noMtime: true, filter: (_name, entry) => ["File", "Directory", "OldFile"].includes(entry.type) });
    await pipeline(createReadStream(file), unpack, { signal });
  } catch (error) { signal?.throwIfAborted(); throw error instanceof ActivationError ? error : new ActivationError("archive"); }
}

export function createManagedArtifactInstaller({ homedir, fetch: fetcher = globalThis.fetch,
  download = downloadVerifiedArtifact, extract = extractActivationArchive } = {}) {
  return {
    async install(recipe, { signal, verify, committed = () => {} }) {
      const root = managedInstallationRoot(homedir, recipe.setupId);
      if (!root || !/^[a-zA-Z0-9._-]+$/u.test(recipe.version)) throw new ActivationError("unsupported");
      await fs.mkdir(root, { recursive: true, mode: 0o700 });
      if ((await fs.realpath(root)) !== path.resolve(root)) throw new ActivationError("installation");
      const lockAbort = new AbortController();
      signal = AbortSignal.any([signal, lockAbort.signal]);
      const release = await lockfile.lock(root, { lockfilePath: path.join(root, "install.lock"), stale: 30_000, update: 5000,
        retries: 0, onCompromised: () => lockAbort.abort(new ActivationError("installation-busy")) })
        .catch(() => { throw new ActivationError("installation-busy"); });
      let staging = null; let pointer = null;
      const target = path.join(root, recipe.version);
      const current = path.join(root, "current");
      try {
        signal.throwIfAborted();
        // Only after acquiring the cross-process lease may interrupted staging
        // from a prior process be removed. Active work owns the same lease.
        for (const name of await fs.readdir(root)) {
          if (!/^\.staging-[a-zA-Z0-9]+$/u.test(name)) continue;
          const stale = path.join(root, name);
          const stat = await fs.lstat(stale);
          if (stat.isDirectory() && !stat.isSymbolicLink()) await fs.rm(stale, { recursive: true, force: true });
        }
        signal.throwIfAborted();
        const existing = await fs.lstat(target).catch(error => { if (error.code === "ENOENT") return null; throw error; });
        if (existing) {
          if (!existing.isDirectory() || existing.isSymbolicLink()) throw new ActivationError("installation");
          const receiptPath = path.join(target, "installation.json");
          const receiptStat = await fs.lstat(receiptPath);
          if (!receiptStat.isFile() || receiptStat.isSymbolicLink() || receiptStat.size > 4096) throw new ActivationError("integrity");
          const receipt = JSON.parse(await fs.readFile(receiptPath, "utf8"));
          if (receipt.digest !== recipe.artifact.digest || receipt.version !== recipe.version) throw new ActivationError("integrity");
          await verify(path.join(target, recipe.entry), signal);
        } else {
          staging = await fs.mkdtemp(path.join(root, ".staging-"));
          const archive = path.join(staging, "artifact.tgz");
          const payload = path.join(staging, "payload");
          await fs.mkdir(payload, { mode: 0o700 });
          await download(recipe.artifact, archive, { signal, fetch: fetcher });
          await extract(archive, payload, { signal });
          const binary = path.resolve(payload, recipe.binary);
          if (!binary.startsWith(`${payload}${path.sep}`)) throw new ActivationError("archive");
          const stat = await fs.lstat(binary);
          if (!stat.isFile() || stat.isSymbolicLink()) throw new ActivationError("archive");
          await fs.chmod(binary, 0o755);
          if (recipe.binary !== recipe.entry) await fs.symlink(recipe.binary, path.join(payload, recipe.entry));
          await verify(path.join(payload, recipe.entry), signal);
          await fs.writeFile(path.join(payload, "installation.json"), JSON.stringify({
            version: recipe.version, digest: recipe.artifact.digest, source: recipe.artifact.url,
          }), { flag: "wx", mode: 0o600 });
          signal.throwIfAborted();
          await fs.rename(payload, target);
        }
        signal.throwIfAborted();
        const oldPointer = await fs.lstat(current).catch(error => { if (error.code === "ENOENT") return null; throw error; });
        if (oldPointer && !oldPointer.isSymbolicLink()) throw new ActivationError("installation");
        pointer = path.join(root, `.current-${randomUUID()}`);
        await fs.symlink(recipe.version, pointer);
        signal.throwIfAborted();
        await fs.rename(pointer, current); pointer = null;
        committed(); // Report commit even if cancel won the race during rename.
        return path.join(current, recipe.entry);
      } finally {
        if (pointer) await fs.rm(pointer, { force: true });
        if (staging) await fs.rm(staging, { recursive: true, force: true });
        await release().catch(() => {});
      }
    },
  };
}
