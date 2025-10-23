import { NextResponse } from 'next/server';
import { SERVER_ENV } from '@/lib/serverEnv';
import { filterRequestHeadersAndInjectAuth } from '@/lib/auth/http';

/**
 * Storage Copy Proxy - 代理资源复制请求到 PuppyStorage
 *
 * 自动从 HttpOnly cookie 注入用户认证 token
 */

interface CopyRequest {
  sourceKey: string;
  targetKey: string;
}

interface CopyResponse {
  success: boolean;
  target_key: string;
  message: string;
}

export async function POST(request: Request) {
  try {
    const body: CopyRequest = await request.json();

    // 构建 PuppyStorage API URL
    const storageUrl = `${SERVER_ENV.STORAGE_SERVER_BACKEND}/files/copy_resource`;

    // 过滤请求头并注入认证信息
    const headers = filterRequestHeadersAndInjectAuth(
      request,
      request.headers,
      {
        includeServiceKey: true,
        localFallback: true,
      }
    );

    console.log('[Storage Copy Proxy] Copying resource:', {
      source: body.sourceKey,
      target: body.targetKey,
    });

    // 转换字段名（前端camelCase → 后端snake_case）
    const storageRequest = {
      source_key: body.sourceKey,
      target_key: body.targetKey,
    };

    // 代理请求到 PuppyStorage
    const response = await fetch(storageUrl, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(storageRequest),
    });

    const data: CopyResponse = await response.json();

    if (!response.ok) {
      console.error('[Storage Copy Proxy] Copy failed:', data);
      return NextResponse.json(data, { status: response.status });
    }

    console.log('[Storage Copy Proxy] Copy succeeded:', data.target_key);

    // 转换响应字段名回 camelCase
    return NextResponse.json({
      success: data.success,
      targetKey: data.target_key,
      message: data.message,
    });
  } catch (error) {
    console.error('[Storage Copy Proxy] Error:', error);

    return NextResponse.json(
      {
        success: false,
        error: 'STORAGE_COPY_ERROR',
        message: error instanceof Error ? error.message : 'Copy failed',
      },
      { status: 500 }
    );
  }
}
