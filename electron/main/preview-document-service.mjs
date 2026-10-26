import { randomBytes } from "node:crypto";

export const PREVIEW_DOCUMENT_SCHEME = "puppyone-preview";
export const PREVIEW_DOCUMENT_PRIVILEGES = { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true };
const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;
const MAX_OWNER_BYTES = 64 * 1024 * 1024;

/** Immutable, sender-owned HTML projections. This service has no filesystem,
 * workspace or network access. A real protocol document avoids inheriting the
 * renderer's script CSP through srcdoc/blob, while keeping an opaque sandbox. */
export function createPreviewDocumentService() {
  const documents = new Map();
  const tokenOf = (url) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== `${PREVIEW_DOCUMENT_SCHEME}:` || parsed.host !== "document"
        || parsed.search || parsed.hash) return null;
      return /^\/([A-Za-z0-9_-]{43})\/index\.html$/.exec(parsed.pathname)?.[1] ?? null;
    } catch { return null; }
  };
  return {
    create(owner, { content, interactive = false } = {}) {
      if (!Number.isSafeInteger(owner) || owner < 0 || typeof content !== "string" || content.length > MAX_DOCUMENT_BYTES) {
        throw new Error("Invalid preview document.");
      }
      const bytes = Buffer.from(content, "utf8");
      const owned = [...documents.values()].filter((entry) => entry.owner === owner);
      if (bytes.length > MAX_DOCUMENT_BYTES || owned.length >= 128
        || owned.reduce((total, entry) => total + entry.bytes.length, bytes.length) > MAX_OWNER_BYTES) {
        throw new Error("Preview document budget exceeded.");
      }
      const token = randomBytes(32).toString("base64url");
      documents.set(token, { owner, bytes, interactive: interactive === true });
      return { url: `${PREVIEW_DOCUMENT_SCHEME}://document/${token}/index.html` };
    },
    revoke(owner, url) {
      const token = tokenOf(url);
      if (!token || documents.get(token)?.owner !== owner) return false;
      return documents.delete(token);
    },
    revokeOwner(owner) {
      for (const [token, entry] of documents) if (entry.owner === owner) documents.delete(token);
    },
    handle(request) {
      const entry = documents.get(tokenOf(request.url));
      if (!entry) return new Response(null, { status: 404 });
      if (!["GET", "HEAD"].includes(request.method ?? "GET")) return new Response(null, { status: 405 });
      return new Response(request.method === "HEAD" ? null : entry.bytes, { headers: {
        "Content-Type": "text/html; charset=utf-8", "Content-Length": String(entry.bytes.length),
        "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": entry.interactive
          ? "sandbox allow-scripts allow-forms allow-modals allow-downloads allow-popups"
          : "sandbox allow-scripts",
      } });
    },
  };
}

export function registerPreviewDocumentIpc(ipcMain, service) {
  ipcMain.handle("preview-document:create", (event, request) => service.create(event.sender.id, request));
  ipcMain.handle("preview-document:revoke", (event, request) => ({ revoked: service.revoke(event.sender.id, request?.url) }));
}
