import { NextResponse } from 'next/server';
import { getWorkspaceStore } from '@/lib/workspace';
import { cookies } from 'next/headers';

// 删除工作区
export async function DELETE(
  request: Request,
  { params }: { params: { workspaceId: string } }
) {
  try {
    const url = new URL(request.url);
    const { workspaceId } = params;
    if (!workspaceId) {
      return NextResponse.json(
        { success: false, error: 'Workspace ID is required' },
        { status: 400 }
      );
    }
    const store = getWorkspaceStore();
    let authHeader = request.headers.get('authorization') || undefined;
    if (!authHeader) {
      try {
        const token = cookies().get('access_token')?.value;
        if (token) authHeader = `Bearer ${token}`;
      } catch {
        const rawCookie = request.headers.get('cookie') || '';
        const match = rawCookie.match(/(?:^|;\s*)access_token=([^;]+)/);
        if (match) authHeader = `Bearer ${decodeURIComponent(match[1])}`;
      }
    }
    await store.deleteWorkspace(workspaceId, { authHeader, origin: url.origin });
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
