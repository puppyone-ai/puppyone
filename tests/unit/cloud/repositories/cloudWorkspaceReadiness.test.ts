/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCloudWorkspaceClient } from '../../../../src/features/cloud/files/cloudWorkspaceClient';
import { describeCloudOpeningFailure } from '../../../../src/features/cloud/cloudOpeningFailure';
import { cloudApiRequest, type DesktopCloudSession } from '../../../../src/lib/cloudApi';
import { liveEntry, liveWorkbench } from '../../../fixtures/cloud/repositories/liveWorkspace';
vi.mock('../../../../src/lib/cloudApi', () => ({ cloudApiRequest: vi.fn() }));
const api = vi.mocked(cloudApiRequest);
const context = { status: 'resolved' as const, projectId: 'project', projectName: 'Project',
  target: { kind: 'project_root' as const, project_id: 'project' }, capabilities: ['content.read'] };
function client(assertCurrent?: () => void) {
  return createCloudWorkspaceClient({ user_id: 'owner', session_generation: crypto.randomUUID() } as DesktopCloudSession,
    context, 'https://fixture.invalid/api/v1', assertCurrent);
}
afterEach(() => { vi.useRealTimers(); api.mockReset(); });

describe('workspace readiness', () => {
  it('uses the root verified by the consuming connection for concurrent initial lists', async () => {
    vi.useFakeTimers();
    const row = liveWorkbench();
    const operation = { pending: true, phase: 'connecting', deadline: new Date(Date.now() + 60_000).toISOString(), error: null, retryable: false };
    api.mockResolvedValueOnce({ workspace: { ...row, state: 'paused' } })
      .mockResolvedValueOnce({ ...row, state: 'resuming', operation })
      .mockResolvedValueOnce({ workspace: { ...row, operation: { ...operation, pending: false, phase: 'ready' } }, entries: [liveEntry('hello.md')] });
    const source = client();
    const lists = Promise.all([source.list(''), source.list('')]);
    await vi.advanceTimersByTimeAsync(1_100);
    const [first, second] = await lists;
    expect(first).toBe(second);
    expect(first.entries[0].path).toBe('hello.md');
    expect(api).toHaveBeenCalledTimes(3);
    expect(api.mock.calls.some(call => call[0].includes('/files'))).toBe(false);
  });

  it('accepts an already completed status/root and consumes that root only once', async () => {
    api.mockResolvedValueOnce({ workspace: liveWorkbench(), entries: [liveEntry('hello.md')] })
      .mockResolvedValueOnce({ entries: [] });
    const source = client();
    expect((await source.list('')).entries).toHaveLength(1);
    expect(api).toHaveBeenCalledTimes(1);
    expect(await source.list('')).toEqual({ entries: [] });
    expect(api).toHaveBeenCalledTimes(2);
  });

  it('rejects a new generation returned while waiting for the old opening', async () => {
    vi.useFakeTimers();
    const row = liveWorkbench();
    const operation = { pending: true, phase: 'connecting', deadline: new Date(Date.now() + 60_000).toISOString(), error: null, retryable: false };
    api.mockResolvedValueOnce({ workspace: { ...row, state: 'paused' } })
      .mockResolvedValueOnce({ ...row, state: 'resuming', operation })
      .mockResolvedValueOnce({ workspace: { ...row, generation: 'replacement' }, entries: [liveEntry('private.md')] });
    const rejected = expect(client().list('')).rejects.toThrow('replaced');
    await vi.advanceTimersByTimeAsync(1_100);
    await rejected;
  });
  it('waits through pause and initialization without repeating the wake request', async () => {
    vi.useFakeTimers();
    const row = liveWorkbench();
    const operation = { pending: true, phase: 'pausing', deadline: new Date(Date.now() + 60_000).toISOString(), error: null, retryable: false };
    api.mockResolvedValueOnce({ workspace: { ...row, state: 'pausing' } })
      .mockResolvedValueOnce({ ...row, state: 'pausing', operation })
      .mockResolvedValueOnce({ workspace: { ...row, state: 'allocating', operation: { ...operation, phase: 'initializing' } } })
      .mockResolvedValueOnce({ workspace: { ...row, state: 'running', operation: { ...operation, pending: false, phase: 'ready' } } });
    const opened = client().ensure();
    await vi.advanceTimersByTimeAsync(2_100);
    expect(await opened).toMatchObject({ id: row.id, state: 'running' });
    expect(api.mock.calls.filter(call => call[3]?.method === 'POST')).toHaveLength(1);
  });
  it('does not allocate after navigation cancelled a slow status response', async () => {
    let active = true;
    api.mockImplementationOnce(async () => { active = false; return { workspace: null }; });
    await expect(client(() => { if (!active) throw new Error('cancelled'); }).ensure()).rejects.toThrow('cancelled');
    expect(api).toHaveBeenCalledTimes(1);
  });
  it('reports the persisted failure instead of polling forever', async () => {
    const row = liveWorkbench();
    api.mockResolvedValueOnce({ workspace: { ...row, state: 'paused' } }).mockResolvedValueOnce({ ...row, state: 'allocating',
      operation: { pending: false, phase: 'failed', error: 'workbench_provider_authentication', retryable: false } });
    await expect(client().ensure()).rejects.toMatchObject({ code: 'workbench_provider_authentication', retryable: false });
    expect(describeCloudOpeningFailure({ code: 'workbench_provider_authentication' }, 'workspace').action).toBe('none');
    expect(describeCloudOpeningFailure({ code: 'workbench_protocol_mismatch' }, 'workspace').action).toBe('none');
  });
  it('stops at the server deadline even if a worker is unavailable', async () => {
    vi.useFakeTimers();
    const row = { ...liveWorkbench(), state: 'allocating', operation: { pending: true,
      deadline: new Date(Date.now() + 1000).toISOString(), phase: 'queued', error: null, retryable: false } };
    api.mockResolvedValueOnce({ workspace: row }).mockResolvedValueOnce(row).mockResolvedValue({ workspace: row });
    const opening = expect(client().ensure()).rejects.toMatchObject({ code: 'workbench_start_timeout' });
    await vi.advanceTimersByTimeAsync(1_100);
    await opening;
    expect(api).toHaveBeenCalledTimes(3);
  });
});
