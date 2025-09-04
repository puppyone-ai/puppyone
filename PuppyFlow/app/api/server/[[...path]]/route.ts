import { SERVER_ENV } from '@/lib/serverEnv';
import { cookies } from 'next/headers';

/**
 * Server API Proxy - 处理对PuppyAgent Server的所有API调用
 *
 * 主要功能：
 * 1. 代理客户端对server服务的所有请求
 * 2. 从HttpOnly cookie中自动注入用户认证token
 * 3. 过滤敏感headers，防止客户端直接传递认证信息
 * 4. 提供统一的错误处理和日志记录
 */

function buildTargetUrl(request: Request, path: string[] | undefined): string {
  const subPath = Array.isArray(path) ? path.join('/') : '';
  const url = new URL(request.url);
  const query = url.search; // includes leading ? when present

  // 使用环境变量中的server backend URL
  const base = SERVER_ENV.API_SERVER_BACKEND;

  const suffix = subPath ? `/${subPath}` : '';
  return `${base}${suffix}${query}`;
}

function filterRequestHeaders(headers: Headers): Record<string, string> {
  const newHeaders: Record<string, string> = {};

  headers.forEach((value, key) => {
    const lower = key.toLowerCase();

    // 过滤掉不应该转发的headers
    if (
      [
        'host',
        'connection',
        'keep-alive',
        'transfer-encoding',
        'te',
        'encoding',
        'upgrade',
        'content-length',
        'cookie', // 重要：过滤cookie以防止客户端直接传递
        'authorization', // 重要：过滤客户端的authorization，我们会在服务端重新注入
      ].includes(lower)
    ) {
      return;
    }

    newHeaders[key] = value;
  });

  // 从HttpOnly cookie中获取用户token并注入Authorization header
  let authHeader: string | undefined;
  try {
    const token = cookies().get('access_token')?.value;
    if (token) {
      authHeader = `Bearer ${token}`;
    }
  } catch (error) {
    // Cookie读取失败，可能是在某些边缘情况下
    console.warn('Failed to read access_token cookie:', error);
  }

  // 注入用户认证token
  if (authHeader) {
    newHeaders['authorization'] = authHeader;
  }

  // 在非云模式下提供本地开发的fallback认证
  const mode = (process.env.DEPLOYMENT_MODE || '').toLowerCase();
  if (!newHeaders['authorization'] && mode !== 'cloud') {
    // 仅在服务端提供本地开发fallback
    newHeaders['authorization'] = 'Bearer local-dev';
    console.warn('Using local-dev fallback auth for server API proxy');
  }

  // 如果配置了service key，添加服务间认证
  if (SERVER_ENV.SERVICE_KEY) {
    newHeaders['x-service-key'] = SERVER_ENV.SERVICE_KEY;
  }

  return newHeaders;
}

async function proxy(
  request: Request,
  path: string[] | undefined
): Promise<Response> {
  const target = buildTargetUrl(request, path);
  const method = request.method;
  const headers = filterRequestHeaders(request.headers);
  const hasBody = !['GET', 'HEAD'].includes(method.toUpperCase());

  try {
    console.log(`[Server API Proxy] ${method} ${target}`);

    const upstreamResponse = await fetch(target, {
      method,
      headers,
      body: hasBody ? (request as any).body : undefined,
      ...(hasBody ? { duplex: 'half' as any } : {}),
      redirect: 'manual',
    });

    // 转发响应headers（仅转发必要的）
    const resHeaders = new Headers();
    const contentType = upstreamResponse.headers.get('content-type');
    if (contentType) resHeaders.set('content-type', contentType);

    const cacheControl = upstreamResponse.headers.get('cache-control');
    if (cacheControl) resHeaders.set('cache-control', cacheControl);

    // 处理CORS headers（如果需要）
    const corsHeaders = [
      'access-control-allow-origin',
      'access-control-allow-methods',
      'access-control-allow-headers',
    ];
    corsHeaders.forEach(headerName => {
      const headerValue = upstreamResponse.headers.get(headerName);
      if (headerValue) {
        resHeaders.set(headerName, headerValue);
      }
    });

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers: resHeaders,
    });
  } catch (error) {
    console.error(
      `[Server API Proxy] Error proxying ${method} ${target}:`,
      error
    );

    return new Response(
      JSON.stringify({
        error: 'SERVER_PROXY_ERROR',
        message: error instanceof Error ? error.message : 'Server proxy failed',
        target: target, // 在开发环境中提供调试信息
      }),
      {
        status: 500,
        headers: { 'content-type': 'application/json' },
      }
    );
  }
}

// HTTP方法handlers
export async function GET(
  request: Request,
  ctx: { params: { path?: string[] } }
) {
  return await proxy(request, ctx.params.path);
}

export async function POST(
  request: Request,
  ctx: { params: { path?: string[] } }
) {
  return await proxy(request, ctx.params.path);
}

export async function PUT(
  request: Request,
  ctx: { params: { path?: string[] } }
) {
  return await proxy(request, ctx.params.path);
}

export async function PATCH(
  request: Request,
  ctx: { params: { path?: string[] } }
) {
  return await proxy(request, ctx.params.path);
}

export async function DELETE(
  request: Request,
  ctx: { params: { path?: string[] } }
) {
  return await proxy(request, ctx.params.path);
}

export async function OPTIONS(
  request: Request,
  ctx: { params: { path?: string[] } }
) {
  return await proxy(request, ctx.params.path);
}
