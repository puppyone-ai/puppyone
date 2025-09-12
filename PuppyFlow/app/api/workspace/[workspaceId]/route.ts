import { NextResponse } from 'next/server';
import { getWorkspaceStore } from '@/lib/workspace';
import { NextResponse } from 'next/server';
import { getWorkspaceStore } from '@/lib/workspace';
import { extractAuthHeader } from '@/lib/auth/http';

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
    return NextResponse.json(
      { success: false, error: 'Failed to delete workspace' },
      { status: 500 }
    );
  }
}
