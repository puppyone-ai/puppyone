import { NextResponse } from 'next/server';
import { getWorkspaceStore } from '@/lib/workspace';
import { extractAuthHeader } from '@/lib/auth/http';
import { normalizeError } from '@/lib/http/errors';

export async function PUT(
  request: Request,
  { params }: { params: { workspaceId: string } }
) {
  try {
    const { workspaceId } = params;
    const body = await request.json();
    const newName = body?.new_name;
    if (!workspaceId || !newName) {
      return NextResponse.json(
        { error: 'Workspace ID and new_name are required' },
        { status: 400 }
      );
    }
    const store = getWorkspaceStore();
    const authHeader = extractAuthHeader(request);
    const updated = await store.renameWorkspace(
      workspaceId,
      newName,
      authHeader ? { authHeader } : undefined
    );
    return NextResponse.json({
      msg: 'Workspace name updated',
      workspace_id: updated.workspace_id,
      workspace_name: updated.workspace_name,
    });
  } catch (error) {
    const { status, message, details } = normalizeError(
      error,
      'Failed to rename workspace'
    );
    return NextResponse.json(
      { error: 'Failed to rename workspace', message, details },
      { status }
    );
  }
}
