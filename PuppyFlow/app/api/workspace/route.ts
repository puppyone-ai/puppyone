import { NextResponse } from 'next/server';
import { getWorkspaceStore } from '@/lib/workspace';
import { extractAuthHeader } from '@/lib/auth/http';
import { getCurrentUserId } from '@/lib/auth/serverUser';

export const runtime = 'nodejs';

function getAuthHeaderFromRequest(request: Request): string | undefined {
  return extractAuthHeader(request);
}

// 保存工作区数据
export async function POST(request: Request) {
  try {
    const requestBody = await request.json();
    const { flowId, json, timestamp, workspaceName } = requestBody;

    // 验证必要字段
    if (!flowId || !json || !timestamp) {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing required fields',
        },
        { status: 400 }
      );
    }
    const store = getWorkspaceStore();
    const authHeader = getAuthHeaderFromRequest(request);

    try {
      // 第一次尝试保存
      await store.addHistory(
        flowId,
        { history: json, timestamp },
        { authHeader }
      );
    } catch (e: any) {
      // 若后端返回404（工作区不存在），先尝试创建再重试一次保存
      const message = (e?.message || '').toString();
      const isNotFound =
        message.includes('404') || /not\s*exist/i.test(message);
      if (!isNotFound) {
        throw e;
      }

      // 兜底创建并重试一次保存
      const userId = await getCurrentUserId(request);
      const name =
        (json?.workspaceName as string) ||
        workspaceName ||
        'Untitled Workspace';
      await store.createWorkspace(
        userId,
        {
          workspace_id: flowId,
          workspace_name: name,
        },
        { authHeader }
      );
      await store.addHistory(
        flowId,
        { history: json, timestamp },
        { authHeader }
      );
    }
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error('[API:/api/workspace] Failed to save:', {
      message: (error as any)?.message,
      stack: (error as any)?.stack,
    });
    return NextResponse.json(
      {
        success: false,
        error: `Failed to save workspace`,
      },
      { status: 500 }
    );
  }
}

// 获取工作区最新数据
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const flowId = searchParams.get('flowId');
    const timestamp = searchParams.get('timestamp');

    if (!flowId) {
      return NextResponse.json(
        { error: 'Flow ID is required' },
        { status: 400 }
      );
    }
    const store = getWorkspaceStore();
    const authHeader = getAuthHeaderFromRequest(request);
    const data = await store.getLatestHistory(flowId, { authHeader });
    return NextResponse.json({ data });
  } catch (error) {
    return NextResponse.json(
      {
        error: `Failed to read workspace`,
      },
      { status: 500 }
    );
  }
}
