import { NextResponse } from 'next/server';
import { getWorkspaceStore } from '@/lib/workspace';
import { getCurrentUserId } from '@/lib/auth/serverUser';

export async function POST(request: Request) {
  try {
    const userId = await getCurrentUserId(request);
    const body = await request.json();
    const { workspace_id, workspace_name } = body || {};
    if (!workspace_id || !workspace_name) {
      return NextResponse.json(
        { error: 'workspace_id and workspace_name are required' },
        { status: 400 }
      );
    }
    const store = getWorkspaceStore();
    const created = await store.createWorkspace(userId, {
      workspace_id,
      workspace_name,
    });
    return NextResponse.json(created, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to create workspace' },
      { status: 500 }
    );
  }
}
