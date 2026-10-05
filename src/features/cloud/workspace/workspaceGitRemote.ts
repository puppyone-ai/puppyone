import type { GitStatusSnapshot } from "../../../types/electron";

export function cloudOriginFromApiBase(apiBaseUrl: string): string {
  const parsed = new URL(apiBaseUrl);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Cloud API must use HTTP(S).");
  }
  return parsed.origin.toLowerCase();
}

export function sameCloudOrigin(
  left: string | null | undefined,
  rightApiBase: string | null | undefined,
): boolean {
  if (!left || !rightApiBase) return false;
  try {
    return cloudOriginFromApiBase(left) === cloudOriginFromApiBase(rightApiBase);
  } catch {
    return false;
  }
}

export function isTrustedCloudGitOrigin(
  remoteOrOrigin: string | null | undefined,
  apiBaseUrl: string | null | undefined,
): boolean {
  if (sameCloudOrigin(remoteOrOrigin, apiBaseUrl)) return true;
  if (!remoteOrOrigin || !isLoopbackOrigin(apiBaseUrl)) return false;
  const configuredGitOrigin = (
    import.meta as ImportMeta & { env?: Record<string, string | undefined> }
  ).env?.VITE_DESKTOP_CLOUD_GIT_ORIGIN?.trim();
  return Boolean(configuredGitOrigin && sameCloudOrigin(remoteOrOrigin, configuredGitOrigin));
}

function isLoopbackOrigin(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    return ["localhost", "127.0.0.1", "::1"].includes(new URL(value).hostname);
  } catch {
    return false;
  }
}

/** Legacy official HTTP locators are identity hints only. Resolve them through
 * the configured HTTPS API; this must never authorize HTTP Git credentials. */
export function isTrustedCloudProjectLocator(remote: string, apiBaseUrl: string | null): boolean {
  if (isTrustedCloudGitOrigin(remote, apiBaseUrl)) return true;
  if (!apiBaseUrl) return false;
  try {
    const locator = new URL(remote);
    const api = new URL(apiBaseUrl);
    return locator.protocol === "http:" && api.protocol === "https:"
      && locator.hostname === "api.puppyone.ai" && api.hostname === locator.hostname
      && !locator.port && !api.port && !locator.username && !locator.password
      && !locator.search && !locator.hash;
  } catch {
    return false;
  }
}

/**
 * Initialization is allowed to create the canonical remote, never to repoint an
 * existing one. Callers must use a freshly-read snapshot for this preflight.
 */
export function assertCloudRemoteNameAvailable(
  status: GitStatusSnapshot,
  remoteName = "puppyone",
): void {
  const normalizedRemoteName = remoteName.toLowerCase();
  if (status.remotes.some((remote) => remote.name.toLowerCase() === normalizedRemoteName)) {
    throw new Error(
      `A Git remote named "${remoteName}" already exists. Remove or rename it before initializing this project on PuppyOne Cloud.`,
    );
  }
}

/**
 * Protect the asynchronous Initialize flow from publishing a different local
 * history than the one the user reviewed when the operation started.
 */
export function assertExpectedGitRepositoryState(
  status: GitStatusSnapshot,
  expected: {
    headCommitId?: string;
    branch?: string;
  },
): void {
  const actualBranch = status.branch;
  const normalizedBranch = actualBranch?.toLowerCase();
  if (
    !status.isRepo
    || !status.headCommitId
    || !actualBranch
    || normalizedBranch === "head"
    || normalizedBranch === "detached"
    || (expected.headCommitId !== undefined && status.headCommitId !== expected.headCommitId)
    || (expected.branch !== undefined && actualBranch !== expected.branch)
  ) {
    throw new Error(
      "The local Git branch or HEAD changed while PuppyOne Cloud initialization was starting. Review the current branch and try again.",
    );
  }
}
