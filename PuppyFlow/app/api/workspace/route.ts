import { NextResponse } from 'next/server';
import { getWorkspaceStore } from '@/lib/workspace';
import { getCurrentUserId } from '@/lib/auth/serverUser';

// 保存工作区数据
export async function POST(request: Request) {
  try {
    const requestBody = await request.json();
    const { flowId, json, timestamp } = requestBody;

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
    await store.addHistory(flowId, { history: json, timestamp });
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
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
    const data = await store.getLatestHistory(flowId);
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
