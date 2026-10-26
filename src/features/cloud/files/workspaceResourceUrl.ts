/** Human-facing locators. A URL conveys no membership or access credential. */
const PROJECT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isWorkspaceId(value: string): boolean {
  return PROJECT_ID.test(value);
}

export function isWorkspaceResourcePath(pathname: string): boolean {
  return isWorkspaceId(pathname.split('/')[1] ?? '');
}

export function workspaceResourcePath(projectId: string, path = '', directory = false): string {
  if (!isWorkspaceId(projectId)) throw new Error('Invalid workspace ID');
  const segments = path ? path.split('/') : [];
  if (segments.some(segment => !segment || segment === '.' || segment === '..' || /[\u0000-\u001f\u007f\\]/.test(segment))) {
    throw new Error('Invalid workspace path');
  }
  const encoded = segments.map(segment => encodeURIComponent(segment)).join('/');
  return `/${projectId.toLowerCase()}/${encoded}${directory && encoded ? '/' : ''}`;
}

export function workspaceResourceUrl(origin: string, projectId: string, path = '', directory = false): string {
  const base = new URL(origin);
  if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password) {
    throw new Error('Invalid workspace website origin');
  }
  return `${base.origin}${workspaceResourcePath(projectId, path, directory)}`;
}

