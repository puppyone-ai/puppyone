import { createHash } from 'node:crypto';
import { normalizeRelativePath } from '../../local-api/files/path-policy.mjs';

export function workspaceFileEndpoint(input, operation = 'file', path = input.path) {
  const generation = input.workbench?.generation;
  if (!/^[a-zA-Z0-9-]{1,100}$/.test(input.workbench?.id ?? '') || !/^[a-zA-Z0-9-]{1,100}$/.test(generation ?? '')) throw new Error('Invalid Cloud workspace identity.');
  const query = new URLSearchParams({ generation, path: path ? normalizeRelativePath(path) : '' });
  return `/projects/${encodeURIComponent(input.projectId)}/workbench/${operation}?${query}`;
}

/** Bounded native decoder input; never fetch a published Git version. */
export async function readWorkspaceFile(auth, input, signal) {
  const file = await auth.requestSessionApi(input.apiBaseUrl, workspaceFileEndpoint(input), { method: 'GET', signal }, input.expectedSession);
  if (typeof file?.content_base64 !== 'string' || file.content_base64.length > 11184812
    || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.content_base64)) throw new Error('Invalid workspace file response.');
  const bytes = Buffer.from(file.content_base64, 'base64');
  if (bytes.length > 8 * 1024 * 1024 || file.size !== bytes.length || file.name !== input.path.split('/').at(-1)
    || createHash('sha256').update(bytes).digest('hex') !== file.revision) throw new Error('Invalid workspace file revision.');
  return { bytes, revision: file.revision };
}
