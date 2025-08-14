import { NextResponse } from 'next/server';
import { getWorkspaceStore } from '@/lib/workspace';
import { getCurrentUserId } from '@/lib/auth/serverUser';

export async function GET(request: Request) {
  try {
    const userId = await getCurrentUserId(request);
    const store = getWorkspaceStore();
    const workspaces = await store.listWorkspaces(userId);
    return NextResponse.json({ workspaces });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to list workspaces' },
      { status: 500 }
    );
  }
}
