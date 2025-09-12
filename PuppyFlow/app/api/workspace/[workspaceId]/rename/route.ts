import { NextResponse } from 'next/server';
import { getWorkspaceStore } from '@/lib/workspace';
import { cookies } from 'next/headers';

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
    return NextResponse.json(
      { error: 'Failed to rename workspace' },
      { status: 500 }
    );
  }
}
