import { getTrustedCorsOrigin } from "../local-file-protocol.mjs";
import { requireAssetId } from "./project-appearance-store.mjs";

const PROJECT_ICON_PROTOCOL = "puppyone-asset";

export function registerProjectIconProtocol({ protocol, store, applicationUrl }) {
  if (!protocol?.handle) throw new TypeError("Electron protocol is required.");
  if (!store?.readAsset) throw new TypeError("Project appearance store is required.");

  protocol.handle(PROJECT_ICON_PROTOCOL, async (request) => {
    try {
      if (request.method && request.method !== "GET" && request.method !== "HEAD") {
        return new Response("Method not allowed", { status: 405 });
      }
      const corsOrigin = getTrustedCorsOrigin(request, applicationUrl);
      if (corsOrigin === false) return new Response("Forbidden", { status: 403 });
      const assetId = parseProjectIconAssetUrl(request.url);
      const bytes = await store.readAsset(assetId);
      const headers = {
        "Content-Type": "image/png",
        "Content-Length": String(bytes.length),
        "Cache-Control": "private, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
        ...(corsOrigin ? { "Access-Control-Allow-Origin": corsOrigin, Vary: "Origin" } : {}),
      };
      return new Response(request.method === "HEAD" ? null : bytes, { status: 200, headers });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
}

export function buildProjectIconAssetUrl(assetId) {
  return `${PROJECT_ICON_PROTOCOL}://project-icon/${requireAssetId(assetId)}.png`;
}

export function parseProjectIconAssetUrl(rawUrl) {
  const url = new URL(rawUrl);
  if (
    url.protocol !== `${PROJECT_ICON_PROTOCOL}:`
    || url.hostname !== "project-icon"
    || url.username
    || url.password
    || url.port
    || url.search
    || url.hash
  ) {
    throw new Error("Invalid Project icon asset URL.");
  }
  const match = /^\/([a-f0-9]{64})\.png$/.exec(url.pathname);
  if (!match) throw new Error("Invalid Project icon asset path.");
  return requireAssetId(match[1]);
}
