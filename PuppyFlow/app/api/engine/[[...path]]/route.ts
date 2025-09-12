import { SERVER_ENV } from '@/lib/serverEnv';
import { filterRequestHeadersAndInjectAuth } from '@/lib/auth/http';

function buildTargetUrl(request: Request, path: string[] | undefined): string {
  const subPath = Array.isArray(path) ? path.join('/') : '';
  const url = new URL(request.url);
  const query = url.search; // includes leading ? when present
  const base = SERVER_ENV.PUPPY_ENGINE_BACKEND;
  const suffix = subPath ? `/${subPath}` : '';
  return `${base}${suffix}${query}`;
}

function filterRequestHeaders(request: Request, headers: Headers): Record<string, string> {
  return filterRequestHeadersAndInjectAuth(request, headers, {
    includeServiceKey: false,
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

  const upstreamResponse = await fetch(target, {
    method,
    headers,
    body: hasBody ? (request as any).body : undefined,
    ...(hasBody ? { duplex: 'half' as any } : {}),
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
}

export async function GET(
  request: Request,
  ctx: { params: { path?: string[] } }
) {
  try {
    return await proxy(request, ctx.params.path);
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        error: 'ENGINE_PROXY_ERROR',
        message: err?.message || 'engine proxy failed',
      }),
      { status: 500, headers: { 'content-type': 'application/json' } }
    );
  }
}

export async function POST(
  request: Request,
  ctx: { params: { path?: string[] } }
) {
  try {
    return await proxy(request, ctx.params.path);
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        error: 'ENGINE_PROXY_ERROR',
        message: err?.message || 'engine proxy failed',
      }),
      { status: 500, headers: { 'content-type': 'application/json' } }
    );
  }
}

export async function PUT(
  request: Request,
  ctx: { params: { path?: string[] } }
) {
  try {
    return await proxy(request, ctx.params.path);
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        error: 'ENGINE_PROXY_ERROR',
        message: err?.message || 'engine proxy failed',
      }),
      { status: 500, headers: { 'content-type': 'application/json' } }
    );
  }
}

export async function PATCH(
  request: Request,
  ctx: { params: { path?: string[] } }
) {
  try {
    return await proxy(request, ctx.params.path);
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        error: 'ENGINE_PROXY_ERROR',
        message: err?.message || 'engine proxy failed',
      }),
      { status: 500, headers: { 'content-type': 'application/json' } }
    );
  }
}

export async function DELETE(
  request: Request,
  ctx: { params: { path?: string[] } }
) {
  try {
    return await proxy(request, ctx.params.path);
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        error: 'ENGINE_PROXY_ERROR',
        message: err?.message || 'engine proxy failed',
      }),
      { status: 500, headers: { 'content-type': 'application/json' } }
    );
  }
}

export async function OPTIONS(
  request: Request,
  ctx: { params: { path?: string[] } }
) {
  try {
    return await proxy(request, ctx.params.path);
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        error: 'ENGINE_PROXY_ERROR',
        message: err?.message || 'engine proxy failed',
      }),
      { status: 500, headers: { 'content-type': 'application/json' } }
    );
  }
}
