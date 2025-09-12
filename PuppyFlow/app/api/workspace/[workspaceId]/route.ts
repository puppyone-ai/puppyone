import { NextResponse } from 'next/server';
import { getWorkspaceStore } from '@/lib/workspace';
import { cookies } from 'next/headers';
import { SERVER_ENV } from '@/lib/serverEnv';

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
    let authHeader = request.headers.get('authorization') || undefined;
    if (!authHeader) {
      try {
        const token = cookies().get(SERVER_ENV.AUTH_COOKIE_NAME)?.value;
        if (token) authHeader = `Bearer ${token}`;
      } catch {
        const rawCookie = request.headers.get('cookie') || '';
        const name = SERVER_ENV.AUTH_COOKIE_NAME.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
        const match = rawCookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
        if (match) authHeader = `Bearer ${decodeURIComponent(match[1])}`;
      }
    }
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
