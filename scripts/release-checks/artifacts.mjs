import { createHash } from "node:crypto";
import { cp, lstat, mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";

/** Read a deterministic tree identity, including write times for freshness. */
export async function inspectArtifact(root) {
  const files = [];
  async function visit(target, relative) {
    const metadata = await lstat(target, { bigint: true });
    if (metadata.isSymbolicLink()) throw new Error(`Evidence cannot contain a mutable symbolic link: ${target}`);
    if (metadata.isDirectory()) {
      files.push({ path: relative, kind: "directory", modified: String(metadata.mtimeNs) });
      for (const name of (await readdir(target)).sort()) await visit(path.join(target, name), `${relative}/${name}`);
    } else if (metadata.isFile()) {
      const content = await readFile(target);
      files.push({ path: relative, kind: "file", size: content.length, modified: String(metadata.mtimeNs), sha256: createHash("sha256").update(content).digest("hex") });
    } else throw new Error(`Unsupported evidence entry: ${target}`);
  }
  try { await visit(root, "."); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
  const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  return {
    sha256: hash(files.map(({ modified, ...entry }) => entry)),
    writeIdentity: hash(files),
    fileCount: files.filter((entry) => entry.kind === "file").length,
    bytes: files.reduce((sum, entry) => sum + (entry.size ?? 0), 0),
  };
}

/** Archive repository outputs immediately, before another check can replace them. */
export async function retainArtifact({ artifactPath, checkDir, index, before }) {
  const current = await inspectArtifact(artifactPath);
  if (!current) return { exists: false };
  const fresh = !before || current.writeIdentity !== before.writeIdentity;
  const archive = path.join(checkDir, "artifacts", `${index}-${path.basename(artifactPath)}`);
  await mkdir(path.dirname(archive), { recursive: true });
  await cp(artifactPath, archive, { recursive: true, force: false, errorOnExist: true });
  const [retained, after] = await Promise.all([inspectArtifact(archive), inspectArtifact(artifactPath)]);
  if (!after || after.writeIdentity !== current.writeIdentity || retained.sha256 !== current.sha256) {
    throw new Error(`Evidence changed while being archived: ${artifactPath}`);
  }
  return { exists: true, fresh, archive, sha256: retained.sha256, fileCount: retained.fileCount, bytes: retained.bytes };
}
