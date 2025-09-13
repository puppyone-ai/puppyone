import { NextResponse } from 'next/server';
import { getWorkspaceStore } from '@/lib/workspace';
import { getCurrentUserId } from '@/lib/auth/serverUser';
import { extractAuthHeader } from '@/lib/auth/http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const userId = await getCurrentUserId(request);
    const store = getWorkspaceStore();
    const authHeader = extractAuthHeader(request);
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
