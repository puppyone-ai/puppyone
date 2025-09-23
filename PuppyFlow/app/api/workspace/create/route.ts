import { NextResponse } from 'next/server';
import { getWorkspaceStore } from '@/lib/workspace';
import { extractAuthHeader } from '@/lib/auth/http';
import { normalizeError } from '@/lib/http/errors';

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
    const { status, message, details } = normalizeError(
      error,
      'Failed to create workspace'
    );
    return NextResponse.json(
      { error: 'Failed to create workspace', message, details },
      { status }
    );
  }
}
