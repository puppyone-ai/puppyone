import { NextResponse } from 'next/server';
import { getWorkspaceStore } from '@/lib/workspace';
import { getCurrentUserId } from '@/lib/auth/serverUser';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const userId = await getCurrentUserId(request);
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
    const workspaces = await store.listWorkspaces(userId, {
      authHeader,
      origin: url.origin,
    });
    return NextResponse.json({ workspaces });
  } catch (error) {
    // Log the underlying error for server-side diagnostics
    console.error('[API:/api/workspace/list] Failed:', {
      message: (error as any)?.message,
      stack: (error as any)?.stack,
    });
    return NextResponse.json(
      { error: 'Failed to list workspaces' },
      { status: 500 }
    );
  }
}
