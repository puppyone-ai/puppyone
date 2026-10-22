/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCloudWorkspaceClient } from '../../../../src/features/cloud/files/cloudWorkspaceClient';
import { describeCloudOpeningFailure } from '../../../../src/features/cloud/cloudOpeningFailure';
import { cloudApiRequest, type DesktopCloudSession } from '../../../../src/lib/cloudApi';
import { liveWorkbench } from '../../../fixtures/cloud/repositories/liveWorkspace';
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
    api.mockResolvedValueOnce({ workspace: row }).mockResolvedValueOnce({ ...row, state: 'allocating',
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
