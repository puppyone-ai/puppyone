import { ApiError } from "../../../api.js";
import { rawGet } from "./http.js";
import { scopedPath } from "./paths.js";
import { statPath } from "./remote.js";

export function firstLines(text, count) {
  if (count <= 0) return "";
  let seen = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "\n") {
      seen += 1;
      if (seen >= count) return text.slice(0, i + 1);
    }
  }
  return text;
}

export function lastLines(text, count) {
  if (count <= 0) return "";
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) || [];
  return lines.slice(-count).join("");
}

export async function readRawBuffer(client, path, headers = {}, { start = 0, limit = null } = {}) {
  const query = { path: scopedPath(path) };
  if (start) query.start = start;
  if (limit != null) query.limit = limit;
  const res = await rawGet(client, "/ap-fs/raw", query, headers);
  return {
    buffer: Buffer.from(await res.arrayBuffer()),
    totalSize: Number.parseInt(res.headers.get("x-puppyone-size") || "0", 10) || 0,
  };
}

export async function readHeadBuffer(client, path, headers, { byteCount = null, lineCount = 10 } = {}) {
  if (byteCount != null) {
    return (await readRawBuffer(client, path, headers, { limit: byteCount })).buffer;
  }
  const chunks = [];
  let offset = 0;
  const chunkSize = 64 * 1024;
  let newlineCount = 0;
  while (true) {
    const { buffer } = await readRawBuffer(client, path, headers, { start: offset, limit: chunkSize });
    chunks.push(buffer);
    newlineCount += (buffer.toString("utf8").match(/\n/g) || []).length;
    offset += buffer.length;
    if (newlineCount >= lineCount || buffer.length < chunkSize || buffer.length === 0) break;
  }
  return Buffer.from(firstLines(Buffer.concat(chunks).toString("utf8"), lineCount));
}

export async function readTailBuffer(client, path, headers, { byteCount = null, lineCount = 10 } = {}) {
  const stat = await statPath(client, path, headers);
  if (!stat.exists) throw new ApiError(404, "API_ERROR", `Path not found: ${path || "."}`);
  const total = stat.size_bytes ?? 0;
  if (byteCount != null) {
    const start = Math.max(0, total - byteCount);
    return (await readRawBuffer(client, path, headers, { start, limit: byteCount })).buffer;
  }
  const chunks = [];
  const chunkSize = 64 * 1024;
  let position = total;
  let newlineCount = 0;
  while (position > 0) {
    const start = Math.max(0, position - chunkSize);
    const { buffer } = await readRawBuffer(client, path, headers, { start, limit: position - start });
    chunks.unshift(buffer);
    newlineCount += (buffer.toString("utf8").match(/\n/g) || []).length;
    position = start;
    if (newlineCount > lineCount || buffer.length === 0) break;
  }
  return Buffer.from(lastLines(Buffer.concat(chunks).toString("utf8"), lineCount));
}
