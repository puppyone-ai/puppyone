export async function localPathInfo(path) {
  const { stat } = await import("node:fs/promises");
  try {
    return await stat(path);
  } catch (e) {
    if (e?.code === "ENOENT") return null;
    throw e;
  }
}

export async function localExists(path) {
  return (await localPathInfo(path)) != null;
}

export async function collectLocalFiles(path, { maxDepth = -1, limit = 5000 } = {}) {
  const { readdir, stat } = await import("node:fs/promises");
  const nodePath = await import("node:path");
  const files = [];
  let truncated = false;

  async function walk(current, relBase = "", depth = 0) {
    if (files.length >= limit) {
      truncated = true;
      return;
    }
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (files.length >= limit) {
        truncated = true;
        return;
      }
      const full = nodePath.join(current, entry.name);
      const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (maxDepth < 0 || depth < maxDepth) {
          await walk(full, rel, depth + 1);
        }
      } else if (entry.isFile()) {
        files.push({ localPath: full, relativePath: rel, stat: await stat(full) });
      }
    }
  }

  await walk(path);
  return {
    files,
    complete: !truncated,
    truncated,
    limit,
    returnedCount: files.length,
  };
}

export async function writeLocalFile(path, content, { force = false, noClobber = false } = {}) {
  const { mkdir, writeFile } = await import("node:fs/promises");
  const nodePath = await import("node:path");
  if (noClobber && await localExists(path)) return false;
  if (!force && noClobber && await localExists(path)) return false;
  await mkdir(nodePath.dirname(path), { recursive: true });
  await writeFile(path, content);
  return true;
}
