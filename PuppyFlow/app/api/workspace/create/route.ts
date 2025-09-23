import { NextResponse } from 'next/server';
import { getWorkspaceStore } from '@/lib/workspace';
import { extractAuthHeader } from '@/lib/auth/http';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { workspace_id, workspace_name } = body || {};
    if (!workspace_id || !workspace_name) {
      return NextResponse.json(
        { error: 'workspace_id and workspace_name are required' },
        { status: 400 }
      );
    }
    const store = getWorkspaceStore();
    const authHeader = extractAuthHeader(request);
    const created = await store.createWorkspace(
      {
        workspace_id,
        workspace_name,
      },
      { authHeader }
    );
    return NextResponse.json(created, { status: 200 });
  } catch (error) {
    console.error('[API:/api/workspace/create] Failed:', {
      message: (error as any)?.message,
      stack: (error as any)?.stack,
    });
    return NextResponse.json(
      { error: 'Failed to create workspace' },
      { status: 500 }
    );
  }
}
