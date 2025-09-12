import { SERVER_ENV } from '@/lib/serverEnv';
import { filterRequestHeadersAndInjectAuth } from '@/lib/auth/http';

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

function filterRequestHeaders(request: Request, headers: Headers): Record<string, string> {
  return filterRequestHeadersAndInjectAuth(request, headers, {
    includeServiceKey: true,
    localFallback: true,
  });
}

async function proxy(
  request: Request,
  path: string[] | undefined
): Promise<Response> {
  const target = buildTargetUrl(request, path);
  const method = request.method;
  const headers = filterRequestHeaders(request, request.headers);
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
