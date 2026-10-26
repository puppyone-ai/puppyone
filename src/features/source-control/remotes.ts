import type { GitRemoteSummary, GitStatusSnapshot } from "../../types/electron";

export type PuppyoneRemoteInfo = {
  kind: "access-point" | "project" | "scope";
  host: string;
  origin: string;
  displayId: string;
  projectId?: string;
  scopeId?: string;
  accessKey?: string;
};

export type PuppyoneRemoteCandidate = {
  remote: GitRemoteSummary;
  direction: "fetch" | "push";
  rawUrl: string;
  info: PuppyoneRemoteInfo;
};

export type PuppyoneRemoteResolution =
  | { status: "none"; candidates: [] }
  | {
      status: "unique";
      candidates: PuppyoneRemoteCandidate[];
      remote: GitRemoteSummary;
      rawUrl: string;
      info: PuppyoneRemoteInfo;
    }
  | { status: "conflict"; candidates: PuppyoneRemoteCandidate[] };

const CANONICAL_GIT_ID = "[A-Za-z0-9][A-Za-z0-9_-]{0,199}";
const CANONICAL_SCOPE_REMOTE = new RegExp(
  `^/git/(${CANONICAL_GIT_ID})/scopes/(${CANONICAL_GIT_ID})\\.git$`,
);
const CANONICAL_PROJECT_REMOTE = new RegExp(
  `^/git/(${CANONICAL_GIT_ID})\\.git$`,
);

export function getPuppyoneRemote(status: GitStatusSnapshot | null): {
  remote: GitRemoteSummary;
  rawUrl: string;
  info: PuppyoneRemoteInfo;
} | null {
  const resolution = resolvePuppyoneRemotes(status);
  return resolution.status === "unique"
    ? {
        remote: resolution.remote,
        rawUrl: resolution.rawUrl,
        info: resolution.info,
      }
    : null;
}

/** Return the one credential-free canonical Project/Scope remote, if any. */
export function getCanonicalPuppyoneRemote(status: GitStatusSnapshot | null): {
  remote: GitRemoteSummary;
  rawUrl: string;
  info: PuppyoneRemoteInfo & { kind: "project" | "scope" };
} | null {
  const resolution = resolveCanonicalPuppyoneRemotes(status);
  return resolution.status === "unique"
    ? {
        remote: resolution.remote,
        rawUrl: resolution.rawUrl,
        info: resolution.info as PuppyoneRemoteInfo & { kind: "project" | "scope" },
      }
    : null;
}

/**
 * Collect every recognized PuppyOne fetch/push locator before choosing a
 * target. Duplicate URLs for the same Project/Scope are harmless; distinct
 * origins, Projects, Scopes, or legacy credentials fail closed as conflict.
 */
export function resolvePuppyoneRemotes(
  status: GitStatusSnapshot | null,
): PuppyoneRemoteResolution {
  return resolvePuppyoneRemoteSet(status, () => true);
}

/**
 * Resolve only canonical Project/Scope locators for Cloud UI context. Legacy
 * access-key remotes remain transport compatibility input and never identify
 * a Cloud Project for Desktop.
 */
export function resolveCanonicalPuppyoneRemotes(
  status: Pick<GitStatusSnapshot, "remotes"> | null,
): PuppyoneRemoteResolution {
  return resolvePuppyoneRemoteSet(status, (info) => info.kind !== "access-point");
}

function resolvePuppyoneRemoteSet(
  status: Pick<GitStatusSnapshot, "remotes"> | null,
  include: (info: PuppyoneRemoteInfo) => boolean,
): PuppyoneRemoteResolution {
  const candidates: PuppyoneRemoteCandidate[] = [];
  let directionConflict = false;
  for (const remote of status?.remotes ?? []) {
    const parsedFetchInfo = parsePuppyoneRemote(remote.fetchUrl);
    const parsedPushInfo = parsePuppyoneRemote(remote.pushUrl);
    const fetchInfo = parsedFetchInfo && include(parsedFetchInfo) ? parsedFetchInfo : null;
    const pushInfo = parsedPushInfo && include(parsedPushInfo) ? parsedPushInfo : null;
    if (Boolean(fetchInfo) !== Boolean(pushInfo)) {
      // A PuppyOne fetch paired with a different/invalid push target (or the
      // inverse) is an ambiguous transport and must never choose one side.
      directionConflict = true;
    }
    if (fetchInfo && remote.fetchUrl) {
      candidates.push({ remote, direction: "fetch", rawUrl: remote.fetchUrl, info: fetchInfo });
    }
    if (pushInfo && remote.pushUrl) {
      candidates.push({ remote, direction: "push", rawUrl: remote.pushUrl, info: pushInfo });
    }
  }

  if (candidates.length === 0) return { status: "none", candidates: [] };
  const identities = new Set(candidates.map(remoteIdentity));
  if (directionConflict || identities.size !== 1) {
    return { status: "conflict", candidates };
  }

  const preferred = candidates.find((candidate) => candidate.direction === "fetch")
    ?? candidates[0];
  return {
    status: "unique",
    candidates,
    remote: preferred.remote,
    rawUrl: preferred.rawUrl,
    info: preferred.info,
  };
}

/** Human-readable, secret-safe diagnostics for a conflicting remote set. */
export function describePuppyoneRemoteCandidates(
  candidates: readonly PuppyoneRemoteCandidate[],
): string {
  return candidates.map((candidate) => {
    const { info } = candidate;
    const target = info.kind === "project"
      ? info.projectId
      : info.kind === "scope"
        ? `${info.projectId}/${info.scopeId}`
        : info.displayId;
    return `${candidate.remote.name} ${candidate.direction}: ${info.origin} (${target})`;
  }).join("; ");
}

export function parsePuppyoneRemote(rawUrl: string | null): PuppyoneRemoteInfo | null {
  if (!rawUrl) return null;

  try {
    const url = new URL(rawUrl);
    const isCanonicalTransport = url.protocol === "http:" || url.protocol === "https:";
    const hasUrlCredential = Boolean(url.username || url.password || url.search || url.hash);
    if (!isCanonicalTransport || !url.host || hasUrlCredential) return null;
    const accessPointMatch = url.pathname.match(/^\/git\/ap\/([^/]+)\.git$/);
    const accessKey = accessPointMatch?.[1];
    if (accessPointMatch) {
      return {
        kind: "access-point",
        host: url.host,
        origin: url.origin.toLowerCase(),
        displayId: accessKey ? maskSecret(accessKey) : "access point",
        accessKey,
      };
    }

    const scopeMatch = url.pathname.match(CANONICAL_SCOPE_REMOTE);
    if (scopeMatch) {
      const projectId = scopeMatch[1];
      const scopeId = scopeMatch[2];
      return {
        kind: "scope",
        host: url.host,
        origin: url.origin.toLowerCase(),
        displayId: `${projectId}/${scopeId}`,
        projectId,
        scopeId,
      };
    }

    const projectMatch = url.pathname.match(CANONICAL_PROJECT_REMOTE);
    const projectId = projectMatch?.[1];
    if (projectMatch) {
      return {
        kind: "project",
        host: url.host,
        origin: url.origin.toLowerCase(),
        displayId: projectId ?? "project",
        projectId,
      };
    }
  } catch {
    return null;
  }

  return null;
}

function remoteIdentity(candidate: PuppyoneRemoteCandidate): string {
  const { info } = candidate;
  if (info.kind === "project") {
    return `${info.origin}\nproject\n${info.projectId ?? ""}`;
  }
  if (info.kind === "scope") {
    return `${info.origin}\nscope\n${info.projectId ?? ""}\n${info.scopeId ?? ""}`;
  }
  return `${info.origin}\naccess-point\n${info.accessKey ?? ""}`;
}

export function normalizeRemoteUrlForCompare(rawUrl: string | null) {
  if (!rawUrl) return "";
  const trimmed = rawUrl.trim();
  try {
    const url = new URL(trimmed);
    url.username = "";
    url.password = "";
    url.hash = "";
    url.search = "";
    url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString().replace(/\/+$/, "");
  } catch {
    return trimmed.replace(/\/+$/, "");
  }
}

export function maskRemoteUrl(rawUrl: string) {
  let masked = rawUrl.replace(/\/git\/ap\/([^/]+)\.git/g, (_match, accessKey: string) => {
    return `/git/ap/${maskSecret(accessKey)}.git`;
  });

  try {
    const url = new URL(masked);
    if (url.password) url.password = "••••";
    if (url.username) url.username = maskSecret(url.username);
    masked = url.toString();
  } catch {
    // Non-URL remotes, such as scp-like SSH remotes, are displayed as-is.
  }

  return masked;
}

export function maskSecret(value: string) {
  if (value.length <= 8) return "••••";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}
