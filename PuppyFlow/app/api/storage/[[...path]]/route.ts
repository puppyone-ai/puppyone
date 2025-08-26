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

  // Inject Authorization from cookie if available
  let authHeader: string | undefined;
  try {
    const token = cookies().get('access_token')?.value;
    if (token) authHeader = `Bearer ${token}`;
  } catch {
    // ignore
  }

  if (!newHeaders['authorization'] && authHeader) {
    newHeaders['authorization'] = authHeader;
  }

  // Service-to-service key if configured
  if (SERVER_ENV.SERVICE_KEY) {
    newHeaders['x-service-key'] = SERVER_ENV.SERVICE_KEY;
  }

  const mode = (process.env.DEPLOYMENT_MODE || '').toLowerCase();
  if (!newHeaders['authorization'] && mode !== 'cloud') {
    // Server-side local fallback only
    newHeaders['authorization'] = 'Bearer local-dev';
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
