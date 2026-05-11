import { ApiError } from "../../../api.js";
import { get } from "./http.js";
import { basename, hasTrailingSlash, joinPath, scopedPath } from "./paths.js";

export async function statPath(client, path, headers = {}) {
  return get(client, "/ap-fs/stat", { path: scopedPath(path) }, headers);
}

export async function promptYesNo(question) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new ApiError(0, "INTERACTIVE_REQUIRED", "Interactive confirmation requires a TTY.");
  }
  const { createInterface } = await import("node:readline/promises");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`${question} `);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

export async function remoteIsDirectory(client, path, headers = {}) {
  const stat = await statPath(client, path, headers);
  return !!stat.exists && stat.type === "folder";
}

export async function resolveTransferDestination(client, srcName, dstRaw, headers = {}, { multipleSources = false } = {}) {
  const cleanDst = scopedPath(dstRaw);
  if (multipleSources || hasTrailingSlash(dstRaw) || await remoteIsDirectory(client, cleanDst, headers)) {
    return joinPath(cleanDst, srcName);
  }
  return cleanDst;
}

export { basename };
