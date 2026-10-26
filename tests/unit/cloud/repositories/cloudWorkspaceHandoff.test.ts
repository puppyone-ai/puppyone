/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCloudWorkspaceClient } from '../../../../src/features/cloud/files/cloudWorkspaceClient';
import { cloudApiRequest, type DesktopCloudSession } from '../../../../src/lib/cloudApi';
import { liveEntry, liveWorkbench } from '../../../fixtures/cloud/repositories/liveWorkspace';

vi.mock('../../../../src/lib/cloudApi', () => ({ cloudApiRequest: vi.fn() }));
const api = vi.mocked(cloudApiRequest);
const url = 'https://fixture.invalid/api/v1';
const context = { status: 'resolved' as const, projectId: 'project', projectName: 'Project',
  target: { kind: 'project_root' as const, project_id: 'project' }, capabilities: ['content.read'] };
const session = () => ({ user_id: 'owner', session_generation: crypto.randomUUID() } as DesktopCloudSession);
async function prepare() {
  const account = session();
  api.mockResolvedValueOnce({ workspace: liveWorkbench() })
    .mockResolvedValueOnce({ entries: [liveEntry('hello.md')] });
  const source = createCloudWorkspaceClient(account, context, url);
  const root = await source.list('');
  return { account, source, root, handoff: source.handoff()! };
}
afterEach(() => { vi.useRealTimers(); api.mockReset(); });

describe('prepared workspace handoff', () => {
  it('opens a running workspace and displays its root with one status and one list request', async () => {
    const { account, root, handoff } = await prepare();
    const display = createCloudWorkspaceClient(account, context, url, undefined, handoff);
    // The watch starts by ensuring the workspace before the tree lists it.
    await display.ensure();
    expect(await display.list('')).toBe(root);
    expect(api).toHaveBeenCalledTimes(2);
    expect(api.mock.calls.every(call => !call[3]?.method)).toBe(true);
  });

  it('consumes the result once, then later openings revalidate through the API', async () => {
    const { account, handoff } = await prepare();
    await createCloudWorkspaceClient(account, context, url, undefined, handoff).list('');
    api.mockResolvedValueOnce({ workspace: liveWorkbench() }).mockResolvedValueOnce({ entries: [] });
    expect(await createCloudWorkspaceClient(account, context, url, undefined, handoff).list('')).toEqual({ entries: [] });
    expect(api).toHaveBeenCalledTimes(4);
  });

  it.each(['expired', 'invalidated', 'request_failed'] as const)('rejects a %s handoff', async reason => {
    vi.useFakeTimers();
    const { account, source, handoff } = await prepare();
    if (reason === 'expired') vi.advanceTimersByTime(5_001);
    if (reason === 'invalidated') source.invalidate();
    if (reason === 'request_failed') {
      api.mockRejectedValueOnce(Object.assign(new Error('revoked'), { status: 403 }));
      await expect(source.list('another')).rejects.toThrow('revoked');
    }
    api.mockResolvedValueOnce({ workspace: liveWorkbench() }).mockResolvedValueOnce({ entries: [] });
    expect(await createCloudWorkspaceClient(account, context, url, undefined, handoff).list('')).toEqual({ entries: [] });
  });

  it.each(['account', 'session', 'api', 'project', 'capabilities'] as const)('does not reuse across a changed %s', async changed => {
    const { account, handoff } = await prepare();
    const nextSession = { ...account, ...(changed === 'account' ? { user_id: 'other' } : {}),
      ...(changed === 'session' ? { session_generation: 'next' } : {}) };
    const project = changed === 'project' ? 'other' : 'project';
    const nextContext = { ...context, projectId: project, target: { ...context.target, project_id: project },
      capabilities: changed === 'capabilities' ? [] : context.capabilities };
    api.mockResolvedValueOnce({ workspace: liveWorkbench(project) }).mockResolvedValueOnce({ entries: [] });
    expect(await createCloudWorkspaceClient(nextSession, nextContext,
      changed === 'api' ? 'https://other.invalid' : url, undefined, handoff).list('')).toEqual({ entries: [] });
    expect(api).toHaveBeenCalledTimes(4);
  });

  it('does not reveal a prepared directory after UI authority is revoked', async () => {
    const { account, handoff } = await prepare();
    const display = createCloudWorkspaceClient(account, context, url, () => { throw new Error('cancelled'); }, handoff);
    await expect(display.list('')).rejects.toThrow('cancelled');
    expect(api).toHaveBeenCalledTimes(2);
  });

  it('treats running as a hint and still surfaces actual file authorization failure', async () => {
    api.mockResolvedValueOnce({ workspace: liveWorkbench() })
      .mockRejectedValueOnce(Object.assign(new Error('revoked'), { status: 403 }));
    const source = createCloudWorkspaceClient(session(), context, url);
    await expect(source.list('')).rejects.toMatchObject({ status: 403 });
    expect(source.handoff()).toBeUndefined();
    expect(api).toHaveBeenCalledTimes(2);
  });
});
