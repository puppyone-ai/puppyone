import {
  DESKTOP_STABLE_LATEST_POINTER_URL,
  DESKTOP_STABLE_UPDATE_METADATA_NAME,
  DESKTOP_SUPPORTED_STABLE_UPDATE_FEED_URLS,
} from "../../shared/desktop-distribution-contract.mjs";

const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const SHA512_BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

export function parseDesktopUpdaterMetadata(source, { platform = "macos" } = {}) {
  if (typeof source !== "string" || source.trim().length === 0) {
    throw new Error("Desktop updater metadata is empty.");
  }

  const metadata = {
    version: null,
    files: [],
    path: null,
    sha512: null,
    releaseDate: null,
  };
  let readingFiles = false;
  let currentFile = null;

  for (const rawLine of source.split(/\r?\n/)) {
    if (!rawLine.trim() || rawLine.trimStart().startsWith("#")) continue;
    const indentation = rawLine.length - rawLine.trimStart().length;
    const line = rawLine.trim();

    if (indentation === 0) {
      readingFiles = false;
      currentFile = null;
      const entry = parseMappingEntry(line);
      if (!entry) continue;
      if (entry.key === "files" && entry.value === "") {
        readingFiles = true;
      } else if (entry.key === "version") {
        metadata.version = parseScalar(entry.value);
      } else if (entry.key === "path") {
        metadata.path = parseScalar(entry.value);
      } else if (entry.key === "sha512") {
        metadata.sha512 = parseScalar(entry.value);
      } else if (entry.key === "releaseDate") {
        metadata.releaseDate = parseScalar(entry.value);
      }
      continue;
    }

    if (!readingFiles) continue;
    const fileStart = /^-\s+url:\s*(.+)$/.exec(line);
    if (fileStart) {
      currentFile = {
        url: parseScalar(fileStart[1]),
        sha512: null,
        size: null,
      };
      metadata.files.push(currentFile);
      continue;
    }
    if (!currentFile) continue;
    const entry = parseMappingEntry(line);
    if (!entry) continue;
    if (entry.key === "sha512") {
      currentFile.sha512 = parseScalar(entry.value);
    } else if (entry.key === "size") {
      currentFile.size = Number.parseInt(parseScalar(entry.value), 10);
    }
  }

  const errors = [];
  if (!VERSION_PATTERN.test(String(metadata.version ?? ""))) {
    errors.push("version must be a semantic version");
  }
  if (!Array.isArray(metadata.files) || metadata.files.length === 0) {
    errors.push("files must contain at least one update payload");
  }
  for (const file of metadata.files) {
    if (!file.url) errors.push("every update file must declare a URL");
    if (!isSha512Base64(file.sha512)) {
      errors.push(`${file.url || "update file"} must declare a base64 SHA-512 digest`);
    }
    if (!Number.isSafeInteger(file.size) || file.size <= 0) {
      errors.push(`${file.url || "update file"} must declare a positive byte size`);
    }
  }
  const payloadPattern = platform === "windows"
    ? /\.exe(?:$|[?#])/i
    : /\.zip(?:$|[?#])/i;
  if (!metadata.files.some(({ url }) => payloadPattern.test(String(url)))) {
    errors.push(`${platform === "windows" ? "Windows" : "macOS"} updater metadata must include a ${platform === "windows" ? "NSIS executable" : "ZIP"} payload`);
  }
  const primaryFile = metadata.files.find(({ url }) => url === metadata.path);
  if (!metadata.path || !primaryFile) {
    errors.push("path must identify one declared update file");
  } else if (metadata.sha512 !== primaryFile.sha512) {
    errors.push("top-level sha512 must match the primary update file");
  }
  if (!metadata.releaseDate || Number.isNaN(Date.parse(metadata.releaseDate))) {
    errors.push("releaseDate must be a valid timestamp");
  }
  if (new Set(metadata.files.map(({ url }) => url)).size !== metadata.files.length) {
    errors.push("update file URLs must be unique");
  }
  if (errors.length > 0) {
    throw new Error(`Invalid Desktop updater metadata:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  }

  return Object.freeze({
    ...metadata,
    files: Object.freeze(metadata.files.map((file) => Object.freeze({ ...file }))),
  });
}

export async function verifyDesktopStableUpdateFeeds({
  attempts = 3,
  expectedVersion = null,
  feedUrls = DESKTOP_SUPPORTED_STABLE_UPDATE_FEED_URLS,
  fetchImpl = globalThis.fetch,
  latestPointerUrl = DESKTOP_STABLE_LATEST_POINTER_URL,
  metadataName = DESKTOP_STABLE_UPDATE_METADATA_NAME,
  platform = "macos",
  retryDelayMs = 500,
  timeoutMs = 20_000,
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("Desktop update feed verification requires fetch.");
  }
  if (!Array.isArray(feedUrls) || feedUrls.length === 0) {
    throw new Error("At least one shipped Stable update feed is required.");
  }
  if (new Set(feedUrls).size !== feedUrls.length) {
    throw new Error("Shipped Stable update feeds must be unique.");
  }
  for (const [label, value, minimum] of [
    ["attempts", attempts, 1],
    ["retryDelayMs", retryDelayMs, 0],
    ["timeoutMs", timeoutMs, 1],
  ]) {
    if (!Number.isSafeInteger(value) || value < minimum) {
      throw new Error(`${label} must be an integer greater than or equal to ${minimum}.`);
    }
  }
  if (expectedVersion != null && !VERSION_PATTERN.test(String(expectedVersion))) {
    throw new Error(`Invalid expected Stable version: ${String(expectedVersion)}`);
  }

  const pointerUrl = normalizeHttpsUrl(latestPointerUrl, "latest pointer");
  const latestPointer = await fetchJson(pointerUrl, {
    attempts,
    fetchImpl,
    retryDelayMs,
    timeoutMs,
  });
  validateLatestPointer(latestPointer, expectedVersion);

  const reports = [];
  for (const feedUrl of feedUrls) {
    const normalizedFeedUrl = normalizeHttpsUrl(feedUrl, "Stable feed").replace(/\/+$/, "");
    const metadataUrl = `${normalizedFeedUrl}/${metadataName}`;
    const source = await fetchText(metadataUrl, {
      attempts,
      fetchImpl,
      retryDelayMs,
      timeoutMs,
    });
    const metadata = parseDesktopUpdaterMetadata(source, { platform });
    const requiredVersion = expectedVersion ?? latestPointer.version;
    if (metadata.version !== requiredVersion) {
      throw new Error(
        `${metadataUrl} reports ${metadata.version}, expected ${requiredVersion}.`,
      );
    }
    if (latestPointer.version !== metadata.version) {
      throw new Error(
        `${pointerUrl} reports ${latestPointer.version}, but ${metadataUrl} reports ${metadata.version}.`,
      );
    }

    const payloads = [];
    for (const file of metadata.files) {
      const payloadUrl = resolveFeedPayloadUrl(normalizedFeedUrl, file.url);
      await verifyRangeResponse(payloadUrl, file.size, {
        attempts,
        fetchImpl,
        retryDelayMs,
        timeoutMs,
      });
      payloads.push(payloadUrl);
    }
    reports.push(Object.freeze({
      feedUrl: normalizedFeedUrl,
      metadataUrl,
      payloads: Object.freeze(payloads),
      version: metadata.version,
    }));
  }

  return Object.freeze({
    latestPointerUrl: pointerUrl,
    reports: Object.freeze(reports),
    version: latestPointer.version,
  });
}

function parseMappingEntry(line) {
  const separator = line.indexOf(":");
  if (separator < 0) return null;
  return {
    key: line.slice(0, separator).trim(),
    value: line.slice(separator + 1).trim(),
  };
}

function parseScalar(value) {
  const normalized = String(value ?? "").trim();
  if (
    normalized.length >= 2
    && ((normalized.startsWith("'") && normalized.endsWith("'"))
      || (normalized.startsWith("\"") && normalized.endsWith("\"")))
  ) {
    return normalized.slice(1, -1);
  }
  return normalized;
}

function isSha512Base64(value) {
  const normalized = String(value ?? "");
  if (
    !SHA512_BASE64_PATTERN.test(normalized)
    || normalized.length % 4 !== 0
  ) {
    return false;
  }
  const bytes = Buffer.from(normalized, "base64");
  return bytes.byteLength === 64 && bytes.toString("base64") === normalized;
}

function normalizeHttpsUrl(value, label) {
  const url = new URL(value);
  if (
    url.protocol !== "https:"
    || url.username
    || url.password
    || url.search
    || url.hash
  ) {
    throw new Error(`${label} must be a credential-free HTTPS URL without query or fragment.`);
  }
  return url.href;
}

function resolveFeedPayloadUrl(feedUrl, value) {
  const base = new URL(`${feedUrl.replace(/\/+$/, "")}/`);
  const resolved = new URL(value, base);
  const basePath = base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`;
  if (
    resolved.protocol !== "https:"
    || resolved.username
    || resolved.password
    || resolved.origin !== base.origin
    || !resolved.pathname.startsWith(basePath)
  ) {
    throw new Error(`Update payload must stay under its feed origin and path: ${resolved.href}`);
  }
  return resolved.href;
}

function validateLatestPointer(pointer, expectedVersion) {
  if (!pointer || typeof pointer !== "object" || Array.isArray(pointer)) {
    throw new Error("Stable latest.json must be an object.");
  }
  if (pointer.channel !== "stable") {
    throw new Error(`Stable latest.json has channel ${String(pointer.channel)}.`);
  }
  if (!VERSION_PATTERN.test(String(pointer.version ?? ""))) {
    throw new Error("Stable latest.json must declare a semantic version.");
  }
  if (pointer.tag !== `v${pointer.version}`) {
    throw new Error("Stable latest.json tag must match its version.");
  }
  if (expectedVersion != null && pointer.version !== expectedVersion) {
    throw new Error(
      `Stable latest.json reports ${pointer.version}, expected ${expectedVersion}.`,
    );
  }
}

async function fetchJson(url, options) {
  const response = await requestWithRetry(url, {}, options);
  try {
    return await response.json();
  } catch (error) {
    throw new Error(`${url} did not return valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function fetchText(url, options) {
  const response = await requestWithRetry(url, {}, options);
  return response.text();
}

async function verifyRangeResponse(url, expectedBytes, options) {
  const response = await requestWithRetry(url, {
    headers: {
      Range: "bytes=0-0",
    },
    acceptedStatuses: [206],
  }, options);
  const contentRange = response.headers.get("content-range");
  const match = /^bytes 0-0\/(\d+)$/.exec(contentRange ?? "");
  if (!match) {
    await response.body?.cancel();
    throw new Error(`${url} did not return a valid one-byte Content-Range.`);
  }
  const totalBytes = Number.parseInt(match[1], 10);
  if (totalBytes !== expectedBytes) {
    await response.body?.cancel();
    throw new Error(`${url} reports ${totalBytes} bytes, expected ${expectedBytes}.`);
  }
  const body = new Uint8Array(await response.arrayBuffer());
  if (body.byteLength !== 1) {
    throw new Error(`${url} returned ${body.byteLength} bytes for a one-byte Range request.`);
  }
}

async function requestWithRetry(url, requestOptions, {
  attempts,
  fetchImpl,
  retryDelayMs,
  timeoutMs,
}) {
  let lastError;
  const acceptedStatuses = requestOptions.acceptedStatuses ?? [];
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
        ...requestOptions,
        headers: {
          "Cache-Control": "no-cache",
          "User-Agent": "puppyone-update-feed-verifier/1",
          ...(requestOptions.headers ?? {}),
        },
      });
      const statusAccepted = acceptedStatuses.length > 0
        ? acceptedStatuses.includes(response.status)
        : response.ok;
      if (!statusAccepted) {
        await response.body?.cancel();
        throw new Error(`HTTP ${response.status}`);
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < attempts && retryDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, attempt * retryDelayMs));
      }
    }
  }
  throw new Error(
    `${url} failed after ${attempts} attempt(s): ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}
