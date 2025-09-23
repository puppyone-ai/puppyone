// Generic proxy to forward requests from PuppyFlow server to the private User System backend
// Matches /api/user-system/* and forwards to SERVER_ENV.USER_SYSTEM_BACKEND

import { SERVER_ENV } from '@/lib/serverEnv';
import { filterRequestHeadersAndInjectAuth } from '@/lib/auth/http';

type Params = { params: { path?: string[] } };

function buildTargetUrl(request: Request, path: string[] | undefined): string {
  if (!SERVER_ENV.USER_SYSTEM_BACKEND) {
    throw new Error('USER_SYSTEM_BACKEND is not configured');
  }
  const subPath = Array.isArray(path) ? path.join('/') : '';
  const url = new URL(request.url);
  const query = url.search; // includes leading ? when present
  const base = SERVER_ENV.USER_SYSTEM_BACKEND; // already normalized
  const suffix = subPath ? `/${subPath}` : '';
  return `${base}${suffix}${query}`;
}

function filterRequestHeaders(request: Request, headers: Headers): HeadersInit {
  return filterRequestHeadersAndInjectAuth(request, headers, {
    includeServiceKey: true,
    localFallback: true,
  });
}

async function proxy(
  request: Request,
  params: Params['params']
): Promise<Response> {
  const target = buildTargetUrl(request, params.path);
  const method = request.method;
  const headers = filterRequestHeaders(request, request.headers);
  const hasBody = !['GET', 'HEAD'].includes(method.toUpperCase());

  try {
    const upstreamResponse = await fetch(target, {
      method,
      headers,
      body: hasBody ? request.body : undefined,
      redirect: 'manual',
    });

    const resHeaders = new Headers();
    const contentType = upstreamResponse.headers.get('content-type');
    if (contentType) resHeaders.set('content-type', contentType);
    const cacheControl = upstreamResponse.headers.get('cache-control');
    if (cacheControl) resHeaders.set('cache-control', cacheControl);

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers: resHeaders,
    });
  } catch (err: any) {
    // 返回结构化错误，便于定位网络/证书/域解析问题
    // 透传结构化错误，便于诊断
    const body = {
      error: 'UPSTREAM_FETCH_FAILED',
      message: err?.message || 'fetch failed',
      target,
    };
    return new Response(JSON.stringify(body), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    });
  }
}

export async function GET(request: Request, ctx: Params) {
  try {
    return await proxy(request, ctx.params);
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        error: 'USER_SYSTEM_BACKEND_NOT_CONFIGURED',
        message: err?.message || 'missing backend base',
      }),
      { status: 500, headers: { 'content-type': 'application/json' } }
    );
  }
}

export async function POST(request: Request, ctx: Params) {
  try {
    return await proxy(request, ctx.params);
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        error: 'USER_SYSTEM_BACKEND_NOT_CONFIGURED',
        message: err?.message || 'missing backend base',
      }),
      { status: 500, headers: { 'content-type': 'application/json' } }
    );
  }
}

export async function PUT(request: Request, ctx: Params) {
  try {
    return await proxy(request, ctx.params);
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        error: 'USER_SYSTEM_BACKEND_NOT_CONFIGURED',
        message: err?.message || 'missing backend base',
      }),
      { status: 500, headers: { 'content-type': 'application/json' } }
    );
  }
}

export async function PATCH(request: Request, ctx: Params) {
  try {
    return await proxy(request, ctx.params);
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        error: 'USER_SYSTEM_BACKEND_NOT_CONFIGURED',
        message: err?.message || 'missing backend base',
      }),
      { status: 500, headers: { 'content-type': 'application/json' } }
    );
  }
}

export async function DELETE(request: Request, ctx: Params) {
  try {
    return await proxy(request, ctx.params);
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        error: 'USER_SYSTEM_BACKEND_NOT_CONFIGURED',
        message: err?.message || 'missing backend base',
      }),
      { status: 500, headers: { 'content-type': 'application/json' } }
    );
  }
}

export async function OPTIONS(request: Request, ctx: Params) {
  try {
    return await proxy(request, ctx.params);
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        error: 'USER_SYSTEM_BACKEND_NOT_CONFIGURED',
        message: err?.message || 'missing backend base',
      }),
      { status: 500, headers: { 'content-type': 'application/json' } }
    );
  }
}
