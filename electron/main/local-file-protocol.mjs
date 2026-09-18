import { Readable } from "node:stream";
import { parseSingleByteRange } from "../../local-api/files/byte-range.mjs";

export function registerLocalFileProtocol({
  protocol,
  readWorkspaceFile,
  openWorkspaceFileRangeStream,
  statWorkspaceFile,
  getMimeType,
  canonicalizeWorkspacePath,
  isOpenWorkspaceRoot,
  resolveCapability,
  applicationUrl,
}) {
  protocol.handle("puppyone-local", async (request) => {
    try {
      if (request.method && request.method !== "GET" && request.method !== "HEAD") {
        return new Response("Method not allowed", { status: 405 });
      }
      const corsOrigin = getTrustedCorsOrigin(request, applicationUrl);
      if (corsOrigin === false) return new Response("Forbidden", { status: 403 });

      // Chromium includes the navigation fragment in custom-protocol requests,
      // unlike HTTP. Fragments are client-side Viewer state (for example PDF
      // page/zoom/chrome flags), never part of capability authorization.
      const capabilityUrl = new URL(request.url);
      capabilityUrl.hash = "";
      const { token, purpose, requestPath } = parseLocalFileUrl(capabilityUrl.toString());
      const capability = typeof resolveCapability === "function"
        ? resolveCapability({ token, purpose, requestPath })
        : null;
      if (!capability) return new Response("Forbidden", { status: 403 });
      const { rootPath, relativePath } = capability;
      const canonicalRoot = typeof canonicalizeWorkspacePath === "function"
        ? await canonicalizeWorkspacePath(rootPath)
        : rootPath;

      if (typeof isOpenWorkspaceRoot === "function" && !isOpenWorkspaceRoot(canonicalRoot)) {
        return new Response("Forbidden", { status: 403 });
      }
      const contentType = getMimeType(relativePath) ?? "application/octet-stream";
      const corsHeaders = corsOrigin
        ? { "Access-Control-Allow-Origin": corsOrigin, Vary: "Origin" }
        : {};
      const securityHeaders = {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      };
      if (capability.snapshot) {
        const bytes = capability.snapshot.bytes;
        const range = parseSingleByteRange(request.headers.get("range"), bytes.length);
        if (range?.unsatisfiable) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${bytes.length}`, ...securityHeaders, ...corsHeaders } });
        const body = range ? bytes.subarray(range.start, range.end + 1) : bytes;
        return new Response(request.method === "HEAD" ? null : body, {
          status: range ? 206 : 200,
          headers: { "Content-Type": contentType, "Content-Length": String(body.length), "Accept-Ranges": "bytes",
            "ETag": `"${capability.snapshot.version}"`,
            ...(range ? { "Content-Range": `bytes ${range.start}-${range.end}/${bytes.length}` } : {}),
            ...securityHeaders, ...corsHeaders },
        });
      }
      if (request.method === "HEAD") {
        if (typeof statWorkspaceFile !== "function") {
          return new Response("Method not implemented", { status: 501 });
        }
        const metadata = await statWorkspaceFile(canonicalRoot, relativePath);
        return new Response(null, {
          status: 200,
          headers: {
            "Content-Type": contentType,
            "Content-Length": String(metadata.size),
            "Accept-Ranges": "bytes",
            ...securityHeaders,
            ...corsHeaders,
          },
        });
      }
      const rangeHeader = request.headers.get("range");
      if (rangeHeader && typeof openWorkspaceFileRangeStream === "function") {
        const fileResult = await openWorkspaceFileRangeStream(
          canonicalRoot,
          relativePath,
          rangeHeader,
        );
        if (fileResult.unsatisfiable || !fileResult.stream) {
          return new Response(null, {
            status: 416,
            headers: {
              "Content-Range": `bytes */${fileResult.size}`,
              "Accept-Ranges": "bytes",
              ...securityHeaders,
              ...corsHeaders,
            },
          });
        }

        return new Response(Readable.toWeb(fileResult.stream), {
          status: 206,
          headers: {
            "Content-Type": contentType,
            "Content-Length": String(fileResult.end - fileResult.start + 1),
            "Content-Range": `bytes ${fileResult.start}-${fileResult.end}/${fileResult.size}`,
            "Accept-Ranges": "bytes",
            ...securityHeaders,
            ...corsHeaders,
          },
        });
      }
      const fileResult = await readWorkspaceFile(canonicalRoot, relativePath, { rangeHeader });
      if (fileResult?.unsatisfiable) {
        return new Response(null, {
          status: 416,
          headers: {
            "Content-Range": `bytes */${fileResult.size}`,
            "Accept-Ranges": "bytes",
            ...securityHeaders,
            ...corsHeaders,
          },
        });
      }

      const bytes = Buffer.isBuffer(fileResult) ? fileResult : fileResult.bytes;
      const size = Buffer.isBuffer(fileResult) ? bytes.length : fileResult.size;
      const headers = {
        "Content-Type": contentType,
        "Content-Length": String(bytes.length),
        "Accept-Ranges": "bytes",
        ...securityHeaders,
        ...corsHeaders,
      };
      const responseInit = {
        status: Buffer.isBuffer(fileResult) || !fileResult.partial ? 200 : 206,
        headers,
      };

      if (!Buffer.isBuffer(fileResult) && fileResult.partial) {
        responseInit.headers = {
          ...headers,
          "Content-Range": `bytes ${fileResult.start}-${fileResult.end}/${size}`,
        };
      }

      return new Response(bytes, responseInit);
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
}

export function parseLocalFileUrl(rawUrl) {
  const url = new URL(rawUrl);
  if (
    url.protocol !== "puppyone-local:" ||
    url.hostname !== "file" ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash
  ) {
    throw new Error("Invalid local file capability URL.");
  }
  const segments = url.pathname.replace(/^\/+/, "").split("/").filter(Boolean);
  const encodedToken = segments.shift();
  const encodedPurpose = segments.shift();
  if (!encodedToken || !encodedPurpose || segments.length === 0) {
    throw new Error("Incomplete local file capability URL.");
  }
  return {
    token: decodeURIComponent(encodedToken),
    purpose: decodeURIComponent(encodedPurpose),
    requestPath: segments.map((segment) => decodeURIComponent(segment)).join("/"),
  };
}

export function getTrustedCorsOrigin(request, applicationValue) {
  const origin = request?.headers?.get?.("origin") ?? null;
  if (!origin) return null;

  let applicationUrl;
  try {
    applicationUrl = new URL(applicationValue);
  } catch {
    return false;
  }
  if (applicationUrl.protocol === "file:") return origin === "null" ? "null" : false;
  if (applicationUrl.protocol === "http:" || applicationUrl.protocol === "https:") {
    return origin === applicationUrl.origin ? origin : false;
  }
  return false;
}
