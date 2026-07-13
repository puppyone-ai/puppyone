/** Credential-free canonical Git locator helpers. */

export type CanonicalGitScope = {
  id: string;
  project_id: string;
  is_root: boolean;
};

const CANONICAL_GIT_ID = '[A-Za-z0-9][A-Za-z0-9_-]{0,199}';
const CANONICAL_GIT_PATH = new RegExp(
  `^/git/(?:${CANONICAL_GIT_ID}\\.git|${CANONICAL_GIT_ID}/scopes/${CANONICAL_GIT_ID}\\.git)$`,
);

function cleanBase(apiBase: string): string {
  return apiBase.trim().replace(/\/+$/, '');
}

export function canonicalProjectGitUrl(apiBase: string, projectId: string): string {
  return `${cleanBase(apiBase)}/git/${encodeURIComponent(projectId)}.git`;
}

export function canonicalScopeGitUrl(
  apiBase: string,
  projectId: string,
  scopeId: string,
): string {
  return `${cleanBase(apiBase)}/git/${encodeURIComponent(projectId)}/scopes/${encodeURIComponent(scopeId)}.git`;
}

export function canonicalGitUrlForScope(
  apiBase: string,
  scope: CanonicalGitScope,
): string {
  return scope.is_root
    ? canonicalProjectGitUrl(apiBase, scope.project_id)
    : canonicalScopeGitUrl(apiBase, scope.project_id, scope.id);
}

export function isCredentialFreeCanonicalGitUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return (url.protocol === 'https:' || url.protocol === 'http:')
      && !url.username
      && !url.password
      && !url.search
      && !url.hash
      && CANONICAL_GIT_PATH.test(url.pathname);
  } catch {
    return false;
  }
}

export function isSameCanonicalGitUrl(expectedUrl: string, actualUrl: string): boolean {
  if (
    !isCredentialFreeCanonicalGitUrl(expectedUrl)
    || !isCredentialFreeCanonicalGitUrl(actualUrl)
  ) {
    return false;
  }
  const expected = new URL(expectedUrl);
  const actual = new URL(actualUrl);
  return expected.origin === actual.origin && expected.pathname === actual.pathname;
}
