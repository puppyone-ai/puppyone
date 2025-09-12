import { NextResponse } from 'next/server';
import { getWorkspaceStore } from '@/lib/workspace';
import { getCurrentUserId } from '@/lib/auth/serverUser';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const userId = await getCurrentUserId(request);
    const store = getWorkspaceStore();
    let authHeader = request.headers.get('authorization') || undefined;
    if (!authHeader) {
      try {
        const token = cookies().get(SERVER_ENV.AUTH_COOKIE_NAME)?.value;
        if (token) authHeader = `Bearer ${token}`;
      } catch {
        const rawCookie = request.headers.get('cookie') || '';
        const name = SERVER_ENV.AUTH_COOKIE_NAME.replace(
          /[-[\]{}()*+?.,\\^$|#\s]/g,
          '\\$&'
        );
        const match = rawCookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
        if (match) authHeader = `Bearer ${decodeURIComponent(match[1])}`;
      }
    }
    const workspaces = await store.listWorkspaces(
      userId,
      authHeader ? { authHeader } : undefined
    );
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
