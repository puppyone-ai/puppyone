import { NextResponse } from 'next/server';
import { getWorkspaceStore } from '@/lib/workspace';
import { getCurrentUserId } from '@/lib/auth/serverUser';
import { cookies } from 'next/headers';

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
    const created = await store.createWorkspace(
      userId,
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
