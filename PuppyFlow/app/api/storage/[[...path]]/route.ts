import { SERVER_ENV } from '@/lib/serverEnv';
import { cookies } from 'next/headers';

function buildTargetUrl(request: Request, path: string[] | undefined): string {
  const subPath = Array.isArray(path) ? path.join('/') : '';
  const url = new URL(request.url);
  const query = url.search;
  const base = SERVER_ENV.PUPPY_STORAGE_BACKEND;
  const suffix = subPath ? `/${subPath}` : '';
  return `${base}${suffix}${query}`;
}

function filterRequestHeaders(headers: Headers): Record<string, string> {
  const newHeaders: Record<string, string> = {};
  headers.forEach((value, key) => {
    const lower = key.toLowerCase();
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
        'cookie',
      ].includes(lower)
    ) {
      return;
    }
    newHeaders[key] = value;
  });

  // Storage expects Authorization, inject from cookie in cloud
  const mode = (process.env.DEPLOYMENT_MODE || '').toLowerCase();
  if (mode === 'cloud') {
    try {
      const token = cookies().get('access_token')?.value;
      if (token) newHeaders['authorization'] = `Bearer ${token}`;
    } catch {}
  }

  // Service-to-service key if configured
  if (SERVER_ENV.SERVICE_KEY) {
    newHeaders['x-service-key'] = SERVER_ENV.SERVICE_KEY;
  }

  return newHeaders;
}

async function proxy(request: Request, path: string[] | undefined): Promise<Response> {
  const target = buildTargetUrl(request, path);
  const method = request.method;
  const headers = filterRequestHeaders(request.headers);
  const hasBody = !['GET', 'HEAD'].includes(method.toUpperCase());

  const upstreamResponse = await fetch(target, {
    method,
    headers,
    body: hasBody ? (request as any).body : undefined,
    // Required by Node/undici when forwarding a streamed body
    // Only set when there is a request body to avoid warnings
    ...(hasBody ? { duplex: 'half' as any } : {}),
    redirect: 'manual',
  });

  const resHeaders = new Headers();
  // Reflect storage response headers that matter for uploads/downloads
  for (const key of ['content-type', 'cache-control', 'etag']) {
    const v = upstreamResponse.headers.get(key);
    if (v) resHeaders.set(key, v);
  }

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: resHeaders,
  });
}

export async function GET(request: Request, ctx: { params: { path?: string[] } }) {
  try {
    return await proxy(request, ctx.params.path);
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: 'STORAGE_PROXY_ERROR', message: err?.message || 'storage proxy failed' }),
      { status: 500, headers: { 'content-type': 'application/json' } }
    );
  }
}

export async function POST(request: Request, ctx: { params: { path?: string[] } }) {
  try {
    return await proxy(request, ctx.params.path);
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: 'STORAGE_PROXY_ERROR', message: err?.message || 'storage proxy failed' }),
      { status: 500, headers: { 'content-type': 'application/json' } }
    );
  }
}

export async function PUT(request: Request, ctx: { params: { path?: string[] } }) {
  try {
    return await proxy(request, ctx.params.path);
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: 'STORAGE_PROXY_ERROR', message: err?.message || 'storage proxy failed' }),
      { status: 500, headers: { 'content-type': 'application/json' } }
    );
  }
}

export async function PATCH(request: Request, ctx: { params: { path?: string[] } }) {
  try {
    return await proxy(request, ctx.params.path);
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: 'STORAGE_PROXY_ERROR', message: err?.message || 'storage proxy failed' }),
      { status: 500, headers: { 'content-type': 'application/json' } }
    );
  }
}

export async function DELETE(request: Request, ctx: { params: { path?: string[] } }) {
  try {
    return await proxy(request, ctx.params.path);
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: 'STORAGE_PROXY_ERROR', message: err?.message || 'storage proxy failed' }),
      { status: 500, headers: { 'content-type': 'application/json' } }
    );
  }
}

export async function OPTIONS(request: Request, ctx: { params: { path?: string[] } }) {
  try {
    return await proxy(request, ctx.params.path);
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: 'STORAGE_PROXY_ERROR', message: err?.message || 'storage proxy failed' }),
      { status: 500, headers: { 'content-type': 'application/json' } }
    );
  }
}
