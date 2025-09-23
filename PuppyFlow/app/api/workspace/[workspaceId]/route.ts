import { NextResponse } from 'next/server';
import { getWorkspaceStore } from '@/lib/workspace';
import { extractAuthHeader } from '@/lib/auth/http';
import { normalizeError } from '@/lib/http/errors';

// 删除工作区
export async function DELETE(
  request: Request,
  { params }: { params: { workspaceId: string } }
) {
  try {
    const { workspaceId } = params;
    if (!workspaceId) {
      return NextResponse.json(
        { success: false, error: 'Workspace ID is required' },
        { status: 400 }
      );
    }
    const store = getWorkspaceStore();
    const authHeader = extractAuthHeader(request);
    await store.deleteWorkspace(
      workspaceId,
      authHeader ? { authHeader } : undefined
    );
    return NextResponse.json({
      success: true,
      message: 'Workspace deleted successfully',
    });
  } catch (error) {
    const { status, message, details } = normalizeError(
      error,
      'Failed to delete workspace'
    );
    return NextResponse.json(
      { success: false, error: 'Failed to delete workspace', message, details },
      { status }
    );
  }
}
