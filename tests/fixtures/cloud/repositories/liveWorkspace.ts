import { createHash } from 'node:crypto';
export const liveWorkbench = (project = 'project') => ({ id: `workbench-${project}`, project_id: project,
  generation: '11111111-1111-4111-8111-111111111111', state: 'running', target_ref: 'refs/heads/workspace' });
export const fileRevision = (content: string | Uint8Array) => createHash('sha256').update(content).digest('hex');
export const fileVersion = (content: string, project = 'project') => `cloud-workspace:${JSON.stringify({
  workspace: liveWorkbench(project).id, generation: liveWorkbench(project).generation, revision: fileRevision(content) })}`;
export const liveFile = (path: string, content: string | Uint8Array) => ({ name: path.split('/').at(-1), kind: 'file',
  size: Buffer.byteLength(content), modified_ns: '1', content_base64: Buffer.from(content).toString('base64'), revision: fileRevision(content) });
export const liveEntry = (name: string, content = '') => ({ name, kind: 'file', size: Buffer.byteLength(content), modified_ns: '1' });

/** UI navigation fixtures share the production live-file wire shape. */
export function workspaceFixtureBridge(handler: (input: any) => unknown) {
  return async (input: any) => {
    const url = new URL(input.path, 'https://fixture.test');
    const project = url.pathname.split('/')[2];
    if (url.pathname.endsWith('/workbench')) return { workspace: liveWorkbench(project) };
    const value: any = await handler(input);
    if (url.pathname.endsWith('/files') && input.method === 'GET') return { entries: (value.entries ?? []).map((entry: any) =>
      entry.kind ? entry : { name: entry.name, kind: entry.type === 'folder' ? 'directory' : 'file', size: 0, modified_ns: '1' }) };
    if (url.pathname.endsWith('/file')) {
      const path = url.searchParams.get('path')!;
      if (input.method === 'PUT') return { revision: fileRevision(Buffer.from(JSON.parse(input.body).content_base64, 'base64')) };
      return value.content_base64 ? value : liveFile(path, value.content_text ?? 'Cloud content');
    }
    return value;
  };
}
export function fixtureWorkspaceWatch() {
  return { watchCloudWorkspace: async (input: {id: string}) => ({ id: input.id }), stopCloudWorkspaceWatch: async () => {},
    onCloudWorkspaceEvent: () => () => {} };
}
