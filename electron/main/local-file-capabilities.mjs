import { randomBytes } from "node:crypto";
import path from "node:path";

const DEFAULT_MAX_CAPABILITIES_PER_SENDER = 2_048;
const LOCAL_FILE_CAPABILITY_PURPOSES = new Set(["file-preview", "markdown-asset"]);

/**
 * Issues opaque, sender-owned, purpose/resource-scoped bearer leases for local
 * resources. Public URLs contain no workspace path. Markdown leases are unique
 * so revoking one mounted handle cannot invalidate a sibling consumer.
 */
export function createLocalFileCapabilityStore({
  createToken = () => randomBytes(32).toString("base64url"),
  maxCapabilitiesPerSender = DEFAULT_MAX_CAPABILITIES_PER_SENDER,
} = {}) {
  if (!Number.isSafeInteger(maxCapabilitiesPerSender) || maxCapabilitiesPerSender <= 0) {
    throw new TypeError("Local file capability limit must be a positive safe integer.");
  }

  const entriesByToken = new Map();
  const entriesBySender = new Map();

  function issue({
    senderId,
    rootPath,
    relativePath,
    scope = "exact",
    purpose = "file-preview",
    reuse = true,
  }) {
    const normalizedSenderId = requireSenderId(senderId);
    const normalizedRoot = path.resolve(requireNonEmpty(rootPath, "Capability workspace root is required."));
    const normalizedRelative = normalizeRelativePath(relativePath);
    const normalizedScope = requireScope(scope);
    const normalizedPurpose = requirePurpose(purpose);
    const scopePath = normalizedScope === "directory"
      ? path.posix.dirname(normalizedRelative).replace(/^\.$/, "")
      : normalizedRelative;
    const publicPath = path.posix.basename(normalizedRelative);
    let senderEntries = entriesBySender.get(normalizedSenderId);
    if (!senderEntries) {
      senderEntries = new Map();
      entriesBySender.set(normalizedSenderId, senderEntries);
    }

    const baseKey = `${normalizedRoot}\0${normalizedScope}\0${scopePath}\0${normalizedPurpose}`;
    const existing = reuse ? senderEntries.get(baseKey) : null;
    if (existing && entriesByToken.has(existing.token)) {
      senderEntries.delete(baseKey);
      senderEntries.set(baseKey, existing);
      return existing.token;
    }

    let token;
    do {
      token = requireToken(createToken());
    } while (entriesByToken.has(token));
    const key = reuse ? baseKey : `${baseKey}\0${token}`;
    const entry = {
      token,
      senderId: normalizedSenderId,
      rootPath: normalizedRoot,
      scope: normalizedScope,
      scopePath,
      publicPath,
      purpose: normalizedPurpose,
      key,
    };
    entriesByToken.set(token, entry);
    senderEntries.set(key, entry);
    while (senderEntries.size > maxCapabilitiesPerSender) {
      const oldest = senderEntries.values().next().value;
      if (!oldest) break;
      senderEntries.delete(oldest.key);
      entriesByToken.delete(oldest.token);
    }
    return token;
  }

  function validate({ token, rootPath, relativePath, purpose = "file-preview" }) {
    if (typeof token !== "string" || token.length === 0) return false;
    const entry = entriesByToken.get(token);
    if (!entry) return false;
    let normalizedRoot;
    let normalizedRelative;
    let normalizedPurpose;
    try {
      normalizedRoot = path.resolve(requireNonEmpty(rootPath, "Capability workspace root is required."));
      normalizedRelative = normalizeRelativePath(relativePath);
      normalizedPurpose = requirePurpose(purpose);
    } catch {
      return false;
    }
    if (entry.rootPath !== normalizedRoot || entry.purpose !== normalizedPurpose) return false;
    if (entry.scope === "exact") return entry.scopePath === normalizedRelative;
    return entry.scopePath === ""
      || normalizedRelative === entry.scopePath
      || normalizedRelative.startsWith(`${entry.scopePath}/`);
  }

  function resolve({ token, purpose, requestPath }) {
    if (typeof token !== "string" || token.length === 0) return null;
    const entry = entriesByToken.get(token);
    if (!entry) return null;
    let normalizedPurpose;
    let normalizedRequestPath;
    try {
      normalizedPurpose = requirePurpose(purpose);
      normalizedRequestPath = normalizeRelativePath(requestPath);
    } catch {
      return null;
    }
    if (entry.purpose !== normalizedPurpose) return null;
    if (entry.scope === "exact") {
      if (normalizedRequestPath !== entry.publicPath) return null;
      return { rootPath: entry.rootPath, relativePath: entry.scopePath };
    }
    const relativePath = entry.scopePath
      ? `${entry.scopePath}/${normalizedRequestPath}`
      : normalizedRequestPath;
    return { rootPath: entry.rootPath, relativePath };
  }

  /** Resolves a capability only for its issuing renderer. Main-process
   * admission gates use this before delegating the bearer URL to a child. */
  function inspect({ token, purpose, requestPath, senderId }) {
    if (!Number.isSafeInteger(senderId)) return null;
    const entry = typeof token === "string" ? entriesByToken.get(token) : null;
    if (!entry || entry.senderId !== senderId) return null;
    return resolve({ token, purpose, requestPath });
  }

  function revoke({ token, senderId }) {
    if (typeof token !== "string" || !Number.isSafeInteger(senderId)) return false;
    const entry = entriesByToken.get(token);
    if (!entry || entry.senderId !== senderId) return false;
    entriesByToken.delete(token);
    const senderEntries = entriesBySender.get(senderId);
    senderEntries?.delete(entry.key);
    if (senderEntries?.size === 0) entriesBySender.delete(senderId);
    return true;
  }

  function revokeSender(senderId) {
    if (!Number.isSafeInteger(senderId)) return;
    const senderEntries = entriesBySender.get(senderId);
    if (!senderEntries) return;
    for (const entry of senderEntries.values()) entriesByToken.delete(entry.token);
    entriesBySender.delete(senderId);
  }

  function revokeWorkspaceRoot(senderId, rootPath) {
    if (!Number.isSafeInteger(senderId) || typeof rootPath !== "string" || !rootPath.trim()) return 0;
    const normalizedRoot = path.resolve(rootPath);
    const senderEntries = entriesBySender.get(senderId);
    if (!senderEntries) return 0;
    let revoked = 0;
    for (const entry of Array.from(senderEntries.values())) {
      if (entry.rootPath !== normalizedRoot) continue;
      senderEntries.delete(entry.key);
      entriesByToken.delete(entry.token);
      revoked += 1;
    }
    if (senderEntries.size === 0) entriesBySender.delete(senderId);
    return revoked;
  }

  return Object.freeze({ issue, validate, resolve, inspect, revoke, revokeSender, revokeWorkspaceRoot });
}

export function buildLocalFileCapabilityUrl({
  relativePath,
  token,
  purpose = "file-preview",
}) {
  const encodedPurpose = encodeURIComponent(requirePurpose(purpose));
  const encodedName = encodeURIComponent(path.posix.basename(normalizeRelativePath(relativePath)));
  return `puppyone-local://file/${encodeURIComponent(requireToken(token))}/${encodedPurpose}/${encodedName}`;
}

function normalizeRelativePath(value) {
  const raw = requireNonEmpty(value, "Local file path is required.");
  if (path.isAbsolute(raw)) throw new Error("Local file path must be relative.");
  const segments = raw.replaceAll("\\", "/").split("/").filter(Boolean);
  if (segments.length === 0 || segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error("Local file path is invalid.");
  }
  return segments.join("/");
}

function requireSenderId(value) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("Capability sender is invalid.");
  return value;
}

function requireNonEmpty(value, message) {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(message);
  return value.trim();
}

function requireToken(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{32,256}$/.test(value)) {
    throw new Error("Local file capability token is invalid.");
  }
  return value;
}

function requireScope(value) {
  if (value === "exact" || value === "directory") return value;
  throw new Error("Local file capability scope is invalid.");
}

function requirePurpose(value) {
  if (LOCAL_FILE_CAPABILITY_PURPOSES.has(value)) return value;
  throw new Error("Local file capability purpose is invalid.");
}
